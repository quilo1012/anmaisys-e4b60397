import { describe, expect, it } from "vitest";
import { buildQualityActionPayload, type QualityActionFormInput } from "@/lib/qualityActionPayload";

/**
 * Critical 3 of the fix-wave review: `leader_id` was hardcoded to `null` on insert,
 * so `scorecard_safety_counts` — which counts `WHERE leader_id = _leader_id` — could
 * never find a safety row, for any leader, ever. This is the payload the create
 * mutation now sends, extracted so that regression cannot come back unnoticed inside
 * a mutation nothing tests directly.
 */

const BASE_FORM: QualityActionFormInput = {
  action_no: "", line: "Line 3", shift: "DAY", leader_id: "leader-123", leader_name: "",
  date: "2026-08-16", sku: "", batch: "", department: "", status: "todo",
  severity: "", labels: [], description: "", domain: "safety", safety_kind: "near_miss",
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
});
