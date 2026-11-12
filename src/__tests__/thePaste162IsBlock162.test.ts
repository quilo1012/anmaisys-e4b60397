import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** 11/11: the iTouch poll runs one at a time, and pg_net waits 30 s for it (audit P0-5). */
const root = resolve(__dirname, "../..");
const dir = resolve(root, "docs/apply-passo-3");
const read = (p: string) => readFileSync(p, "utf8");
const all = read(resolve(dir, "APPLY-ALL-IN-ORDER.sql"));
const paste = read(resolve(dir, "APLICAR-162-itouch-um-poll-de-cada-vez.sql"));
const verify = read(resolve(dir, "VERIFY-162-itouch-um-poll-de-cada-vez.sql"));
const migration = read(resolve(root, "supabase/migrations/20261111220000_intouch_poll_one_at_a_time.sql"));
const block = all.split(/\n(?=-- =+\n-- BLOCO \d+\n)/).find((b) => /^-- =+\n-- BLOCO 162\n/.test(b))!;
const code = (sql: string) => sql.split("\n").filter((l) => l.trim() && !l.trim().startsWith("--")).join("\n");

describe("BLOCO 162", () => {
  it("is the migration, and the paste carries it and adds only comments", () => {
    expect(block).toContain(migration.trimEnd());
    expect(paste).toContain(block.trimEnd());
    expect(code(paste.replace(block.trimEnd(), ""))).toBe("");
  });

  it("comes straight after BLOCO 161 in the package", () => {
    expect(all.indexOf("\n-- BLOCO 162\n")).toBeGreaterThan(all.indexOf("\n-- BLOCO 161\n"));
  });

  it("lets only service_role run the lease functions", () => {
    const c = code(migration);
    expect(c).toContain("revoke all on function public.intouch_poll_try_start(integer) from public, anon, authenticated;");
    expect(c).toContain("revoke all on function public.intouch_poll_finish() from public, anon, authenticated;");
    expect(c).toContain("grant execute on function public.intouch_poll_try_start(integer) to service_role;");
    expect(c).toContain("grant execute on function public.intouch_poll_finish() to service_role;");
    expect(c).not.toMatch(/grant [^;]* to (anon|authenticated|public)\b/i);
    expect(c.match(/security definer\s+set search_path = public/g)?.length).toBe(2);
  });

  // The cron command is rebuilt here. It must still read the secret from the vault at run
  // time, and it must never carry one.
  it("gives the cron request 30 s and keeps reading the secret from the vault", () => {
    expect(migration).toContain("timeout_milliseconds:=30000");
    expect(migration).toContain(
      "'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'CRON_SECRET' limit 1)",
    );
    expect(migration).toMatch(/cron\.alter_job\(/);
    // The URL comes from the job as it stands, not from a literal project ref.
    expect(migration).not.toMatch(/https:\/\/[a-z0-9]+\.supabase\.co/);
    expect(migration).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
  });

  it("is verified by a read-only file", () => {
    expect(code(verify)).not.toMatch(/\b(insert|update|delete|alter|create|drop|grant|revoke|perform)\b/i);
    expect(verify).toContain("timeout_milliseconds:=30000");
  });
});
