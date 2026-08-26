import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describeError } from "@/lib/queryErrors";

/**
 * A leader's line is matched by NAME, and a name that matches nothing fails silently.
 *
 * `leader_self_scorecard()` filters production, RAG and quality by `leader_pins.lines`,
 * a `text[]` with no foreign key behind it. On 26/08/2026 four rows held
 * 'Capsules & Tablets' — a string that appears in no line catalogue and no production
 * table. Gill, Liana and Muriel had been appraised against a card that read zero
 * sessions, zero RAG rows and zero quality actions, while their work sat in the database
 * under 'Tablet Line' and 'Capsules Machine 1'.
 *
 * Nothing errored, which is the whole problem: a line name that matches nothing returns
 * an empty set, not a failure. 20260906090000 expands the alias and adds the trigger
 * that refuses the next one.
 *
 * This test pins the two halves that can be checked without a database, and the one
 * thing that ties the trigger to the screen: the error code it raises has to be the code
 * the app passes through, or the person editing a leader sees "Something did not load"
 * instead of being told which line does not exist.
 */

const MIGRATION_DIR = resolve(__dirname, "../..", "supabase/migrations");
const DEFINES = /leader_pins_lines_must_exist/;

const migration = () => {
  const file = readdirSync(MIGRATION_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .reverse()
    .find((f) => DEFINES.test(readFileSync(resolve(MIGRATION_DIR, f), "utf8")));
  if (!file) throw new Error("No migration defines leader_pins_lines_must_exist");
  return readFileSync(resolve(MIGRATION_DIR, file), "utf8");
};

describe("the leader line alias", () => {
  const sql = migration();

  it("is expanded into the three lines the group names", () => {
    expect(sql).toMatch(/array_remove\(\s*p\.lines,\s*'Capsules & Tablets'\s*\)/);
    for (const line of ["Capsules Machine 1", "Capsules Machine 2", "Tablet Line"]) {
      expect(sql).toContain(`'${line}'`);
    }
  });

  it("leaves GEL Line out of it — it is neither capsules nor tablets", () => {
    // Guarding the judgement, not the syntax. Adding GEL Line would hand three leaders
    // a fourth line they have never run, and quietly move Josiel's sessions onto their
    // cards.
    const expansion = sql.slice(sql.indexOf("array_remove"), sql.indexOf("AS sub"));
    expect(expansion).not.toContain("GEL");
  });

  it("targets the value rather than a list of leader ids", () => {
    // Four rows today. Written against the string, the same migration is still correct
    // if a fifth was typed while this sat in review.
    expect(sql).toMatch(/WHERE\s+'Capsules & Tablets'\s*=\s*ANY\(p\.lines\)/);
    expect(sql).not.toMatch(/id\s+IN\s*\(\s*'[0-9a-f]{8}-/i);
  });

  it("deduplicates, so JULIANO does not end up with two Tablet Lines", () => {
    expect(sql).toMatch(/array_agg\(DISTINCT/i);
  });

  it("refuses a line that is not in the catalogue, on write", () => {
    expect(sql).toMatch(/CREATE TRIGGER trg_leader_pins_lines_must_exist/);
    expect(sql).toMatch(/BEFORE INSERT OR UPDATE OF lines ON public\.leader_pins/);
    expect(sql).toMatch(/NOT EXISTS \(SELECT 1 FROM public\.lines l WHERE l\.name = v\)/);
  });

  it("lets an empty assignment through rather than treating it as an error", () => {
    // A leader with no lines yet is a normal intermediate state in the edit form.
    expect(sql).toMatch(/cardinality\(NEW\.lines\) = 0/);
  });

  it("raises P0001, the code the app shows verbatim to the person editing", () => {
    expect(sql).toMatch(/ERRCODE = 'P0001'/);
    // The other half of that contract, so this cannot rot from the app's side: a P0001
    // is handed back untouched, which is what lets the trigger's own wording reach the
    // screen. If this flips, the trigger's message is replaced by a generic one.
    expect(describeError({ code: "P0001", message: "Estas linhas nao existem" })).toBeNull();
  });
});
