import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * 10/11: each 60-second presence beat bumped communication_presence_changes, which is in
 * Realtime, so every open tab re-read the presence list on every other tab's beat.
 */
const root = resolve(__dirname, "../..");
const dir = resolve(root, "docs/apply-passo-3");
const read = (p: string) => readFileSync(p, "utf8");
const all = read(resolve(dir, "APPLY-ALL-IN-ORDER.sql"));
const paste = read(resolve(dir, "APLICAR-157-presenca-sem-marcador-a-cada-batida.sql"));
const migration = read(resolve(root, "supabase/migrations/20261110140000_presence_marker_only_when_someone_connects.sql"));
const block = all.split(/\n(?=-- =+\n-- BLOCO \d+\n)/).find((b) => /^-- =+\n-- BLOCO 157\n/.test(b))!;
const code = (sql: string) => sql.split("\n").filter((l) => l.trim() && !l.trim().startsWith("--")).join("\n");

describe("BLOCO 157", () => {
  it("is the migration, and the paste carries it and adds only comments", () => {
    expect(block).toContain(migration.trimEnd());
    expect(paste).toContain(block.trimEnd());
    expect(code(paste.replace(block.trimEnd(), ""))).toBe("");
  });

  it("writes the marker only when the user had no live lease", () => {
    const sql = code(migration);
    expect(sql).toMatch(/v_was_online := exists \(select 1 from public\.communication_connection_leases l where l\.user_id = v_me\);/);
    expect(sql).toMatch(/if not v_was_online then\s+insert into public\.communication_presence_changes/);
  });

  it("does not touch grants or any table", () => {
    const sql = code(migration);
    expect(sql).not.toMatch(/\b(grant|revoke|alter table|create table|drop)\b/i);
  });
});
