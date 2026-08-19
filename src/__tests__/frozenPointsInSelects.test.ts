import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * `actionPoints()` now reads `action.points_at_creation`, and a query that does not ask
 * for it gets `undefined` — which is not an error, not a warning, and not visible.
 *
 * This is the same shape of bug as `domain` in August, and it is worth being precise
 * about why it is so hard to see. The function is correct. Every pure-function test
 * passes. The screen renders a number. The number is simply computed against today's
 * scale instead of the scale of the action's day, which is exactly the behaviour the
 * freeze was built to end — so the feature would look shipped, and quietly not be.
 *
 * The four queries below are the ones whose rows reach `actionPoints`. They are the
 * same four that `domainInSelects.test.ts` guards, for the same reason, and the two
 * tests are deliberately separate: one column can be dropped without the other, and a
 * combined test would report a single failure for two different mistakes.
 *
 * The leader's own card is NOT here, because it is not a select — it is
 * `leader_self_scorecard`, whose projection is fixed in SQL. See
 * 20260822093000_the_leaders_own_card_reads_the_frozen_figure.sql.
 */

const root = resolve(__dirname, "../..");
const read = (relPath: string) => readFileSync(resolve(root, relPath), "utf8");

/** The column list a query near `marker` asks for — found by `recorded_at`, which every
 *  one of these selects carries. Same finder as domainInSelects.test.ts, and it earns
 *  its indirection there: two of these lists live in named constants rather than inside
 *  the `.select()` call. */
function selectCallContaining(source: string, marker: string): string {
  const idx = source.indexOf(marker);
  if (idx === -1) throw new Error(`Marker not found: ${marker}`);
  const window = source.slice(Math.max(0, idx - 1500), idx + 3000);
  const list = window.match(/"([^"]*\brecorded_at\b[^"]*)"/);
  if (!list) throw new Error(`No column list found near marker: ${marker}`);
  return list[1];
}

const SELECTS: Array<[name: string, file: string, marker: string]> = [
  ["LeaderScorecard.tsx", "src/components/LeaderScorecard.tsx", 'from("quality_actions")'],
  ["AnalyticsPage.tsx — the leader period-actions query", "src/pages/dashboard/AnalyticsPage.tsx", "analytics-leader-period-actions"],
  ["ControlCentreHome.tsx", "src/components/ControlCentreHome.tsx", "cc_quality_open"],
  ["LineIndicators.tsx", "src/components/production/LineIndicators.tsx", "line-ind-quality"],
];

describe("quality_actions selects that feed actionPoints() carry points_at_creation", () => {
  for (const [name, file, marker] of SELECTS) {
    it(name, () => {
      const cols = selectCallContaining(read(file), marker).split(",").map((c) => c.trim());
      expect(cols).toContain("points_at_creation");
    });
  }
});

describe("a database without the column still returns its log", () => {
  it("the retry drops points_at_creation as well as domain, in one go", () => {
    // PostgREST names one unknown column per error, so a retry that dropped only
    // `domain` would be refused a second time on a base that has neither — and the
    // screen would lose the whole log rather than one field, which is precisely what
    // this helper was written in August to stop happening.
    const src = read("src/lib/optionalDomain.ts");
    const list = src.match(/const OPTIONAL_COLUMNS = \[([^\]]*)\]/);
    expect(list).not.toBeNull();
    expect(list![1]).toMatch(/"domain"/);
    expect(list![1]).toMatch(/"points_at_creation"/);
  });
});
