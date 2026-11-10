import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** BLOCO 156: the Root Diagnostics badge's count reads an index, not the whole table. */
const root = resolve(__dirname, "../..");
const dir = resolve(root, "docs/apply-passo-3");
const read = (p: string) => readFileSync(p, "utf8");
const all = read(resolve(dir, "APPLY-ALL-IN-ORDER.sql"));
const paste = read(resolve(dir, "APLICAR-156-indice-do-badge.sql"));
const migration = read(resolve(root, "supabase/migrations/20261110130000_hot_path_indexes.sql"));
const block = all.split(/\n(?=-- =+\n-- BLOCO \d+\n)/).find((b) => /^-- =+\n-- BLOCO 156\n/.test(b))!;
const code = (sql: string) => sql.split("\n").filter((l) => l.trim() && !l.trim().startsWith("--")).join("\n");

describe("BLOCO 156", () => {
  it("is the migration, and the paste carries it and adds only comments", () => {
    expect(block).toContain(migration.trimEnd());
    expect(paste).toContain(block.trimEnd());
    expect(code(paste.replace(block.trimEnd(), ""))).toBe("");
  });

  it("only creates an index, and can be pasted twice", () => {
    const sql = code(migration);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS system_telemetry_logs_type_created_idx/);
    expect(sql).toMatch(/ON public\.system_telemetry_logs \(error_type, created_at DESC\)/);
    expect(sql).not.toMatch(/\b(insert|update|delete|alter|drop|policy|function)\b/i);
  });
});
