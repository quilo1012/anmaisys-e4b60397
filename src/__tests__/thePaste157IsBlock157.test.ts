import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Q82: each product's allergens, for Smart Target's deep clean rule. */
const root = resolve(__dirname, "../..");
const dir = resolve(root, "docs/apply-passo-3");
const read = (p: string) => readFileSync(p, "utf8");
const all = read(resolve(dir, "APPLY-ALL-IN-ORDER.sql"));
const paste = read(resolve(dir, "APLICAR-157-alergenios-dos-produtos.sql"));
const migration = read(resolve(root, "supabase/migrations/20261110180000_sku_allergens.sql"));
const block = all.split(/\n(?=-- =+\n-- BLOCO \d+\n)/).find((b) => /^-- =+\n-- BLOCO 157\n/.test(b))!;
const code = (sql: string) => sql.split("\n").filter((l) => l.trim() && !l.trim().startsWith("--")).join("\n");

describe("BLOCO 157", () => {
  it("is the migration, and the paste carries it and adds only comments", () => {
    expect(block).toContain(migration.trimEnd());
    expect(paste).toContain(block.trimEnd());
    expect(code(paste.replace(block.trimEnd(), ""))).toBe("");
  });

  it("only adds a nullable column, so it can be pasted twice and changes no data", () => {
    expect(code(migration)).toMatch(/alter table public\.sku_products add column if not exists allergens text\[\];/);
    expect(code(migration)).not.toMatch(/\b(update|delete|insert|drop|grant|revoke|policy)\b/i);
  });
});
