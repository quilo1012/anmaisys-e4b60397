import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * 29/10/2026: leaving the reserve list left `decision = 'reserve'` on a "no", and the
 * person could never say yes again. `20261029220000` makes leaving a plain no.
 *
 * `APLICAR-137-…` is the one-block paste and `VERIFY-137-…` the read-only check. Both
 * are worth having only while they are the migration: the paste must be BLOCO 137 byte
 * for byte with nothing executable added, and the fingerprint the check compares
 * production against must be the migration's own function body.
 */
const root = resolve(__dirname, "../..");
const dir = resolve(root, "docs/apply-passo-3");
const read = (p: string) => readFileSync(p, "utf8");
const all = read(resolve(dir, "APPLY-ALL-IN-ORDER.sql"));
const paste = read(resolve(dir, "APLICAR-137-sair-da-reserva-e-um-nao.sql"));
const verify = read(resolve(dir, "VERIFY-137-sair-da-reserva.sql"));
const migration = read(resolve(root, "supabase/migrations/20261029220000_leaving_the_reserve_is_a_plain_no.sql"));

const block137 = all
  .split(/\n(?=-- =+\n-- BLOCO \d+\n)/)
  .find((b) => /^-- =+\n-- BLOCO 137\n/.test(b))!;

const code = (sql: string) =>
  sql.split("\n").filter((l) => l.trim() && !l.trim().startsWith("--")).join("\n");

/** md5 of a function's body as Postgres stores it (`prosrc`): what lies between its `$$`. */
function bodyMd5(name: string): string {
  const start = migration.search(new RegExp(`create or replace function public\\.${name}\\(`, "i"));
  expect(start, `${name} is in the migration`).toBeGreaterThanOrEqual(0);
  const open = migration.indexOf("as $$", start) + "as $$".length;
  const close = migration.indexOf("$$;", open);
  return createHash("md5").update(migration.slice(open, close)).digest("hex");
}

describe("APLICAR-137 is BLOCO 137 and nothing else", () => {
  it("BLOCO 137 is the migration", () => {
    expect(block137).toBeTruthy();
    expect(block137).toContain(migration.trimEnd());
  });

  it("carries the block byte for byte and adds only comments", () => {
    expect(paste).toContain(block137.trimEnd());
    expect(code(paste.replace(block137.trimEnd(), ""))).toBe("");
  });
});

describe("the migration does what the paste says, and no more", () => {
  it("leave_my_reserve clears the decision with the answer", () => {
    expect(migration).toMatch(/set answer = 'no', decision = null, decided_at = null, decided_by = null/);
  });

  it("the repair touches only no + reserve rows with no outcome", () => {
    const repair = migration.slice(migration.indexOf("do $$"));
    expect(repair).toMatch(/where r\.answer = 'no' and r\.decision = 'reserve'/);
    expect(repair).toMatch(/not exists \(select 1 from public\.overtime_outcomes o where o\.response_id = r\.id\)/);
    expect(code(repair)).not.toMatch(/\bdelete\b|\binsert\b|\btruncate\b/i);
  });

  it("does not replace answer_overtime (BLOCO 128 owns it) or any other function", () => {
    const fns = [...migration.matchAll(/create or replace function public\.(\w+)\(/gi)].map((m) => m[1]);
    expect(fns).toEqual(["leave_my_reserve"]);
  });

  it("keeps the function out of anon's reach", () => {
    expect(migration).toMatch(/revoke all on function public\.leave_my_reserve\(uuid\) from public, anon;/);
    expect(migration).toMatch(/grant execute on function public\.leave_my_reserve\(uuid\) to authenticated;/);
  });
});

describe("VERIFY-137 checks production against this migration", () => {
  it("expects leave_my_reserve's body from the migration", () => {
    expect(verify).toContain(`md5(p.prosrc) = '${bodyMd5("leave_my_reserve")}'`);
  });

  it("only reads", () => {
    expect(code(verify)).not.toMatch(/\b(insert|update|delete|truncate|create|drop|alter|grant|revoke)\b/i);
  });
});
