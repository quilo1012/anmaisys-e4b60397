import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Critical 1 of the fix-wave review: `actionPoints()` reads `action.domain`, and four
 * queries fetched explicit column lists that omitted it — so a safety row arrived with
 * `domain: undefined`, which is not `"safety"`, and priced like a quality one. The bug
 * was invisible to every pure-function test in this repo, because none of them touch
 * a Supabase query: `actionPoints` itself was always correct, it just never received
 * the column that tells it what a row is.
 *
 * This is the layer those tests could not reach. It does not mock Supabase — it reads
 * the actual source of each query and asserts the column list still names `domain`,
 * so that deleting it from a `.select(...)` call breaks a test immediately instead of
 * silently pricing safety rows again.
 */

const root = resolve(__dirname, "../..");
const read = (relPath: string) => readFileSync(resolve(root, relPath), "utf8");

/** Find the column list a query near `marker` asks for — quoted so a rename that
 *  drops or reorders columns still trips this, rather than an exact-string match
 *  that would tolerate any edit as long as it kept `domain` somewhere in the file.
 *
 *  It used to take the first quoted string after `.select(`, which assumed the list is
 *  always a literal sitting inside the call. LeaderScorecard.tsx now passes it through
 *  a named constant, because it retries without `domain` when the column has not been
 *  migrated yet and the two lists must not be able to drift apart. Under the old rule
 *  that read `.select(columns)` and then grabbed `"leader_name"` from the next filter.
 *
 *  So: scan forward for the first quoted string that actually looks like a column list,
 *  identified by `recorded_at` — every query here selects it. That skips identifiers
 *  and filter arguments while keeping the teeth: delete `domain` from the list and this
 *  still fails, wherever the list is written. */
function selectCallContaining(source: string, marker: string): string {
  const idx = source.indexOf(marker);
  if (idx === -1) throw new Error(`Marker not found: ${marker}`);
  const window = source.slice(Math.max(0, idx - 1500), idx + 3000);
  const list = window.match(/"([^"]*\brecorded_at\b[^"]*)"/);
  if (!list) throw new Error(`No column list found near marker: ${marker}`);
  return list[1];
}

describe("quality_actions selects that feed actionPoints()/standsAgainstLeader() carry domain", () => {
  it("LeaderScorecard.tsx", () => {
    const src = read("src/components/LeaderScorecard.tsx");
    const cols = selectCallContaining(src, 'from("quality_actions")');
    expect(cols.split(",").map((c) => c.trim())).toContain("domain");
  });

  it("AnalyticsPage.tsx — the leader period-actions query", () => {
    const src = read("src/pages/dashboard/AnalyticsPage.tsx");
    const cols = selectCallContaining(src, "analytics-leader-period-actions");
    expect(cols.split(",").map((c) => c.trim())).toContain("domain");
  });

  it("ControlCentreHome.tsx", () => {
    const src = read("src/components/ControlCentreHome.tsx");
    const cols = selectCallContaining(src, "cc_quality_open");
    expect(cols.split(",").map((c) => c.trim())).toContain("domain");
  });

  it("LineIndicators.tsx", () => {
    const src = read("src/components/production/LineIndicators.tsx");
    const cols = selectCallContaining(src, "line-ind-quality");
    expect(cols.split(",").map((c) => c.trim())).toContain("domain");
  });
});
