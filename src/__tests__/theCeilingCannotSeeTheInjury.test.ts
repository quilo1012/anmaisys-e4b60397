import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The H&S ceiling reads `safety_kind`, and nothing that reaches it ever asked for it.
 *
 * `computeLeaderScore` gates a period on `a.domain === 'safety' && a.safety_kind in
 * GATING_KINDS`. Every unit test of that gate passes, because every unit test hands the
 * function an object with `safety_kind` on it. The scorecard hands it rows from
 * PostgREST, and the column list in LeaderScorecard.tsx names `domain` and stops there —
 * so `safety_kind` arrives `undefined`, the condition is never true, and a leader whose
 * period holds a lost-time injury scores whatever the weighted sum came to.
 *
 * The comment above `LeaderScoreInput.actions` says these fields "were already
 * arriving". They were not. That sentence is the whole bug: it was written from the
 * unit tests, which are the one place they do arrive.
 *
 * Same shape as `domainInSelects.test.ts` and `frozenPointsInSelects.test.ts`, and
 * deliberately a third file rather than a line in either: one column can be dropped
 * without the others, and a combined test reports one failure for three mistakes.
 *
 * Only ONE select is guarded here, unlike those two. `safety_kind` exists to answer
 * "did somebody get hurt badly enough to cap the period", and the leader scorecard is
 * the only screen that asks. The other three selects feed `actionPoints`, which prices
 * every safety row at zero whatever kind it is, so the column would be dead weight in
 * their column lists — and a guard on a column nobody reads teaches people to add
 * columns to pass tests.
 */

const root = resolve(__dirname, "../..");
const read = (relPath: string) => readFileSync(resolve(root, relPath), "utf8");

/** Same finder as the two sibling tests: the column list is a named constant, so it is
 *  identified by `recorded_at` rather than by sitting inside the `.select()` call. */
function selectCallContaining(source: string, marker: string): string {
  const idx = source.indexOf(marker);
  if (idx === -1) throw new Error(`Marker not found: ${marker}`);
  const window = source.slice(Math.max(0, idx - 1500), idx + 3000);
  const list = window.match(/"([^"]*\brecorded_at\b[^"]*)"/);
  if (!list) throw new Error(`No column list found near marker: ${marker}`);
  return list[1];
}

describe("the select that feeds the H&S ceiling carries safety_kind", () => {
  it("LeaderScorecard.tsx", () => {
    const cols = selectCallContaining(read("src/components/LeaderScorecard.tsx"), 'from("quality_actions")')
      .split(",").map((c) => c.trim());
    expect(cols).toContain("safety_kind");
  });
});

describe("a database without the column still returns its log", () => {
  it("the retry drops safety_kind along with domain", () => {
    // `safety_kind` arrives in the SAME migration as `domain` —
    // 20260817090000_safety_shares_the_log_but_not_the_score.sql creates the enum, the
    // column and the CHECK in one go. So a base that lacks one lacks both, and
    // PostgREST names only ONE unknown column per error: a retry that dropped `domain`
    // alone would be refused a second time, and the card would lose the whole log
    // rather than one field. That is the August failure exactly, for a new reason.
    const list = read("src/lib/optionalDomain.ts").match(/const OPTIONAL_COLUMNS = \[([^\]]*)\]/);
    expect(list).not.toBeNull();
    expect(list![1]).toMatch(/"domain"/);
    expect(list![1]).toMatch(/"safety_kind"/);
  });
});

describe("the leader's own card is projected the same columns", () => {
  it("leader_self_scorecard selects domain and safety_kind", () => {
    // Not a `.select()` — a SECURITY DEFINER function whose projection is fixed in SQL,
    // so the tablet cannot be fixed by editing TypeScript. Without these two columns the
    // leader's own copy prices a safety row like a quality one AND cannot see the
    // ceiling, while the manager's copy of the same person, same period, does both.
    // A scorecard that shows two numbers for one person is the one thing it may not do.
    const src = read(
      "supabase/migrations/20260827113000_the_ceiling_cannot_see_the_injury.sql",
    );
    expect(src).toMatch(/qa\.domain/);
    expect(src).toMatch(/qa\.safety_kind/);
  });
});
