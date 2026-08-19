import { describe, expect, it, afterEach } from "vitest";
import { buildQualityActionPayload, type QualityActionFormInput } from "@/lib/qualityActionPayload";
import { setLabelPoints, setSeverityPoints } from "@/lib/qualityConstants";

/**
 * Critical 3 of the fix-wave review: `leader_id` was hardcoded to `null` on insert,
 * so `scorecard_safety_counts` — which counts `WHERE leader_id = _leader_id` — could
 * never find a safety row, for any leader, ever. This is the payload the create
 * mutation now sends, extracted so that regression cannot come back unnoticed inside
 * a mutation nothing tests directly.
 */

const BASE_FORM: QualityActionFormInput = {
  action_no: "", line: "Line 3", shift: "DAY", leader_id: "leader-123", leader_name: "",
  date: "2026-08-16", sku: "", batch: "", department: "",
  severity: "", labels: [], description: "", domain: "safety", safety_kind: "near_miss",
  original_leader_id: null,
};

describe("buildQualityActionPayload", () => {
  it("persists leader_id, not just leader_name", () => {
    const payload = buildQualityActionPayload(BASE_FORM, "Marcio", "2026-08-16T12:00:00.000Z");
    expect(payload.leader_id).toBe("leader-123");
    expect(payload.leader_name).toBe("Marcio");
  });

  it("falls back to the form's own leader_name when no match was found", () => {
    const payload = buildQualityActionPayload({ ...BASE_FORM, leader_name: "Typed Name" }, null, "2026-08-16T12:00:00.000Z");
    expect(payload.leader_name).toBe("Typed Name");
  });

  it("writes safety_kind only on a safety row, always null on quality", () => {
    const safety = buildQualityActionPayload(BASE_FORM, "Marcio", "2026-08-16T12:00:00.000Z");
    expect(safety.safety_kind).toBe("near_miss");
    const quality = buildQualityActionPayload({ ...BASE_FORM, domain: "quality", safety_kind: "near_miss" }, "Marcio", "2026-08-16T12:00:00.000Z");
    expect(quality.safety_kind).toBeNull();
  });

  it("never writes points — the dead column nothing reads", () => {
    const payload = buildQualityActionPayload(BASE_FORM, "Marcio", "2026-08-16T12:00:00.000Z");
    expect(payload).not.toHaveProperty("points");
  });

  it("leaves leader_id null when the form never picked a leader", () => {
    const payload = buildQualityActionPayload({ ...BASE_FORM, leader_id: "" }, null, "2026-08-16T12:00:00.000Z");
    expect(payload.leader_id).toBeNull();
  });

  /**
   * Re-review finding: the edit path resolves `leader_id` by matching `leader_name`
   * against ACTIVE leaders only. A deactivated leader, or a stored name that no
   * longer matches any `line_leaders` row exactly, made `openEdit` hand back
   * `leader_id: ""` — which this function then wrote as `null`, silently dropping
   * an already-linked row out of `scorecard_safety_counts`. An edit to the
   * description must never change who the row belongs to.
   */
  it("keeps the row's stored leader_id when editing finds no active-leader match", () => {
    const payload = buildQualityActionPayload(
      { ...BASE_FORM, leader_id: "", leader_name: "Deactivated Leader", original_leader_id: "leader-999" },
      null,
      "2026-08-16T12:00:00.000Z",
    );
    expect(payload.leader_id).toBe("leader-999");
  });

  it("an explicit pick of a different leader still wins over the stored id", () => {
    const payload = buildQualityActionPayload(
      { ...BASE_FORM, leader_id: "leader-new", original_leader_id: "leader-999" },
      "New Leader",
      "2026-08-16T12:00:00.000Z",
    );
    expect(payload.leader_id).toBe("leader-new");
  });

  it("a brand-new insert with no leader and no stored id still writes null", () => {
    const payload = buildQualityActionPayload(
      { ...BASE_FORM, leader_id: "", original_leader_id: null },
      null,
      "2026-08-16T12:00:00.000Z",
    );
    expect(payload.leader_id).toBeNull();
  });
});

/**
 * The grade is derived, not typed.
 *
 * Severity and Points came off the quality log form because `actionPoints()` charges
 * the labels first and only falls back to the severity. Leaving `form.severity` to be
 * written through unchanged would keep that fallback alive with a value nobody could
 * see any more: untick the last priced label and the action would silently keep
 * charging the grade it briefly held.
 */
