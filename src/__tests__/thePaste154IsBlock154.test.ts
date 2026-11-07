import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Q78/Q79: when each line last ran in each shift, read from the status log. */
const root = resolve(__dirname, "../..");
const dir = resolve(root, "docs/apply-passo-3");
const read = (p: string) => readFileSync(p, "utf8");
const all = read(resolve(dir, "APPLY-ALL-IN-ORDER.sql"));
const paste = read(resolve(dir, "APLICAR-154-quando-a-linha-correu.sql"));
const migration = read(resolve(root, "supabase/migrations/20261107210000_smart_target_shift_runs.sql"));
const block = all.split(/\n(?=-- =+\n-- BLOCO \d+\n)/).find((b) => /^-- =+\n-- BLOCO 154\n/.test(b))!;
const code = (sql: string) => sql.split("\n").filter((l) => l.trim() && !l.trim().startsWith("--")).join("\n");

describe("BLOCO 154", () => {
  it("is the migration, and the paste carries it and adds only comments", () => {
    expect(block).toContain(migration.trimEnd());
    expect(paste).toContain(block.trimEnd());
    expect(code(paste.replace(block.trimEnd(), ""))).toBe("");
  });

  it("only reads, under the log's own policy", () => {
    expect(code(migration)).toMatch(/language sql stable security invoker/);
    expect(code(migration)).not.toMatch(/\b(insert|update|delete|alter|drop)\b/i);
  });

  it("uses the factory's shift hours and the running states", () => {
    expect(code(migration)).toMatch(/time '06:00'/);
    expect(code(migration)).toMatch(/time '18:00'/);
    expect(code(migration)).toMatch(/at time zone 'Europe\/London'/);
    expect(code(migration)).toMatch(/g\.status in \(4, 8\)/);
  });

  it("keeps anon out", () => {
    expect(code(migration)).toMatch(/revoke all on function public\.smart_target_shift_runs\(date, date\) from public, anon;/);
  });
});
