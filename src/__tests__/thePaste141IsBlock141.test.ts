import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * 01/11/2026: the admin heard "X is coming in" when somebody said yes, and nothing when
 * that person cancelled. `20261101100000` adds a trigger on `overtime_outcomes` that tells
 * the same people. `APLICAR-141-…` is the one-block paste and `VERIFY-141-…` the read-only
 * check; both are worth having only while they are the migration. And the migration must
 * stay what its paste file promises: one new function, one trigger, no data touched.
 */
const root = resolve(__dirname, "../..");
const dir = resolve(root, "docs/apply-passo-3");
const read = (p: string) => readFileSync(p, "utf8");
const all = read(resolve(dir, "APPLY-ALL-IN-ORDER.sql"));
const paste = read(resolve(dir, "APLICAR-141-cancelamento-avisa-o-supervisor.sql"));
const verify = read(resolve(dir, "VERIFY-141-cancelamento-avisa.sql"));
const migration = read(resolve(root, "supabase/migrations/20261101100000_a_cancelled_booking_tells_who_was_told_it_was_coming.sql"));

const block141 = all
  .split(/\n(?=-- =+\n-- BLOCO \d+\n)/)
  .find((b) => /^-- =+\n-- BLOCO 141\n/.test(b))!;

const code = (sql: string) =>
  sql.split("\n").filter((l) => l.trim() && !l.trim().startsWith("--")).join("\n");

const body = () => {
  const start = migration.indexOf("as $$");
  return migration.slice(start + "as $$".length, migration.indexOf("$$;", start + 5));
};

describe("APLICAR-141 is BLOCO 141 and nothing else", () => {
  it("BLOCO 141 is the migration", () => {
    expect(block141).toBeTruthy();
    expect(block141).toContain(migration.trimEnd());
  });

  it("carries the block byte for byte and adds only comments", () => {
    expect(paste).toContain(block141.trimEnd());
    expect(code(paste.replace(block141.trimEnd(), ""))).toBe("");
  });
});

describe("the migration is one function and one trigger", () => {
  it("creates overtime_outcome_cancelled_notify and replaces nothing else", () => {
    const fns = [...migration.matchAll(/create or replace function public\.(\w+)\(/gi)].map((m) => m[1]);
    expect(fns).toEqual(["overtime_outcome_cancelled_notify"]);
    const outside = code(migration.slice(0, migration.indexOf("create or replace function"))
      + migration.slice(migration.indexOf("$$;") + 3));
    const trigger = /after insert or update of outcome on public\.overtime_outcomes/;
    expect(outside.replace(trigger, "")).not.toMatch(/\b(insert|update|delete|truncate|alter table)\b/i);
    expect(migration).toMatch(/after insert or update of outcome on public\.overtime_outcomes/);
  });

  it("is nobody's to call", () => {
    expect(migration).toMatch(/revoke all on function public\.overtime_outcome_cancelled_notify\(\) from public, anon, authenticated;/);
  });

  it("tells the same people the yes bell tells, never the one who did it nor the employee", () => {
    const b = body();
    expect(b).toMatch(/public\.supervisor_logins_of\(v_resp\.employee_id\)/);
    expect(b).toMatch(/v_req\.created_by/);
    expect(b).toMatch(/t <> auth\.uid\(\) and t is distinct from v_user/);
  });

  it("rings only when a booking first becomes a cancellation, with somebody signed in", () => {
    const b = body();
    expect(b).toMatch(/new\.outcome not in \('cancelled_in_time', 'cancelled_late'\)/);
    expect(b).toMatch(/old\.outcome in \('cancelled_in_time', 'cancelled_late'\)/);
    expect(b).toMatch(/if auth\.uid\(\) is null then return null/);
    expect(b).toMatch(/v_resp\.decision is distinct from 'accepted'/);
  });

  it("never undoes the cancellation for the bell", () => {
    expect(body()).toMatch(/exception when others then\s*--[^\n]*\n\s*raise warning 'overtime_outcome_cancelled_notify/);
  });
});

describe("VERIFY-141 checks production against this migration", () => {
  it("expects the function's body from the migration", () => {
    const md5 = createHash("md5").update(body()).digest("hex");
    expect(verify).toContain(`md5(p.prosrc) = '${md5}'`);
  });

  it("only reads", () => {
    expect(code(verify)).not.toMatch(/\b(insert|update|delete|truncate|create|drop|alter|grant|revoke)\b/i);
  });
});
