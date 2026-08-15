import { describe, it, expect, afterEach } from "vitest";
import { actionPoints, sumActionPoints, setLabelPoints } from "@/lib/qualityConstants";
import { issueWeight } from "@/lib/qualityBreakdown";

/**
 * What a label is worth.
 *
 * Severity answers "how bad is this in general". A label answers "how bad is THIS
 * problem here" — a foreign body is not a paperwork slip, however either one is
 * graded. So when the labels on an action carry a weight, that weight is the charge
 * and the severity steps aside. When they do not, nothing changes: severity, as
 * before, which is why every label ships at 0.
 *
 * The awkward case is a label Quality has excluded from the leader's account. Its
 * points do not count either — otherwise "Maintenance is not the leader's" would be
 * true of the attribution rule and false of the score, and the exclusion would leak
 * back in through the points.
 */

/** Quality has marked Maintenance as not the leader's to answer for. */
const EXCLUDED = new Set(["maintenance"]);

const critical = (labels: string[]) => ({
  severity: "critical", labels, validation_status: "open" as string | null,
});

afterEach(() => setLabelPoints({}));

describe("label points", () => {
  it("no label carries points — the action is worth its severity", () => {
    // The state every label ships in, so the migration changes nobody's score.
    expect(actionPoints(critical(["Foreign Body"]), EXCLUDED)).toBe(4);
    expect(actionPoints(critical([]), EXCLUDED)).toBe(4);
  });

  it("a label with points replaces the severity, up or down", () => {
    setLabelPoints({ "foreign body": 5, paperwork: 2 });
    expect(actionPoints(critical(["Foreign Body"]), EXCLUDED)).toBe(5);
    // Down as well as up: a Critical paperwork slip is worth what paperwork is worth.
    expect(actionPoints(critical(["Paperwork"]), EXCLUDED)).toBe(2);
  });

  it("several priced labels add up", () => {
    setLabelPoints({ "foreign body": 5, paperwork: 2 });
    expect(actionPoints(critical(["Foreign Body", "Paperwork"]), EXCLUDED)).toBe(7);
  });

  it("an unpriced label alongside a priced one adds nothing", () => {
    // Zero means "this label does not price the action", not "this action is free".
    setLabelPoints({ "foreign body": 5, "batch code": 0 });
    expect(actionPoints(critical(["Foreign Body", "Batch code"]), EXCLUDED)).toBe(5);
  });

  it("the points of an excluded label are not charged either", () => {
    setLabelPoints({ "foreign body": 5, maintenance: 3 });
    // The machine's 3 stays off his account; the foreign body is still his.
    expect(actionPoints(critical(["Foreign Body", "Maintenance"]), EXCLUDED)).toBe(5);
  });

  it("an action priced only by an excluded label falls back to severity", () => {
    // It still counts — one attributable label (Batch code) makes it his — but the
    // only price on it was maintenance's, so there is no label price left to use.
    setLabelPoints({ maintenance: 3 });
    expect(actionPoints(critical(["Batch code", "Maintenance"]), EXCLUDED)).toBe(4);
  });

  it("nothing rescues an action that does not stand", () => {
    setLabelPoints({ "foreign body": 5, maintenance: 3 });
    expect(actionPoints({ ...critical(["Foreign Body"]), validation_status: "rejected" }, EXCLUDED)).toBe(0);
    expect(actionPoints(critical(["Maintenance"]), EXCLUDED)).toBe(0);
  });

  it("a recurring problem is priced the same way, but ignores attribution", () => {
    setLabelPoints({ "foreign body": 5, maintenance: 3 });
    // Same price as the log shows, so the two tables cannot disagree...
    expect(issueWeight([critical(["Foreign Body"])])).toBe(5);
    // ...but the maintenance fault that costs its leader nothing still weighs 3 here.
    // Hiding it would bury exactly the recurring machine faults this table is for.
    expect(actionPoints(critical(["Maintenance"]), EXCLUDED)).toBe(0);
    expect(issueWeight([critical(["Maintenance"])])).toBe(3);
    // Unpriced labels fall back to severity here too.
    expect(issueWeight([critical(["Batch code"])])).toBe(4);
  });

  it("changing a price re-scores the history — points are never stored", () => {
    const raised = [critical(["Foreign Body"]), critical(["Paperwork"])];
    setLabelPoints({ "foreign body": 5, paperwork: 2 });
    expect(sumActionPoints(raised, EXCLUDED)).toBe(7);
    setLabelPoints({ "foreign body": 9, paperwork: 2 });
    expect(sumActionPoints(raised, EXCLUDED)).toBe(11);
  });
});
