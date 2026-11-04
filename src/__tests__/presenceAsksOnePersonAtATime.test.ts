import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * 04/11/2026: `communication_presence_for → 500 (57014)` on a maintenance manager's Hub.
 * communication_can_view_presence asked `exists (… chat_contactable_people() …)` per
 * person, and that function builds the caller's whole contact list — so a Hub of N people
 * built it N times. 400 profiles locally: 31.9 s, against 83 ms asking chat_may_start for
 * the one person. Same answer on 2000 (caller, target) pairs across five roles.
 *
 * `20261104120000` is BLOCO 144; `APLICAR-144-…` is the one-block paste and `VERIFY-144-…`
 * the read-only check.
 */
const root = resolve(__dirname, "../..");
const dir = resolve(root, "docs/apply-passo-3");
const read = (p: string) => readFileSync(p, "utf8");
const all = read(resolve(dir, "APPLY-ALL-IN-ORDER.sql"));
const paste = read(resolve(dir, "APLICAR-144-presenca-sem-timeout.sql"));
const verify = read(resolve(dir, "VERIFY-144-presenca-sem-timeout.sql"));
const migration = read(resolve(root, "supabase/migrations/20261104120000_presence_asks_the_rule_per_person_not_the_whole_list.sql"));

const block144 = all
  .split(/\n(?=-- =+\n-- BLOCO \d+\n)/)
  .find((b) => /^-- =+\n-- BLOCO 144\n/.test(b))!;

const code = (sql: string) =>
  sql.split("\n").filter((l) => l.trim() && !l.trim().startsWith("--")).join("\n");

describe("APLICAR-144 is BLOCO 144 and nothing else", () => {
  it("BLOCO 144 is the migration", () => {
    expect(block144).toBeTruthy();
    expect(block144).toContain(migration.trimEnd());
  });

  it("carries the block byte for byte and adds only comments", () => {
    expect(paste).toContain(block144.trimEnd());
    expect(code(paste.replace(block144.trimEnd(), ""))).toBe("");
  });

  it("VERIFY-144 reads the definition in force", () => {
    expect(verify).toMatch(/pg_get_functiondef\('public\.communication_can_view_presence\(uuid\)'::regprocedure\)/);
  });
});

describe("can_view_presence asks about one person", () => {
  const body = code(migration);

  it("never builds the whole contact list", () => {
    expect(body).not.toMatch(/chat_contactable_people/);
  });

  it("asks what chat_contactable_people's own WHERE asks, for that person", () => {
    expect(body).toMatch(/public\.chat_may_start\(auth\.uid\(\), p_target\)/);
    expect(body).toMatch(/public\.my_supervisor\(\) s where s\.user_id = p_target/);
  });

  it("keeps the other ways in: yourself, a DM, a shared group", () => {
    expect(body).toMatch(/p_target = auth\.uid\(\)/);
    expect(body).toMatch(/public\.direct_messages d/);
    expect(body).toMatch(/public\.chat_is_member\(auth\.uid\(\), m\.group_id\)/);
  });
});
