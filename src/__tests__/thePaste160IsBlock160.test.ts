import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * 10/11: smart_target_shift_runs timed out because the intouch_status_log policy called
 * has_role() for every row read. On local Postgres the old policy made 10,000 calls for
 * 2,000 rows; the wrapped one makes 5.
 */
const root = resolve(__dirname, "../..");
const dir = resolve(root, "docs/apply-passo-3");
const read = (p: string) => readFileSync(p, "utf8");
const all = read(resolve(dir, "APPLY-ALL-IN-ORDER.sql"));
const paste = read(resolve(dir, "APLICAR-160-log-do-itouch-pergunta-uma-vez.sql"));
const migration = read(resolve(root, "supabase/migrations/20261110210000_status_log_policy_asks_the_role_once.sql"));
const block = all.split(/\n(?=-- =+\n-- BLOCO \d+\n)/).find((b) => /^-- =+\n-- BLOCO 160\n/.test(b))!;
const code = (sql: string) => sql.split("\n").filter((l) => l.trim() && !l.trim().startsWith("--")).join("\n");

describe("BLOCO 160", () => {
  it("is the migration, and the paste carries it and adds only comments", () => {
    expect(block).toContain(migration.trimEnd());
    expect(paste).toContain(block.trimEnd());
    expect(code(paste.replace(block.trimEnd(), ""))).toBe("");
  });

  it("keeps the same five roles, each asked once per query", () => {
    const sql = code(migration);
    for (const role of ["admin", "manager", "production_office_admin", "maintenance_manager", "engineer"]) {
      expect(sql).toContain(`(select public.has_role((select auth.uid()), '${role}'::public.app_role))`);
    }
    expect(sql.match(/has_role\(/g)).toHaveLength(5);
    expect(sql).toMatch(/for select\s+to authenticated/);
  });

  it("does not widen anything", () => {
    const sql = code(migration);
    expect(sql).not.toMatch(/\b(grant|disable row level security|to public|to anon)\b/i);
  });
});