/**
 * The grade is what the person logging the action chose. It is no longer derived.
 *
 * This block used to be titled "severity follows the labels" and asserted the opposite
 * of everything below: `qualitySeverity()` threw away `form.severity` and wrote back the
 * grade whose weight matched the label total. That was the right call under the rule in
 * force at the time — the labels REPLACED the grade, so a picked grade named a number
 * the system did not use, and writing it through would have kept a dead fallback alive.
 *
 * MAX removed the premise. The grade is now half the comparison and is frequently the
 * half that decides: an action graded Critical carrying one label priced at 1 is worth
 * Critical. A derived grade can never express that, because it IS the label total
 * wearing a grade's name — MAX(labels, derived) compares a number with itself, and the
 * whole of change 2 would have been a no-op for every action logged through this form.
 */
describe("buildQualityActionPayload — the grade is chosen, not derived", () => {
  const QUALITY: QualityActionFormInput = { ...BASE_FORM, domain: "quality", safety_kind: "" };
  const AT = "2026-08-16T12:00:00.000Z";

  afterEach(() => { setLabelPoints({}); setSeverityPoints({}); });

  it("writes the grade the form carries, whatever the labels charge", () => {
    setSeverityPoints({ low: 1, medium: 3, high: 4, critical: 5 });
    setLabelPoints({ "foreign body": 5 });
    const payload = buildQualityActionPayload(
      { ...QUALITY, severity: "low", labels: ["Foreign Body"] },
      null,
      AT,
    );
    // Low is what was chosen, so Low is what is stored. The action is still CHARGED 5,
    // because Foreign Body outranks the grade — that is `actionPoints`, not this.
    expect(payload.severity).toBe("low");
  });

  it("keeps the grade when the last priced label is unticked", () => {
    // The inversion of what this test used to assert. Under the derivation, unticking
    // the last priced label wiped the grade — a Critical action silently became
    // ungraded because somebody corrected a label. The grade is the person's now, and
    // nothing but the person removes it.
    setSeverityPoints({ low: 1, medium: 3, high: 4, critical: 5 });
    setLabelPoints({ "foreign body": 5 });
    const payload = buildQualityActionPayload(
      { ...QUALITY, severity: "critical", labels: ["Batch code"] },
      null,
      AT,
    );
    expect(payload.severity).toBe("critical");
  });

  it("writes the chosen grade even when no severity is worth the label total", () => {
    // 5 + 3 = 8, and no grade is worth 8. The derivation wrote null here, because it
    // had nothing to write. A chosen grade has no such problem: High was chosen, High
    // is stored, and the action is charged 8 by its labels.
    setSeverityPoints({ low: 1, medium: 3, high: 4, critical: 5 });
    setLabelPoints({ "foreign body": 5, gmp: 3 });
    const payload = buildQualityActionPayload(
      { ...QUALITY, severity: "high", labels: ["Foreign Body", "GMP"] },
      null,
      AT,
    );
    expect(payload.severity).toBe("high");
  });

  it("stores no grade when none was chosen — ungraded stays a real answer", () => {
    setSeverityPoints({ low: 1, medium: 3, high: 4, critical: 5 });
    setLabelPoints({ "foreign body": 5 });
    const payload = buildQualityActionPayload({ ...QUALITY, labels: ["Foreign Body"] }, null, AT);
    expect(payload.severity).toBeNull();
  });

  /**
   * The badge may now show a grade the charge exceeds, and that is the rule working.
   *
   * A long argument used to live here, and it is worth keeping in view rather than
   * deleting, because it was right about its own period and the reasoning is the reason
   * this test still exists:
   *
   *   The grade was derived from what is CHARGED, exclusions applied. It shipped the
   *   other way round — the argument being that an exclusion decides whose score an
   *   action lands on, and baking "not this leader's" into the grade would put it on
   *   the card everyone reads. It was reversed on 18/08 because the two numbers sat
   *   side by side on one row and disagreed: "Batch code · Maintenance" with Maintenance
   *   excluded read 2 points and Critical, and a leader had no way to know which of the
   *   two they were being judged on.
   *
   * MAX settles that argument differently, and better. The two numbers are ALLOWED to
   * differ now, because the rule that relates them is stated: a label may raise a
   * charge and never lower it, so a charge above the grade means a label aggravated the
   * action. `pointsBreakdown` prints which of the two won and why. What was a
   * contradiction printed in bold is now a sentence somebody can check.
   *
   * The old cost is refunded, too: an action whose only priced label is excluded used
   * to lose its badge entirely. It keeps it now — see below.
   */
  it("lets the badge show a grade the charge exceeds — the label aggravated it", () => {
    setSeverityPoints({ low: 1, medium: 3, high: 4, critical: 5 });
    setLabelPoints({ "batch code": 3, maintenance: 5 });
    const payload = buildQualityActionPayload(
      { ...QUALITY, severity: "low", labels: ["Batch code", "Maintenance"] },
      null,
      AT,
    );
    // Low was chosen and Low is stored, while Batch code charges 3 and Maintenance's 5
    // is spared. The card reads "3 points — Batch code 3" beside a Low badge, and the
    // breakdown says so.
    expect(payload.severity).toBe("low");
  });

  it("still writes the grade when the only priced label is not the leader's", () => {
    // The cost the derivation accepted, now refunded. A metal-on-magnet finding wholly
    // maintenance's kept its 0 and LOST its Critical badge, because the charge it was
    // derived from was 0. The grade describes the deviation; the charge decides who
    // pays for it. They were never the same question.
    setSeverityPoints({ low: 1, medium: 3, high: 4, critical: 5 });
    setLabelPoints({ maintenance: 5 });
    const payload = buildQualityActionPayload(
      { ...QUALITY, severity: "critical", labels: ["Maintenance"] },
      null,
      AT,
    );
    expect(payload.severity).toBe("critical");
  });

  it("is unaffected by attribution, which decides the charge and not the grade", () => {
    /**
     * The same form, saved twice, under opposite attribution. The stored grade must not
     * move — and this is the assertion the derivation could not make: it read the
     * exclusion set to decide the grade, so these two calls disagreed about what the
     * deviation WAS because they disagreed about who PAYS for it.
     *
     * It also means the payload no longer depends on the attribution table having
     * loaded. The form still blocks Save until it has, because the charge shown on
     * screen depends on it — but a stale exclusion set can no longer write a wrong
     * grade into a row, which is the failure that outlives a page refresh.
     */
    setSeverityPoints({ low: 1, medium: 3, high: 4, critical: 5 });
    setLabelPoints({ maintenance: 5 });
    const form = { ...QUALITY, severity: "critical", labels: ["Maintenance"] };

    // The function no longer TAKES an exclusion set, which is the strongest form this
    // assertion can have: attribution cannot reach the grade because it is not in
    // scope. Left as a test rather than deleted, so removing the parameter stays a
    // decision somebody has to undo on purpose.
    expect(buildQualityActionPayload(form, null, AT).severity).toBe("critical");
  });

  it("leaves a safety occurrence's severity exactly as it was picked", () => {
    // Safety no longer offers a severity on the form, but the payload still passes
    // through whatever it is handed for this domain — the grade is a description
    // there, never a price, and rows saved while the picker existed keep theirs.
    setLabelPoints({ "foreign body": 5 });
    const payload = buildQualityActionPayload({ ...BASE_FORM, severity: "high" }, null, AT);
    expect(payload.severity).toBe("high");
  });

  /**
   * `status` is To do / In progress / Complete — the state of a working board, and an
   * action is written down because it already happened, so there is no "not started"
   * for it to be in. The lifecycle that decides anything is `validation_status`.
   *
   * The column is still NOT NULL DEFAULT 'todo' with a CHECK (20260722120000), which
   * is exactly why this has to be ABSENT rather than set to a literal: on an UPDATE,
   * PostgREST writes every key it is given, so a hard-coded 'todo' would reset any row
   * that had been moved to Complete while the board existed, on the next unrelated
   * edit. An absent key leaves the stored value alone and lets the default fill an
   * insert.
   */
  it("never writes status — not even the default the column already has", () => {
    const payload = buildQualityActionPayload(BASE_FORM, null, AT);
    expect("status" in payload).toBe(false);
  });

  it("writes no status on a quality action either", () => {
    const payload = buildQualityActionPayload(QUALITY, null, AT);
    expect("status" in payload).toBe(false);
  });
});
