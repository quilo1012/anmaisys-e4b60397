import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A leader created without lines is a leader with a scorecard that reads zero.
 *
 * `create_leader` and `update_leader` each existed twice — once taking `_lines text[]`
 * and once not. PostgREST resolves an overload from the argument names in the request
 * body, so the short pair was reachable: omit `_lines` and you get a leader assigned to
 * no lines, with no error, and a personal scorecard that can never show anything.
 *
 * That is not hypothetical. 20260906090000 exists because Gill, Liana and Muriel had
 * exactly that shape from the other direction — `lines` holding a value production had
 * never heard of — and nobody noticed for months, because an empty scorecard looks like
 * a quiet week.
 *
 * So the short pair is dropped, and this holds the call sites to passing `_lines`. With
 * the overload gone, omitting it is a 404 from PostgREST rather than a silent nothing.
 */

const SRC = resolve(__dirname, "..");
const MIGRATION_DIR = resolve(SRC, "..", "supabase/migrations");

const migration = () => {
  const file = readdirSync(MIGRATION_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .reverse()
    .find((f) => /DROP FUNCTION IF EXISTS public\.create_leader/.test(readFileSync(resolve(MIGRATION_DIR, f), "utf8")));
  if (!file) throw new Error("No migration drops the short create_leader");
  return readFileSync(resolve(MIGRATION_DIR, file), "utf8");
};

describe("creating and updating a leader", () => {
  const sql = migration();
  const manageUsers = readFileSync(resolve(SRC, "pages/users/ManageUsers.tsx"), "utf8");

  it("drops the overloads that let _lines be omitted", () => {
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS public\.create_leader\(_name text, _pin text\)/);
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS public\.update_leader\(_id uuid, _name text, _active boolean, _pin text\)/);
  });

  it("keeps the long ones — this removes a trap, it does not remove the feature", () => {
    // Dropping by full signature, not by name. `DROP FUNCTION public.create_leader`
    // without arguments would be ambiguous, and a careless `CASCADE` would take both.
    expect(sql).not.toMatch(/DROP FUNCTION[^;]*create_leader[^;]*_lines/);
    expect(sql).not.toMatch(/DROP FUNCTION[^;]*CASCADE/i);
  });

  it("has every call site passing _lines", () => {
    // The other half of the contract: with the short overload gone, a call that omits
    // _lines stops working entirely. These are the two that must not.
    for (const rpc of ["create_leader", "update_leader"]) {
      const at = manageUsers.indexOf(`rpc("${rpc}"`);
      expect(at, `${rpc} is not called from ManageUsers`).toBeGreaterThan(-1);
      // The argument object, up to the closing of the call.
      const bloco = manageUsers.slice(at, manageUsers.indexOf("});", at));
      expect(bloco, `${rpc} must pass _lines`).toMatch(/_lines:/);
    }
  });

  it("does not drop line_leaders.line's counterpart, which still holds data", () => {
    // leader_pins.line has values for 12 of 25 leaders. A column with data in it is a
    // decision, not a tidy-up, and this migration is only the tidy-up half.
    expect(sql).toMatch(/ALTER TABLE public\.line_leaders DROP COLUMN IF EXISTS line/);
    expect(sql).not.toMatch(/ALTER TABLE public\.leader_pins DROP COLUMN/);
  });

  it("has no reader of line_leaders asking for the dropped column", () => {
    // Every select on that table in src/. If one starts naming `line`, dropping the
    // column turns it into a PostgREST 400 at runtime, and this is where it surfaces.
    const selects = [...manageUsers.matchAll(/from\("line_leaders"\)\s*\.select\("([^"]*)"/g)].map((m) => m[1]);
    for (const s of selects) {
      expect(s.split(",").map((c) => c.trim())).not.toContain("line");
    }
  });
});
