import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** 26/11: the bell and the phone get announcement text without ** and list marks. */
const root = resolve(__dirname, "../..");
const dir = resolve(root, "docs/apply-passo-3");
const read = (p: string) => readFileSync(p, "utf8");
const all = read(resolve(dir, "APPLY-ALL-IN-ORDER.sql"));
const paste = read(resolve(dir, "APLICAR-165-texto-do-sino-sem-marcas.sql"));
const migration = read(resolve(root, "supabase/migrations/20261126140000_announcement_bell_text_plain.sql"));
const block = all.split(/\n(?=-- =+\n-- BLOCO \d+\n)/).find((b) => /^-- =+\n-- BLOCO 165\n/.test(b))!;
const code = (sql: string) => sql.split("\n").filter((l) => l.trim() && !l.trim().startsWith("--")).join("\n");

describe("BLOCO 165", () => {
  it("is the migration, and the paste carries it and adds only comments", () => {
    expect(block).toContain(migration.trimEnd());
    expect(paste).toContain(block.trimEnd());
    expect(code(paste.replace(block.trimEnd(), ""))).toBe("");
  });

  it("comes after BLOCO 164 in the package", () => {
    expect(all.indexOf("\n-- BLOCO 165\n")).toBeGreaterThan(all.indexOf("\n-- BLOCO 164\n"));
  });

  it("writes the bell text through announcement_plain and keeps it from clients", () => {
    const c = code(migration);
    expect(c).toContain("public.announcement_plain(v_a.body)");
    expect(c).toContain("public.announcement_plain(p_body)");
    expect(c).toContain("revoke all on function public.announcement_plain(text) from public, anon, authenticated;");
    expect(c).not.toContain("grant execute on function public.announcement_plain");
  });
});
