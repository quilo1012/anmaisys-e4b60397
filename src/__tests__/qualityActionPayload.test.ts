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
describe("buildQualityActionPayload — severity follows the labels", () => {
  const QUALITY: QualityActionFormInput = { ...BASE_FORM, domain: "quality", safety_kind: "" };
  const AT = "2026-08-16T12:00:00.000Z";

  afterEach(() => { setLabelPoints({}); setSeverityPoints({}); });

  it("grades a quality action by what its labels charge", () => {
    setSeverityPoints({ low: 1, medium: 3, high: 4, critical: 5 });
    setLabelPoints({ "foreign body": 5 });
    const payload = buildQualityActionPayload({ ...QUALITY, labels: ["Foreign Body"] }, null, AT);
    expect(payload.severity).toBe("critical");
  });

  it("clears the grade when the last priced label is unticked", () => {
    // The regression this exists to prevent: the form used to keep the old grade on
    // purpose, because a user could still see and change it. They cannot now.
    setSeverityPoints({ low: 1, medium: 3, high: 4, critical: 5 });
    setLabelPoints({ "foreign body": 5 });
    const payload = buildQualityActionPayload(
      { ...QUALITY, severity: "critical", labels: ["Batch code"] },
      null,
      AT,
    );
    expect(payload.severity).toBeNull();
  });

  it("writes no grade when the total is a number no severity carries", () => {
    setSeverityPoints({ low: 1, medium: 3, high: 4, critical: 5 });
    setLabelPoints({ "foreign body": 5, gmp: 3 });
    const payload = buildQualityActionPayload(
      { ...QUALITY, severity: "high", labels: ["Foreign Body", "GMP"] },
      null,
      AT,
    );
    expect(payload.severity).toBeNull();
  });

  /**
   * The grade is derived from what is CHARGED, exclusions applied.
   *
   * This rule has been both ways round, so the history is worth having in front of
   * you before changing it a third time:
   *
   *   - It shipped applying no exclusions, deliberately: the argument was that an
   *     exclusion decides whose score an action lands on, and baking "not this
   *     leader's" into the grade would put it on the card everyone reads.
   *   - Reversed here, on 18/08, with the cost below known and accepted.
   *
   * The reason for reversing: the two numbers appeared side by side on the same row
   * and disagreed. "Batch code · Maintenance" with Maintenance excluded read 2 points
   * and Critical — the points said one thing, the badge beside them another, and a
   * leader looking at their own scorecard had no way to know which one they were
   * being judged on. A grade that describes a charge nobody is paying is not extra
   * information, it is a contradiction printed in bold.
   *
   * The cost, accepted: an action whose ONLY priced label is excluded now saves with
   * no grade at all. A metal-on-magnet finding, wholly maintenance's, keeps its 0 and
   * loses its Critical badge. The severity of the deviation itself is not lost to the
   * business — `issueWeight()` prices recurring problems off the labels and ignores
   * attribution entirely, which is the table that question belongs on.
   */
  it("grades by what is charged, so the badge and the points cannot disagree", () => {
    setSeverityPoints({ low: 1, medium: 3, high: 4, critical: 5 });
    setLabelPoints({ "batch code": 3, maintenance: 5 });
    // Batch code 3 is charged; maintenance's 5 is not. 3 is Medium, and Medium is
    // what the badge must say — 8 would be Critical and nobody is paying 8.
    const payload = buildQualityActionPayload(
      { ...QUALITY, labels: ["Batch code", "Maintenance"] },
      null,
      AT,
      new Set(["maintenance"]),
    );
    expect(payload.severity).toBe("medium");
  });

  it("writes no grade for an action whose only price is not the leader's", () => {
    // The accepted cost, nailed down so it is a decision and not a surprise.
    setSeverityPoints({ low: 1, medium: 3, high: 4, critical: 5 });
    setLabelPoints({ maintenance: 5 });
    const payload = buildQualityActionPayload(
      { ...QUALITY, labels: ["Maintenance"] },
      null,
      AT,
      new Set(["maintenance"]),
    );
    expect(payload.severity).toBeNull();
  });

  it("grades on the full charge when nothing is excluded", () => {
    // The default caller passes an empty set, and an empty set means "nothing is
    // excluded" — the behaviour every existing test above relies on.
    setSeverityPoints({ low: 1, medium: 3, high: 4, critical: 5 });
    setLabelPoints({ maintenance: 5 });
    const payload = buildQualityActionPayload({ ...QUALITY, labels: ["Maintenance"] }, null, AT);
    expect(payload.severity).toBe("critical");
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
