import { describe, it, expect } from "vitest";
import { resolveWeightsAt, chooseWeights, type WeightVersionRow } from "@/lib/leaderScoreWeights";
import { DEFAULT_WEIGHTS } from "@/lib/leaderScore";

/**
 * The rule this file exists to hold: a scorecard is scored on the weights that were in
 * force during the period it reports on, not the ones somebody typed in this morning.
 *
 * The database already guarantees it — 20260818090000 versions every save so that
 * "editing the weights in November cannot re-score July". The card read the
 * un-versioned editing row instead, so it re-scored July anyway, quietly, including
 * cards already printed and signed.
 */

const version = (name: string, value: number, valid_from: string, valid_to: string | null = null): WeightVersionRow =>
  ({ name, value, valid_from, valid_to });

/** July's decision, closed at the end of July; August's, still open. */
const twoVersions: WeightVersionRow[] = [
  version("W_Production", 40, "2000-01-01", "2026-07-31"),
  version("W_Quality", 30, "2000-01-01", "2026-07-31"),
  version("W_Documentation", 30, "2000-01-01", "2026-07-31"),
  version("W_Production", 40, "2026-08-01"),
  version("W_Quality", 35, "2026-08-01"),
  version("W_Documentation", 25, "2026-08-01"),
];

describe("resolveWeightsAt", () => {
  it("scores a July period on July's weights, not today's", () => {
    expect(resolveWeightsAt(twoVersions, "2026-07-15")).toEqual({
      production_pct: 40, quality_pct: 30, documentation_pct: 30,
    });
  });

  it("scores an August period on August's weights", () => {
    expect(resolveWeightsAt(twoVersions, "2026-08-17")).toEqual({
      production_pct: 40, quality_pct: 35, documentation_pct: 25,
    });
  });

  /**
   * `valid_to` is inclusive, the same reading `scorecard_weights_total_100` uses when
   * it probes `valid_to + 1` for the successor. Read as half-open, the changeover day
   * would resolve to two versions at once and score nothing at all.
   */
  it("treats the last day of a version as inside it", () => {
    expect(resolveWeightsAt(twoVersions, "2026-07-31")).toEqual({
      production_pct: 40, quality_pct: 30, documentation_pct: 30,
    });
  });

  it("refuses a date where two versions overlap", () => {
    const overlapping = [...twoVersions, version("W_Quality", 50, "2000-01-01")];
    expect(resolveWeightsAt(overlapping, "2026-08-17")).toBeNull();
  });

  it("refuses a date no version covers", () => {
    expect(resolveWeightsAt(twoVersions, "1999-12-31")).toBeNull();
  });

  it("refuses a partially re-weighted table that does not total 100", () => {
    const broken = [
      version("W_Production", 40, "2026-08-01"),
      version("W_Quality", 35, "2026-08-01"),
      version("W_Documentation", 20, "2026-08-01"),
    ];
    // 95 points of weight would inflate all three components rather than fail loudly.
    expect(resolveWeightsAt(broken, "2026-08-17")).toBeNull();
  });

  it("accepts fractional weights that total 100", () => {
    const thirds = [
      version("W_Production", 33.34, "2026-08-01"),
      version("W_Quality", 33.33, "2026-08-01"),
      version("W_Documentation", 33.33, "2026-08-01"),
    ];
    expect(resolveWeightsAt(thirds, "2026-08-17")).not.toBeNull();
  });

  it("reads numeric columns that arrive as strings", () => {
    const asText = [
      { name: "W_Production", value: "40.00", valid_from: "2026-08-01", valid_to: null },
      { name: "W_Quality", value: "35.00", valid_from: "2026-08-01", valid_to: null },
      { name: "W_Documentation", value: "25.00", valid_from: "2026-08-01", valid_to: null },
    ];
    expect(resolveWeightsAt(asText, "2026-08-17")).toEqual({
      production_pct: 40, quality_pct: 35, documentation_pct: 25,
    });
  });
});

describe("chooseWeights", () => {
  const editing = { production_pct: 20, quality_pct: 50, documentation_pct: 30 };

  it("prefers the versioned decision over the editing row", () => {
    expect(chooseWeights(twoVersions, editing, "2026-08-17")).toEqual({
      production_pct: 40, quality_pct: 35, documentation_pct: 25,
    });
  });

  /**
   * The state of production on 17/08/2026: 20260818090000 has not been applied, so
   * there are no W_* rows to resolve and the editing surface is the only answer there
   * is. The card must keep working, on the value the factory is actually using.
   */
  it("falls back to the editing row when the versioned table has no weights yet", () => {
    expect(chooseWeights([], editing, "2026-08-17")).toEqual(editing);
  });

  it("falls back to the editing row rather than scoring on a broken version set", () => {
    const broken = [version("W_Production", 40, "2026-08-01")];
    expect(chooseWeights(broken, editing, "2026-08-17")).toEqual(editing);
  });

  it("falls back to the built-in defaults when neither source can answer", () => {
    expect(chooseWeights(null, null, "2026-08-17")).toEqual(DEFAULT_WEIGHTS);
  });
});
