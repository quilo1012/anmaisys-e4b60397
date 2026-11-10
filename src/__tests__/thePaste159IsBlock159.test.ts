import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Roadmap Stage 3: meetings in the Communication Hub. */
const root = resolve(__dirname, "../..");
const dir = resolve(root, "docs/apply-passo-3");
const read = (p: string) => readFileSync(p, "utf8");
const all = read(resolve(dir, "APPLY-ALL-IN-ORDER.sql"));
const paste = read(resolve(dir, "APLICAR-159-reunioes.sql"));
const migration = read(resolve(root, "supabase/migrations/20261110200000_meetings_in_the_hub.sql"));
const block = all.split(/\n(?=-- =+\n-- BLOCO \d+\n)/).find((b) => /^-- =+\n-- BLOCO 159\n/.test(b))!;
const code = (sql: string) => sql.split("\n").filter((l) => l.trim() && !l.trim().startsWith("--")).join("\n");

describe("BLOCO 159", () => {
  it("is the migration, and the paste carries it and adds only comments", () => {
    expect(block).toContain(migration.trimEnd());
    expect(paste).toContain(block.trimEnd());
    expect(code(paste.replace(block.trimEnd(), ""))).toBe("");
  });

  // Was "is the last block": true only until BLOCO 160 was added after it.
  it("comes straight after BLOCO 158 in the package", () => {
    expect(all.indexOf("\n-- BLOCO 159\n")).toBeGreaterThan(all.indexOf("\n-- BLOCO 158\n"));
    expect(all.indexOf(migration.trimEnd())).toBeGreaterThan(all.indexOf("\n-- BLOCO 158\n"));
  });

  it("puts RLS on both tables and keeps anon out of every meeting function", () => {
    const c = code(migration);
    expect(c).toMatch(/alter table public\.meetings enable row level security;/);
    expect(c).toMatch(/alter table public\.meeting_participants enable row level security;/);
    const fns = [...c.matchAll(/create or replace function public\.(meeting_\w+)\(/g)].map((m) => m[1]);
    expect(fns.length).toBeGreaterThanOrEqual(10);
    for (const f of fns) expect(c, f).toMatch(new RegExp(`revoke all on function public\\.${f}\\([^)]*\\) from public, anon`));
  });

  it("deletes and updates no existing row outside its own tables", () => {
    const c = code(migration);
    expect(c).not.toMatch(/\bdrop table\b/i);
    expect(c).not.toMatch(/update public\.(?!meetings|meeting_participants)/i);
    expect(c).not.toMatch(/delete from public\.(?!notifications|meeting_participants)/i);
  });
});
