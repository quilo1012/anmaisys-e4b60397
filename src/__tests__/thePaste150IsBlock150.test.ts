import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Q57a: a forecast with no number can be replaced; one with a number never changes. */
const root = resolve(__dirname, "../..");
const dir = resolve(root, "docs/apply-passo-3");
const read = (p: string) => readFileSync(p, "utf8");
const all = read(resolve(dir, "APPLY-ALL-IN-ORDER.sql"));
const paste = read(resolve(dir, "APLICAR-150-previsao-sem-numero.sql"));
const migration = read(resolve(root, "supabase/migrations/20261106090000_smart_target_no_number_replaced.sql"));
const block = all.split(/\n(?=-- =+\n-- BLOCO \d+\n)/).find((b) => /^-- =+\n-- BLOCO 150\n/.test(b))!;
const code = (sql: string) => sql.split("\n").filter((l) => l.trim() && !l.trim().startsWith("--")).join("\n");

describe("BLOCO 150", () => {
  it("is the migration, and the paste carries it and adds only comments", () => {
    expect(block).toContain(migration.trimEnd());
    expect(paste).toContain(block.trimEnd());
    expect(code(paste.replace(block.trimEnd(), ""))).toBe("");
  });

  it("replaces a row only when it has no number and the new one has", () => {
    expect(code(migration)).toMatch(/where f\.expected_total is null and excluded\.expected_total is not null;/);
    expect(code(migration)).toMatch(/frozen_at = now\(\)/);
  });

  it("keeps anon out", () => {
    expect(code(migration)).toMatch(/revoke all on function public\.save_smart_target_forecasts\(date, text, jsonb\) from public, anon;/);
  });
});
