import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * BLOCO 115: the bell rows the database writes itself buzz the phone.
 *
 * On 21/10/2026 only the overtime ask reached a locked phone, because only the browser of
 * whoever posted it called `send-push`. A direct message (`dm_employee_bell`), a "you're
 * booked" or a "X said yes" sat in the bell until the person opened the app. And the
 * browser could not fix that: `send-push` answers 403 to an employee who targets anybody
 * but themself.
 *
 * So a trigger on `notifications` calls `send-push` through pg_net with the vault's
 * CRON_SECRET. What this test holds is the line between "pushed once" and "pushed twice":
 * rows without a kind are written BY `send-push` (which has already pushed them), and
 * `overtime_new` is pushed by `announceAsk` from the browser. Either one here would buzz
 * the same phone a second time.
 */
const root = resolve(__dirname, "../..");
const MIGRATIONS = resolve(root, "supabase/migrations");
const sql = readFileSync(resolve(MIGRATIONS, "20261021190000_the_bell_rings_the_phone.sql"), "utf8");
const fn = readFileSync(resolve(root, "supabase/functions/send-push/index.ts"), "utf8");
const announce = readFileSync(resolve(root, "src/lib/overtimeAnnounce.ts"), "utf8");

describe("the bell rings the phone", () => {
  it("fires for rows with a kind, except the one the browser already pushes", () => {
    expect(sql).toMatch(/after insert on public\.notifications/);
    expect(sql).toMatch(/when \(new\.kind is not null and new\.kind <> 'overtime_new'\)/);
  });

  it("the browser still pushes overtime_new itself — otherwise the exclusion loses it", () => {
    expect(announce).toMatch(/in_app: false/);
    expect(announce).toMatch(/overtime_ask_notified/);
  });

  it("send-push writes its own bell rows without a kind, so the trigger never echoes them", () => {
    const insert = fn.slice(fn.indexOf('from("notifications").insert'), fn.indexOf("if (notifErr)"));
    expect(insert).not.toBe("");
    expect(insert).not.toMatch(/\bkind\b/);
  });

  it("the DM bells carry a kind, so the trigger sees them", () => {
    const kinds = new Set<string>();
    for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"))) {
      const text = readFileSync(resolve(MIGRATIONS, f), "utf8");
      for (const m of text.matchAll(/insert into public\.notifications\s*\(([^)]*)\)\s*(?:values\s*\(|select)([^;]*)/gi)) {
        const cols = m[1].split(",").map((c) => c.trim());
        const at = cols.indexOf("kind");
        if (at < 0) continue;
        const k = m[2].match(/'([a-z_]+)'/g)?.map((s) => s.slice(1, -1)).find((s) => /^(overtime|chat)_/.test(s));
        if (k) kinds.add(k);
      }
    }
    // The DMs are the point of the block. A bell row written without a kind would be
    // skipped by the trigger's WHEN, exactly like the ones send-push writes.
    expect(kinds).toContain("chat_message");
    expect(kinds).toContain("overtime_message");
    expect(kinds).toContain("overtime_booked");
    expect(kinds).toContain("overtime_yes");
  });

  it("calls send-push with the vault secret, not a literal, and never writes the bell twice", () => {
    expect(sql).toMatch(/vault\.decrypted_secrets where name = 'CRON_SECRET'/);
    expect(sql).toMatch(/'x-cron-secret', v_secret/);
    expect(sql).toMatch(/\/functions\/v1\/send-push/);
    expect(sql).toMatch(/'in_app', false/);
    // A long literal next to the header would be a secret copied into the repo.
    expect(sql).not.toMatch(/'x-cron-secret',\s*'[^']+'/);
  });

  it("only knocks for someone with a phone registered", () => {
    expect(sql).toMatch(/if not exists \(select 1 from public\.push_subscriptions s where s\.user_id = new\.user_id\)/);
  });

  it("never refuses the bell row", () => {
    expect(sql).toMatch(/exception when others then\s*raise warning 'notification_push/);
    expect(sql).toMatch(/return null;\s*end;\s*\$\$;/);
    expect(sql).toMatch(/revoke all on function public\.notification_push\(\) from public, anon, authenticated/);
  });

  it("sends only what send-push's schema accepts", () => {
    expect(sql).toMatch(/left\(coalesce\(nullif\(new\.title, ''\), 'PMSystem'\), 200\)/);
    expect(sql).toMatch(/left\(new\.body, 2000\)/);
    expect(sql).toMatch(/new\.priority in \('low', 'medium', 'high', 'critical'\)/);
    expect(sql).toMatch(/'tag', left\(/);
    for (const key of ["user_id", "title", "body", "priority", "tag", "action_url", "wo_id", "in_app"]) {
      expect(fn).toMatch(new RegExp(`\\b${key}: z\\.`));
    }
  });

  it("touches no data", () => {
    expect(sql).not.toMatch(/^\s*(update|delete from|truncate)\b/im);
  });
});

describe("send-push accepts the database as a caller", () => {
  it("the scheduler's secret, under the same three names as safetyculture-sync", () => {
    expect(fn).toMatch(/\["CRON_SECRET", "CRON_TRIGGER_TOKEN", "CRON_POLL_KEY"\]/);
    expect(fn).toMatch(/req\.headers\.get\("x-cron-secret"\)/);
    // An empty header must not match an unset secret.
    expect(fn).toMatch(/\.filter\(Boolean\)/);
    expect(fn).toMatch(/presented !== "" && cronSecrets\.includes\(presented\)/);
  });

  it("a signed-in non-staff caller still may only target themself", () => {
    expect(fn).toMatch(/const isStaff = isService \|\| /);
    expect(fn).toMatch(/if \(!isStaff && userIds\.some\(\(id\) => id !== callerId\)\)/);
    expect(fn).toMatch(/status: 403/);
  });

  it("without the secret, a missing or bad JWT is still a 401", () => {
    const gate = fn.slice(fn.indexOf("if (!isService) {"), fn.indexOf("const VAPID_PUBLIC"));
    expect(gate.match(/status: 401/g)?.length).toBe(2);
    expect(gate).toMatch(/callerId = claimsData\.claims\.sub/);
  });
});
