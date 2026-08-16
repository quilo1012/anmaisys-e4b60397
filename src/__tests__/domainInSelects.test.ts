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

/** Find a `.select("...")` call by a substring near it — quoted so a rename that
 *  drops or reorders columns still trips this, rather than an exact-string match
 *  that would tolerate any edit as long as it kept `domain` somewhere in the file. */
function selectCallContaining(source: string, marker: string): string {
  const idx = source.indexOf(marker);
  if (idx === -1) throw new Error(`Marker not found: ${marker}`);
  const selectStart = source.indexOf(".select(", idx);
  if (selectStart === -1 || selectStart - idx > 1500) {
    throw new Error(`No .select(...) found near marker: ${marker}`);
  }
  const openQuote = source.indexOf('"', selectStart);
  const closeQuote = source.indexOf('"', openQuote + 1);
  return source.slice(openQuote + 1, closeQuote);
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
