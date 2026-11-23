import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** 23/11: the board's "Other department" column needs daily_allocations to accept the status. */
const root = resolve(__dirname, "../..");
const dir = resolve(root, "docs/apply-passo-3");
const read = (p: string) => readFileSync(p, "utf8");
const all = read(resolve(dir, "APPLY-ALL-IN-ORDER.sql"));
const paste = read(resolve(dir, "APLICAR-163-outro-departamento-no-board.sql"));
const verify = read(resolve(dir, "VERIFY-163-outro-departamento-no-board.sql"));
const migration = read(resolve(root, "supabase/migrations/20261123210000_board_other_department.sql"));
const block = all.split(/\n(?=-- =+\n-- BLOCO \d+\n)/).find((b) => /^-- =+\n-- BLOCO 163\n/.test(b))!;
const code = (sql: string) => sql.split("\n").filter((l) => l.trim() && !l.trim().startsWith("--")).join("\n");

describe("BLOCO 163", () => {
  it("is the migration, and the paste carries it and adds only comments", () => {
    expect(block).toContain(migration.trimEnd());
    expect(paste).toContain(block.trimEnd());
    expect(code(paste.replace(block.trimEnd(), ""))).toBe("");
  });

  it("comes straight after BLOCO 162 in the package", () => {
    expect(all.indexOf("\n-- BLOCO 163\n")).toBeGreaterThan(all.indexOf("\n-- BLOCO 162\n"));
  });

  it("keeps every status the board already writes, and adds other_department", () => {
    for (const s of ["assigned", "overtime", "sick", "unpaid", "holiday", "training", "other_department"]) {
      expect(code(migration)).toContain(`'${s}'`);
    }
  });

  it("is verified by a read-only file", () => {
    expect(code(verify)).not.toMatch(/\b(insert|update|delete|alter|create|drop|grant|revoke|perform)\b/i);
    expect(verify).toContain("other_department");
  });
});
