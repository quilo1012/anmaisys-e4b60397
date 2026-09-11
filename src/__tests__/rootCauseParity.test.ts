/**
 * One rule, written down twice.
 *
 * The root-cause veto exists in two places that can never be allowed to disagree:
 * `public.action_points_at` in the database, which freezes what an action cost at the
 * moment it was created, and `livePoints`/`standsAgainstLeader` here, which is what a
 * leader reads on screen today. If they part company, a scorecard shows one number and
 * the frozen history shows another for the same action, and nobody can say which is the
 * real one.
 *
 * These cases are the SQL's behaviour restated as TypeScript expectations. The SQL is:
 *
 *   IF _root_cause IS NOT NULL AND btrim(_root_cause) <> '' THEN
 *     SELECT counts_against_leader INTO _counts
 *       FROM public.quality_options
 *      WHERE kind = 'root_cause' AND lower(btrim(value)) = lower(btrim(_root_cause));
 *     IF _counts IS FALSE THEN RETURN 0; END IF;
 *   END IF;
 *   -- ...then the label arithmetic, exactly as before.
 *
 * Three properties have to hold on both sides, and each has a case below:
 *   1. an excluded root cause returns 0 BEFORE any label is priced;
 *   2. an attributable root cause changes nothing;
 *   3. a null or blank root cause changes nothing — which is what lets every row
 *      logged before the column existed keep the score it already has.
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  actionPoints,
  standsAgainstLeader,
  setLabelPoints,
  setRootCauseAttribution,
} from "@/lib/qualityConstants";

/** What the seed migration writes into `quality_options` for kind `root_cause`. */
const SEEDED = {
  Production: true,
  Quality: true,
  Maintenance: false,
  Warehouse: false,
  Engineering: false,
  Supplier: false,
  External: false,
};

/** The action this whole change was written for: Batch Code Printing Issue (L5). */
const EVERTON = {
  domain: "quality",
  severity: null as string | null,
  labels: ["Batch code", "Maintenance"],
  validation_status: "open" as string | null,
};

const NO_EXCLUDED_LABELS = new Set<string>();

afterEach(() => {
  setLabelPoints({});
  setRootCauseAttribution({});
});

describe("the root cause outranks the labels, in TypeScript as in SQL", () => {
  it("charges 0 when the root cause is another area's — a printer fault is not the leader's", () => {
    setLabelPoints({ "batch code": 5 });
    setRootCauseAttribution(SEEDED);
    expect(actionPoints({ ...EVERTON, root_cause_area: "Maintenance" }, NO_EXCLUDED_LABELS)).toBe(0);
    expect(standsAgainstLeader({ ...EVERTON, root_cause_area: "Maintenance" }, NO_EXCLUDED_LABELS)).toBe(false);
  });

  it("charges the labels in full when the root cause IS the leader's", () => {
    setLabelPoints({ "batch code": 5 });
    setRootCauseAttribution(SEEDED);
    expect(actionPoints({ ...EVERTON, root_cause_area: "Production" }, NO_EXCLUDED_LABELS)).toBe(5);
    expect(standsAgainstLeader({ ...EVERTON, root_cause_area: "Production" }, NO_EXCLUDED_LABELS)).toBe(true);
  });

  it("behaves exactly as it did before the column existed when nothing is established", () => {
    // The reason the column is nullable: no history moves.
    setLabelPoints({ "batch code": 5 });
    setRootCauseAttribution(SEEDED);
    const before = actionPoints(EVERTON, NO_EXCLUDED_LABELS);
    expect(before).toBe(5);
    expect(actionPoints({ ...EVERTON, root_cause_area: null }, NO_EXCLUDED_LABELS)).toBe(before);
    expect(actionPoints({ ...EVERTON, root_cause_area: "" }, NO_EXCLUDED_LABELS)).toBe(before);
    expect(actionPoints({ ...EVERTON, root_cause_area: "   " }, NO_EXCLUDED_LABELS)).toBe(before);
  });

  it("matches case-insensitively, because the SQL compares lower(btrim(...))", () => {
    setLabelPoints({ "batch code": 5 });
    setRootCauseAttribution(SEEDED);
    expect(actionPoints({ ...EVERTON, root_cause_area: " maintenance " }, NO_EXCLUDED_LABELS)).toBe(0);
  });

  it("returns 0 before the grade is priced too, not just the labels", () => {
    // The veto is ahead of ALL the arithmetic. A Critical grade outranks the labels
    // under MAX, so a veto applied after them would leak 4 points through.
    setRootCauseAttribution(SEEDED);
    expect(
      actionPoints({ domain: "quality", severity: "critical", labels: [], root_cause_area: "Maintenance" }, NO_EXCLUDED_LABELS),
    ).toBe(0);
  });

  it("charges as normal when the root cause is not one the database knows", () => {
    // The SQL's SELECT finds no row, `_counts` stays NULL, `IS FALSE` is false, and it
    // falls through. A typo must never quietly clear somebody's charge.
    setLabelPoints({ "batch code": 5 });
    setRootCauseAttribution(SEEDED);
    expect(actionPoints({ ...EVERTON, root_cause_area: "Gremlins" }, NO_EXCLUDED_LABELS)).toBe(5);
  });

  it("charges as normal before the attribution rows have loaded", () => {
    // Err high rather than flatter, the same way the label exclusions do: an empty map
    // means "we have not been told yet", and the screens that show a total gate on
    // `ready` rather than drawing an unfiltered figure that settles a moment later.
    setLabelPoints({ "batch code": 5 });
    expect(actionPoints({ ...EVERTON, root_cause_area: "Maintenance" }, NO_EXCLUDED_LABELS)).toBe(5);
  });
});
