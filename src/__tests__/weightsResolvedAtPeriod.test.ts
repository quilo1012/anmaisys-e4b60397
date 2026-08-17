import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Every screen that SCORES a leader must resolve the weights at the period it reports
 * on. The editing screen must not.
 *
 * The database versions each save so that "editing the weights in November cannot
 * re-score July" (20260818090000). Three screens compute a leader's score in
 * TypeScript, and all three read the weights through this one hook. A single one of
 * them calling it without a date is enough to break the promise — and to make two
 * screens disagree about the same person, which is the failure `computeScorecard`
 * exists as one shared function to prevent.
 *
 * A source-level test because the defect is a missing argument, not a wrong value: it
 * type-checks, it runs, and it produces a plausible number. Nothing at runtime
 * distinguishes "scored on August's weights" from "scored on today's" until somebody
 * re-weights the score and every archived card quietly changes.
 */

const SRC = join(process.cwd(), "src");

/** Screens whose figures are a leader's score. */
const SCORING = [
  "components/LeaderScorecard.tsx",
  "pages/dashboard/LeaderMyScorecardPage.tsx",
  "pages/dashboard/AnalyticsPage.tsx",
];

/**
 * The weights-editing form. It asks what the weights ARE, so a date would be wrong
 * here — it would show the editor a past decision and then save over the present one.
 */
const EDITING = "pages/dashboard/QualityActionsPage.tsx";

const callsIn = (file: string) =>
  Array.from(readFileSync(join(SRC, file), "utf8").matchAll(/useLeaderScoreWeights\(([^)]*)\)/g))
    .map((m) => m[1].trim());

describe("the weights a leader is scored on", () => {
  for (const file of SCORING) {
    it(`${file} resolves them at the period it reports on`, () => {
      const args = callsIn(file);
      expect(args.length, `${file} no longer calls useLeaderScoreWeights`).toBeGreaterThan(0);
      for (const a of args) {
        expect(
          a,
          `${file} scores a leader on today's weights — re-weighting would re-score every archived card`,
        ).not.toBe("");
      }
    });
  }

  it("the editing form still asks for the weights as they are now", () => {
    const args = callsIn(EDITING);
    expect(args.length).toBeGreaterThan(0);
    expect(args).toContain("");
  });
});
