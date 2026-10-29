import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * 29/10/2026: a booking the person cancelled in time could never be taken back.
 * `20261029230000` adds `rebook_my_overtime`. `APLICAR-138-…` is the one-block paste and
 * `VERIFY-138-…` the read-only check; both are worth having only while they are the
 * migration. And the migration must stay what its paste file promises the person who
 * pastes it: one new function, nothing existing replaced, no data touched.
 */
const root = resolve(__dirname, "../..");
const dir = resolve(root, "docs/apply-passo-3");
const read = (p: string) => readFileSync(p, "utf8");
const all = read(resolve(dir, "APPLY-ALL-IN-ORDER.sql"));
const paste = read(resolve(dir, "APLICAR-138-voltar-a-marcar-o-que-cancelei.sql"));
const verify = read(resolve(dir, "VERIFY-138-voltar-a-marcar.sql"));
const migration = read(resolve(root, "supabase/migrations/20261029230000_a_booking_cancelled_in_time_can_be_taken_back.sql"));

const block138 = all
  .split(/\n(?=-- =+\n-- BLOCO \d+\n)/)
  .find((b) => /^-- =+\n-- BLOCO 138\n/.test(b))!;

const code = (sql: string) =>
  sql.split("\n").filter((l) => l.trim() && !l.trim().startsWith("--")).join("\n");

function bodyMd5(name: string): string {
  const start = migration.search(new RegExp(`create or replace function public\\.${name}\\(`, "i"));
  expect(start, `${name} is in the migration`).toBeGreaterThanOrEqual(0);
  const open = migration.indexOf("as $$", start) + "as $$".length;
  const close = migration.indexOf("$$;", open);
  return createHash("md5").update(migration.slice(open, close)).digest("hex");
}
const body = () => {
  const start = migration.indexOf("as $$");
  return migration.slice(start, migration.indexOf("$$;", start + 5));
};

describe("APLICAR-138 is BLOCO 138 and nothing else", () => {
  it("BLOCO 138 is the migration", () => {
    expect(block138).toBeTruthy();
    expect(block138).toContain(migration.trimEnd());
  });

  it("carries the block byte for byte and adds only comments", () => {
    expect(paste).toContain(block138.trimEnd());
    expect(code(paste.replace(block138.trimEnd(), ""))).toBe("");
  });
});

describe("the migration is one new function and nothing else", () => {
  it("creates rebook_my_overtime and replaces nothing", () => {
    const fns = [...migration.matchAll(/create or replace function public\.(\w+)\(/gi)].map((m) => m[1]);
    expect(fns).toEqual(["rebook_my_overtime"]);
    const outside = code(migration.slice(0, migration.indexOf("create or replace function"))
      + migration.slice(migration.indexOf("$$;") + 3));
    expect(outside).not.toMatch(/\b(insert|update|delete|truncate|drop|alter table)\b/i);
  });

  it("keeps it out of anon's reach", () => {
    expect(migration).toMatch(/revoke all on function public\.rebook_my_overtime\(uuid\) from public, anon;/);
    expect(migration).toMatch(/grant execute on function public\.rebook_my_overtime\(uuid\) to authenticated;/);
  });

  it("only undoes the caller's own cancellation, made in time", () => {
    expect(body()).toMatch(/where request_id = p_request_id and employee_id = v_emp/);
    expect(body()).toMatch(/v_outcome\.recorded_by is distinct from auth\.uid\(\)/);
    expect(body()).toMatch(/v_outcome\.outcome = 'cancelled_late'/);
  });

  it("checks the ask before it clears anything, and books through answer_overtime", () => {
    const b = body();
    const checkOpen = b.indexOf("v_req.status <> 'open'");
    const checkStarted = b.indexOf("(v_req.on_date + v_req.starts_at) <= (now() at time zone 'Europe/London')");
    const clear = b.indexOf("delete from public.overtime_outcomes");
    expect(checkOpen).toBeGreaterThan(0);
    expect(checkStarted).toBeGreaterThan(0);
    expect(clear).toBeGreaterThan(Math.max(checkOpen, checkStarted));
    expect(b).toMatch(/return public\.answer_overtime\(p_request_id, 'yes'\);/);
  });
});

describe("VERIFY-138 checks production against this migration", () => {
  it("expects rebook_my_overtime's body from the migration", () => {
    expect(verify).toContain(`md5(p.prosrc) = '${bodyMd5("rebook_my_overtime")}'`);
  });

  it("only reads", () => {
    expect(code(verify)).not.toMatch(/\b(insert|update|delete|truncate|create|drop|alter|grant|revoke)\b/i);
  });
});
