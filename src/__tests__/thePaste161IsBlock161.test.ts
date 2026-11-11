import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** 11/11: an optional reason when someone declines a meeting. */
const root = resolve(__dirname, "../..");
const dir = resolve(root, "docs/apply-passo-3");
const read = (p: string) => readFileSync(p, "utf8");
const all = read(resolve(dir, "APPLY-ALL-IN-ORDER.sql"));
const paste = read(resolve(dir, "APLICAR-161-motivo-ao-recusar-reuniao.sql"));
const migration = read(resolve(root, "supabase/migrations/20261111120000_meeting_decline_reason.sql"));
const block = all.split(/\n(?=-- =+\n-- BLOCO \d+\n)/).find((b) => /^-- =+\n-- BLOCO 161\n/.test(b))!;
const code = (sql: string) => sql.split("\n").filter((l) => l.trim() && !l.trim().startsWith("--")).join("\n");

describe("BLOCO 161", () => {
  it("is the migration, and the paste carries it and adds only comments", () => {
    expect(block).toContain(migration.trimEnd());
    expect(paste).toContain(block.trimEnd());
    expect(code(paste.replace(block.trimEnd(), ""))).toBe("");
  });

  it("comes straight after BLOCO 160 in the package", () => {
    expect(all.indexOf("\n-- BLOCO 161\n")).toBeGreaterThan(all.indexOf("\n-- BLOCO 160\n"));
  });

  // Two meeting_respond side by side make every three-argument call ambiguous (PGRST203),
  // the bell's included. The old one goes before the new one is made.
  it("drops the three-argument meeting_respond before creating the four-argument one", () => {
    const c = code(migration);
    const drop = c.indexOf("drop function if exists public.meeting_respond(uuid, text, text);");
    const create = c.indexOf("create or replace function public.meeting_respond(");
    expect(drop).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(drop);
    expect(c).toMatch(/p_reason\s+text default null/);
  });

  it("keeps anon out and the reason out of the column grant", () => {
    const c = code(migration);
    expect(c).toContain("revoke all on function public.meeting_respond(uuid, text, text, text) from public, anon;");
    expect(c).toContain("revoke all on function public.meeting_participant_list(uuid) from public, anon;");
    expect(c).not.toMatch(/grant update \([^)]*decline_reason/);
  });
});
