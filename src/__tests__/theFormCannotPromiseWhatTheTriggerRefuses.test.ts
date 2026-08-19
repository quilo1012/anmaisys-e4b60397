import { describe, it, expect, beforeEach } from "vitest";
import {
  logFormCharge,
  chargeSummary,
  setLabelPoints,
  setSeverityPoints,
  setExcludedDepartments,
} from "@/lib/qualityConstants";

/**
 * The sentence on the log form has to agree with what the database will freeze.
 *
 * `buildQualityActionPayload` deliberately does not write `points` — the value is
 * frozen server-side by `quality_action_freeze_points`, which calls `action_points_at`,
 * which since 20260827090000 returns 0 for an action booked to an excluded department.
 *
 * The live summary above the Save button did not know that. Pick Department =
 * Maintenance, grade it Critical, and the form said "Charged 4p — the Critical grade"
 * while the row it was about to write was frozen at 0. The screen and the database
 * disagreeing about the same action is the exact failure this module keeps having to
 * fix, and printing it on the screen where the action is CREATED is the worst place
 * for it: it is the one moment a person can still change what they are logging.
 */

const NOTHING_EXCLUDED = new Set<string>();
const WEIGHTS = { low: 1, medium: 2, high: 3, critical: 4 };

beforeEach(() => {
  setSeverityPoints(WEIGHTS);
  setLabelPoints({ "foreign body": 5, "batch code": 2 });
  setExcludedDepartments({ Maintenance: false, Production: true });
});

describe("logFormCharge, with the department in force", () => {
  it("charges nothing for a department that is charged to nobody", () => {
    const charge = logFormCharge(["Foreign Body"], NOTHING_EXCLUDED, undefined, "Maintenance");
    expect(charge.points).toBe(0);
    expect(charge.pricedByLabels).toBe(false);
  });

  it("names the department, so the sentence can say which one did it", () => {
    const charge = logFormCharge([], NOTHING_EXCLUDED, undefined, "Maintenance");
    expect(charge.chargedToNobody).toBe("Maintenance");
  });

  it("leaves the arithmetic alone for a department that charges", () => {
    const charge = logFormCharge(["Foreign Body"], NOTHING_EXCLUDED, undefined, "Production");
    expect(charge.points).toBe(5);
    expect(charge.pricedByLabels).toBe(true);
    expect(charge.chargedToNobody).toBeNull();
  });

  it("leaves the arithmetic alone when no department is picked yet", () => {
    // The form starts blank and the sentence renders immediately. A blank department
    // must read as "not decided", never as "charged to nobody".
    const charge = logFormCharge(["Foreign Body"], NOTHING_EXCLUDED, undefined, "");
    expect(charge.points).toBe(5);
    expect(charge.chargedToNobody).toBeNull();
  });

  it("matches the department trimmed and case-folded", () => {
    expect(logFormCharge([], NOTHING_EXCLUDED, undefined, "  MAINTENANCE ").chargedToNobody)
      .toBe("MAINTENANCE");
  });
});

describe("chargeSummary says the department vetoed it, before anything else", () => {
  it("does not print a grade the action will not be charged", () => {
    // The regression, stated as the number: Critical is worth 4 and this must not say 4.
    const charge = logFormCharge([], NOTHING_EXCLUDED, undefined, "Maintenance");
    const summary = chargeSummary(charge, "critical");
    expect(summary).not.toMatch(/4p/);
    expect(summary).toMatch(/Maintenance/);
    expect(summary).toMatch(/0p/);
  });

  it("does not print a label price the action will not be charged", () => {
    const charge = logFormCharge(["Foreign Body"], NOTHING_EXCLUDED, undefined, "Maintenance");
    expect(chargeSummary(charge, null)).not.toMatch(/5p/);
  });

  it("still prints the grade when the department charges", () => {
    const charge = logFormCharge([], NOTHING_EXCLUDED, undefined, "Production");
    expect(chargeSummary(charge, "critical")).toMatch(/4p/);
  });

  it("is unchanged for a form that never picked a department", () => {
    const charge = logFormCharge(["Foreign Body"], NOTHING_EXCLUDED);
    expect(chargeSummary(charge, "low")).toMatch(/5p/);
  });
});
