import { describe, expect, it } from "vitest";
import { emptyDraft, isBlank } from "@/lib/scorecardEntry";

describe("isBlank", () => {
  it("separates nothing recorded from a recorded zero", () => {
    expect(isBlank(null)).toBe(true);
    expect(isBlank(undefined)).toBe(true);
    expect(isBlank("")).toBe(true);
    // Zero near-misses e um numero que alguem escreveu. Nao e uma lacuna.
    expect(isBlank(0)).toBe(false);
  });
});

describe("emptyDraft", () => {
  it("starts every measured field unrecorded, not at zero", () => {
    const d = emptyDraft("l1", "n1", "2026-07-05");
    expect(d.near_misses_reported).toBeNull();
    expect(d.planned_volume).toBeNull();
    expect(d.ccp_check_status).toBeNull();
    expect(d.leader_id).toBe("l1");
    expect(d.week_ending).toBe("2026-07-05");
  });
});
