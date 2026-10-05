import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The two ends of the scorecard have to ask for the same columns.
 *
 * `LeaderScorecardBody` is rendered from two fetch paths — the manager reads
 * `quality_actions` directly, the leader's tablet gets its rows from the SECURITY
 * DEFINER function `leader_self_scorecard` — and the whole point of computing the card
 * in one place is that the two cannot show a different number for the same person.
 *
 * They have drifted twice, both times silently, because a missing column arrives as
 * `undefined` and every predicate in this codebase reads `undefined` as "no reason to
 * exclude":
 *
 *   - `domain` reached the manager's select in August and the projection not at all,
 *     so a lost-time injury never fired the ceiling on the tablet.
 *   - `classification` is in the manager's select today and NOT in the live function.
 *     `belongsToProduction` keeps a row whose verdict is undefined, so the tablet
 *     would count findings the manager's card drops. It changes no figure only
 *     because no `excluded` row currently carries a leader_name.
 *   - `root_cause_area`, found on 04/10/2026 and the third time round. 77 actions
 *     with a leader carry a cause that is not charged to them. The TOTAL was right
 *     — all 77 froze at 0 and `actionPoints` prefers the frozen figure — so what
 *     drifted was the REASON: `livePoints` recomputed 4 without the column, the two
 *     figures differed, and `pointsBreakdown` fell into its "frozen" branch and told
 *     the leader a price scale had changed. The manager's card, one column richer,
 *     said "root cause is Office, so this is not charged to the leader".
 *
 * So the check is static and on both artefacts at once: whatever the manager asks for,
 * the function has to project, or a migration in this repo has to be adding it.
 *
 * What it CANNOT see, and what found all three of these: the live function. Nothing
 * here applies migrations, so a column named by a migration file is a column somebody
 * INTENDED to project — `20260908170000` has been in this directory since September
 * and `qa.classification` was still absent from `pg_get_functiondef` on 04/10. Read
 * the function off the database before believing this test about production.
 */

const root = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");

/** The manager's column list — the constant, not the retry that trims it. */
function managerColumns(): string[] {
  const src = read("src/components/LeaderScorecard.tsx");
  const list = src.match(/"([^"]*\brecorded_at\b[^"]*)"/);
  if (!list) throw new Error("No column list found in LeaderScorecard.tsx");
  return list[1].split(",").map((c) => c.trim()).filter(Boolean);
}

/** Everything the migrations ever teach the function to project, as `qa.<col>`. */
function projectedByMigrations(): Set<string> {
  const dir = resolve(root, "supabase/migrations");
  const out = new Set<string>();
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".sql")) continue;
    const sql = readFileSync(resolve(dir, f), "utf8");
    if (!sql.includes("leader_self_scorecard")) continue;
    for (const m of sql.matchAll(/\bqa\.([a-z_]+)/g)) out.add(m[1]);
  }
  return out;
}

/**
 * The columns a difference in would change what the card SAYS or COUNTS.
 *
 * Not every column: the manager's select carries a few the projection has never
 * needed. These are the ones a predicate reads, plus the ones a row is named and
 * referenced by — the fields whose absence is invisible rather than loud.
 */
const MUST_MATCH = [
  "domain", "safety_kind", "severity", "labels", "validation_status",
  "points_at_creation", "classification", "title", "error_type", "action_no", "source",
  // Voids the charge outright, and `countsAgainstLeaderRootCause` reads an absent
  // cause as "nobody else's, so the leader's" — the loudest of the three absences.
  "root_cause_area",
];

describe("the manager's card and the leader's tablet ask for the same row", () => {
  const manager = managerColumns();
  const projected = projectedByMigrations();

  it.each(MUST_MATCH)("the manager's select asks for %s", (col) => {
    expect(manager).toContain(col);
  });

  it.each(MUST_MATCH)("a migration teaches leader_self_scorecard to project %s", (col) => {
    expect(projected.has(col)).toBe(true);
  });
});
