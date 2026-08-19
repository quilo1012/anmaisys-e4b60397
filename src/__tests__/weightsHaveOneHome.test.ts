import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_WEIGHTS, GATE_CAP } from "@/lib/leaderScore";

/**
 * The three weights live in three places, and only two of them are kept in step.
 *
 * `leader_score_weights` is the row the screen edits. A trigger versions it into
 * `leader_scorecard_threshold` as W_Production / W_Quality / W_Documentation, and the
 * migration that introduces that table re-bases the editing row from the seeded values
 * — so those two cannot drift.
 *
 * The third is `DEFAULT_WEIGHTS` in the TypeScript, and nothing aligns it with
 * anything. It is what every scoring screen falls back to while the query is in
 * flight, so a fallback that disagrees with the database is a score that changes value
 * between the page opening and the table arriving. The comment on it already says to
 * keep it equal to the seed; this is that instruction, enforced.
 *
 * If this test fails, do not edit the expectation. Change whichever of the two is
 * wrong, and know that changing the seed re-scores every leader.
 */

const root = resolve(__dirname, "../..");
const MIGRATION = "supabase/migrations/20260818090000_a_gate_is_a_ceiling_not_a_weight.sql";

/** Reads `('W_Quality', 35.00, …)` or `('CAP_Gate', 49.00, …)` out of the seed's VALUES list. */
function seeded(sql: string, name: string): number {
  const m = new RegExp(`\\('${name}',\\s*([0-9.]+)`).exec(sql);
  if (!m) throw new Error(`${name} is not seeded in ${MIGRATION}`);
  return Number(m[1]);
}

describe("the three score weights", () => {
  const sql = readFileSync(resolve(root, MIGRATION), "utf8");

  it("has the TypeScript fallback equal to the database seed", () => {
    expect({
      production_pct: seeded(sql, "W_Production"),
      quality_pct: seeded(sql, "W_Quality"),
      documentation_pct: seeded(sql, "W_Documentation"),
    }).toEqual({
      production_pct: DEFAULT_WEIGHTS.production_pct,
      quality_pct: DEFAULT_WEIGHTS.quality_pct,
      documentation_pct: DEFAULT_WEIGHTS.documentation_pct,
    });
  });

  it("totals 100, which the database also refuses to accept otherwise", () => {
    const total = DEFAULT_WEIGHTS.production_pct + DEFAULT_WEIGHTS.quality_pct + DEFAULT_WEIGHTS.documentation_pct;
    expect(total).toBe(100);
  });
});

/**
 * The gate ceiling has the same two homes, and the same way of drifting.
 *
 * `CAP_Gate` is the seeded parameter the SQL scorecard applies to a week; `GATE_CAP` is
 * the constant the TypeScript score applies to a date range. They are two computations
 * of one management decision — what a gate leaves standing — over two grains, and the
 * day they disagree a leader's card and their weekly row say different things about the
 * same failed CCP.
 *
 * A test rather than a lookup, deliberately. `GATE_CAP` is used by plain functions
 * inside `computeLeaderScore`, and turning it into a query would put a loading state in
 * front of a ceiling — the one value that must never be absent while a score is drawn.
 * Pinning it is the cheaper half of the same guarantee: the number can still be changed,
 * but not in one place only.
 */
describe("the gate ceiling", () => {
  const sql = readFileSync(resolve(root, MIGRATION), "utf8");

  it("has the TypeScript constant equal to the seeded CAP_Gate", () => {
    expect(GATE_CAP).toBe(seeded(sql, "CAP_Gate"));
  });

  it("is a failing percentage, whatever it is set to", () => {
    // The one property that is not a matter of taste: a ceiling a leader could pass
    // under is not a ceiling. If somebody raises this above 50, that is the conversation
    // this line is asking them to have.
    expect(GATE_CAP).toBeLessThan(50);
  });
});
