import { describe, it, expect, afterEach } from "vitest";
import { actionPoints, pointsBreakdown, setLabelPoints } from "@/lib/qualityConstants";

/**
 * Why a number needs to carry its own arithmetic.
 *
 * On 18/08 an action labelled "Batch code · Maintenance" read 5 points and Critical,
 * and nobody could say from the screen whether that 5 was Batch code 2 + Maintenance 3
 * with the attribution rule switched off, or Batch code priced at 5 on its own with
 * Maintenance correctly costing nothing. Same number, two completely different states
 * of the system — one a misconfiguration charging a leader for a machine failure, the
 * other working exactly as designed.
 *
 * A score somebody is measured on that cannot be audited from the screen it appears
 * on is not a score, it is a rumour. This is the arithmetic, in a form the detail
 * dialog can print and a test can hold.
 *
 * It must never disagree with `actionPoints` — that is the whole point, and the last
 * test here nails the two together over the cases that differ.
 */

const EXCLUDED = new Set(["maintenance"]);
const action = (labels: string[], over: Record<string, unknown> = {}) => ({
  severity: "critical" as string | null,
  labels,
  validation_status: "open" as string | null,
  domain: "quality" as string | null,
  ...over,
});

afterEach(() => setLabelPoints({}));

describe("pointsBreakdown", () => {
  it("names each label that priced the action, and adds them up", () => {
    setLabelPoints({ "batch code": 2, "foreign body": 5 });
    const b = pointsBreakdown(action(["Batch code", "Foreign Body"]), EXCLUDED);
    expect(b.points).toBe(7);
    expect(b.basis).toBe("labels");
    expect(b.charged).toEqual([{ label: "Batch code", points: 2 }, { label: "Foreign Body", points: 5 }]);
    expect(b.explanation).toBe("7 points — Batch code 2 + Foreign Body 5.");
  });

  it("shows what the exclusion took off, not just the total", () => {
    // The case that started this. Without naming Maintenance and its 3, a leader
    // reading 2 has no way to know the rule fired — or that it exists.
    setLabelPoints({ "batch code": 2, maintenance: 3 });
    const b = pointsBreakdown(action(["Batch code", "Maintenance"]), EXCLUDED);
    expect(b.points).toBe(2);
    expect(b.spared).toEqual([{ label: "Maintenance", points: 3 }]);
    expect(b.explanation).toBe(
      "2 points — Batch code 2. Maintenance is not the leader's, so its 3 is not charged.",
    );
  });

  it("says when the grade paid, because no label carried a price", () => {
    const b = pointsBreakdown(action(["Batch code"]), EXCLUDED);
    expect(b.points).toBe(4);
    expect(b.basis).toBe("severity");
    expect(b.explanation).toBe("4 points from the Critical grade — no label here carries a price.");
  });

  it("says an excluded price fell through to the grade rather than hiding it", () => {
    // The trap in `actionPoints`: Maintenance's 3 is skipped, nothing else is priced,
    // so the severity pays in full and the exclusion changes the total by nothing.
    // Documented and accepted — but it has to be VISIBLE, or it reads as the rule
    // failing silently.
    setLabelPoints({ maintenance: 3 });
    const b = pointsBreakdown(action(["Batch code", "Maintenance"]), EXCLUDED);
    expect(b.points).toBe(4);
    expect(b.basis).toBe("severity");
    expect(b.explanation).toBe(
      "4 points from the Critical grade — no label here carries a price. " +
      "Maintenance is not the leader's, so its 3 is not charged.",
    );
  });

  it("explains the three ways an action costs nothing, differently", () => {
    setLabelPoints({ "foreign body": 5, maintenance: 3 });
    expect(pointsBreakdown(action(["Foreign Body"], { domain: "safety" }), EXCLUDED).explanation)
      .toBe("Safety is counted, never charged — reporting it costs the leader nothing.");
    expect(pointsBreakdown(action(["Foreign Body"], { validation_status: "rejected" }), EXCLUDED).explanation)
      .toBe("Quality rejected this — it is not charged.");
    expect(pointsBreakdown(action(["Maintenance"]), EXCLUDED).explanation)
      .toBe("Maintenance is not the leader's — this is not charged to them.");
  });

  it("is honest about an action nothing prices and nothing grades", () => {
    const b = pointsBreakdown(action(["Batch code"], { severity: null }), EXCLUDED);
    expect(b.points).toBe(0);
    expect(b.basis).toBe("unpriced");
    expect(b.explanation).toBe("No priced label and no grade — this scores 0.");
  });

  it("never disagrees with actionPoints, which is the number everyone is measured on", () => {
    setLabelPoints({ "batch code": 2, maintenance: 3, "foreign body": 5 });
    const cases = [
      action(["Batch code", "Maintenance"]),
      action(["Maintenance"]),
      action(["Foreign Body", "Batch code"]),
      action([]),
      action(["Batch code"], { severity: null }),
      action(["Foreign Body"], { validation_status: "rejected" }),
      action(["Foreign Body"], { domain: "safety" }),
      action(["Batch code"], { severity: "low" }),
    ];
    for (const a of cases) {
      expect(pointsBreakdown(a, EXCLUDED).points).toBe(actionPoints(a, EXCLUDED));
    }
  });
});
