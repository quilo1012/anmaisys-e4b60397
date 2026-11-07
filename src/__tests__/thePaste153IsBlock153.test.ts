import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** 07/11 (Q2): My Attendance reads the board's hours through my_board_marks. */
const root = resolve(__dirname, "../..");
const dir = resolve(root, "docs/apply-passo-3");
const read = (p: string) => readFileSync(p, "utf8");
const all = read(resolve(dir, "APPLY-ALL-IN-ORDER.sql"));
const paste = read(resolve(dir, "APLICAR-153-horas-do-board.sql"));
const migration = read(resolve(root, "supabase/migrations/20261107100000_my_attendance_reads_the_boards_hours.sql"));
const block = all.split(/\n(?=-- =+\n-- BLOCO \d+\n)/).find((b) => /^-- =+\n-- BLOCO 153\n/.test(b))!;
const code = (sql: string) => sql.split("\n").filter((l) => l.trim() && !l.trim().startsWith("--")).join("\n");

describe("BLOCO 153", () => {
  it("is the migration, and the paste carries it and adds only comments", () => {
    expect(block).toContain(migration.trimEnd());
    expect(paste).toContain(block.trimEnd());
    expect(code(paste.replace(block.trimEnd(), ""))).toBe("");
  });

  it("reads only the signed-in person's own rows, and writes nothing", () => {
    expect(code(migration)).toMatch(/v_emp := public\.my_employee_id\(\);/);
    expect(code(migration)).toMatch(/where b\.employee_id = v_emp/);
    expect(code(migration)).not.toMatch(/\b(insert|update|delete)\b/i);
    expect(code(migration)).not.toMatch(/create or replace function public\.my_attendance/);
  });

  it("is shut to anon", () => {
    expect(code(migration)).toMatch(/revoke all on function public\.my_board_marks\(date, date\) from public, anon;/);
    expect(code(migration)).toMatch(/grant execute on function public\.my_board_marks\(date, date\) to authenticated;/);
  });
});
