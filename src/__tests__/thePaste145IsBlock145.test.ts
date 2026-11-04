import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Audit 2026-11-02, DB-001, the rest of it. BLOCO 143 fixed the one view that ran as its
 * owner for anon. Production still granted SELECT to anon on 14 other views; they run as
 * their reader, so RLS answered for them, but nothing the app reads without a session is
 * a view. `20261104130000` takes anon and PUBLIC off every view in public and keeps the
 * SELECT authenticated and service_role had. `APLICAR-145-…` is the one-block paste and `VERIFY-145-…`
 * the read-only catalogue check.
 */
const root = resolve(__dirname, "../..");
const dir = resolve(root, "docs/apply-passo-3");
const read = (p: string) => readFileSync(p, "utf8");
const all = read(resolve(dir, "APPLY-ALL-IN-ORDER.sql"));
const paste = read(resolve(dir, "APLICAR-145-vistas-sem-anon.sql"));
const verify = read(resolve(dir, "VERIFY-145-vistas-sem-anon.sql"));
const migration = read(resolve(root, "supabase/migrations/20261104130000_no_view_answers_without_a_session.sql"));

const block145 = all
  .split(/\n(?=-- =+\n-- BLOCO \d+\n)/)
  .find((b) => /^-- =+\n-- BLOCO 145\n/.test(b))!;

const code = (sql: string) =>
  sql.split("\n").filter((l) => l.trim() && !l.trim().startsWith("--")).join("\n");

describe("APLICAR-145 is BLOCO 145 and nothing else", () => {
  it("BLOCO 145 is the migration", () => {
    expect(block145).toBeTruthy();
    expect(block145).toContain(migration.trimEnd());
  });

  it("carries the block byte for byte and adds only comments", () => {
    expect(paste).toContain(block145.trimEnd());
    expect(code(paste.replace(block145.trimEnd(), ""))).toBe("");
  });
});

describe("no view answers without a session", () => {
  it("revokes anon and PUBLIC on every view and materialized view in public", () => {
    expect(code(migration)).toMatch(/relkind in \('v', 'm'\)/);
    expect(code(migration)).toMatch(/revoke all on %s from anon, public/);
  });

  it("gives authenticated and service_role back the SELECT each had, and only that", () => {
    expect(code(migration)).toMatch(/has_table_privilege\('authenticated', c\.oid, 'SELECT'\) as signed_in_reads/);
    expect(code(migration)).toMatch(/grant select on %s to authenticated/);
    expect(code(migration)).toMatch(/has_table_privilege\('service_role', c\.oid, 'SELECT'\) as service_reads/);
    expect(code(migration)).toMatch(/grant select on %s to service_role/);
    expect(code(migration)).not.toMatch(/grant (all|insert|update|delete)/i);
  });

  it("does not rewrite any view", () => {
    expect(code(migration)).not.toMatch(/create (or replace )?view/i);
  });

  it("VERIFY-145 lists the views anon still reads and the ones that run as their owner", () => {
    expect(verify).toMatch(/has_table_privilege\('anon', c\.oid, 'SELECT'\)/);
    expect(verify).toMatch(/security_invoker/);
    expect(verify).toMatch(/has_table_privilege\('authenticated', c\.oid, 'SELECT'\)/);
  });
});
