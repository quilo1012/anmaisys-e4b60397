import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** 26/11: Employee Announcements — targeted by department and shift, with a read report. */
const root = resolve(__dirname, "../..");
const dir = resolve(root, "docs/apply-passo-3");
const read = (p: string) => readFileSync(p, "utf8");
const all = read(resolve(dir, "APPLY-ALL-IN-ORDER.sql"));
const paste = read(resolve(dir, "APLICAR-164-comunicados-aos-funcionarios.sql"));
const migration = read(resolve(root, "supabase/migrations/20261126120000_employee_announcements.sql"));
const block = all.split(/\n(?=-- =+\n-- BLOCO \d+\n)/).find((b) => /^-- =+\n-- BLOCO 164\n/.test(b))!;
const code = (sql: string) => sql.split("\n").filter((l) => l.trim() && !l.trim().startsWith("--")).join("\n");

describe("BLOCO 164", () => {
  it("is the migration, and the paste carries it and adds only comments", () => {
    expect(block).toContain(migration.trimEnd());
    expect(paste).toContain(block.trimEnd());
    expect(code(paste.replace(block.trimEnd(), ""))).toBe("");
  });

  // Two publish_announcement side by side make every call that leaves out the schedule
  // ambiguous (PGRST203). The old one goes before the new one is made.
  it("drops the nine-argument publish_announcement before creating the ten-argument one", () => {
    const c = code(migration);
    const drop = c.indexOf("drop function if exists public.publish_announcement(text, text, text, text, text, boolean, boolean, timestamptz, text);");
    const create = c.indexOf("create or replace function public.publish_announcement(");
    expect(drop).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(drop);
  });

  it("keeps anon out of every function it grants, and the internal ones from everybody", () => {
    const c = code(migration);
    const granted = [...c.matchAll(/grant execute on function (public\.[a-z_]+\([^)]*\)) to authenticated;/g)].map((m) => m[1]);
    expect(granted.length).toBeGreaterThan(10);
    for (const fn of granted) expect(c).toContain(`revoke all on function ${fn} from public, anon;`);
    for (const fn of ["announcement_ring(uuid)", "announcement_report_rows(uuid)", "announcement_audience_for(text, text)", "announcements_ring_due()"]) {
      expect(c).toContain(`revoke all on function public.${fn} from public, anon, authenticated;`);
      expect(c).not.toContain(`grant execute on function public.${fn} to authenticated;`);
    }
  });

  it("leaves the tables read-only to clients: every write goes through a function", () => {
    const c = code(migration);
    expect(c).toContain("grant select on public.announcements, public.announcement_reads to authenticated;");
    expect(c).not.toMatch(/grant (insert|update|delete)[^;]*public\.announcement/);
  });

  it("targets with the department and shift employees already carry, and creates no lookup table", () => {
    const c = code(migration);
    expect(c).toContain("lower(btrim(e.department)) = lower(btrim(p_department))");
    expect(c).toContain("lower(btrim(e.shift_group)) = lower(btrim(p_shift_group))");
    expect(c).not.toMatch(/create table[^(]*(department|shift)/i);
  });
});
