import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Q70: the status log finds each machine's last state without walking the whole log. */
const root = resolve(__dirname, "../..");
const dir = resolve(root, "docs/apply-passo-3");
const read = (p: string) => readFileSync(p, "utf8");
const all = read(resolve(dir, "APPLY-ALL-IN-ORDER.sql"));
const paste = read(resolve(dir, "APLICAR-151-log-le-ultima-linha.sql"));
const migration = read(resolve(root, "supabase/migrations/20261106220000_status_log_reads_last_row.sql"));
const block = all.split(/\n(?=-- =+\n-- BLOCO \d+\n)/).find((b) => /^-- =+\n-- BLOCO 151\n/.test(b))!;
const code = (sql: string) => sql.split("\n").filter((l) => l.trim() && !l.trim().startsWith("--")).join("\n");

describe("BLOCO 151", () => {
  it("is the migration, and the paste carries it and adds only comments", () => {
    expect(block).toContain(migration.trimEnd());
    expect(paste).toContain(block.trimEnd());
    expect(code(paste.replace(block.trimEnd(), ""))).toBe("");
  });

  it("reads one row per machine, never the whole log", () => {
    expect(code(migration)).toMatch(/left join lateral \(/);
    expect(code(migration)).toMatch(/order by s\.changed_at desc\s+limit 1/);
    expect(code(migration)).not.toMatch(/distinct on/);
  });

  it("stays out of reach of anon and logged-in users", () => {
    expect(code(migration)).toMatch(/revoke all on function public\.log_intouch_status\(\) from public, anon, authenticated;/);
  });
});
