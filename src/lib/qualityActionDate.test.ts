import { describe, it, expect } from "vitest";
import { shiftSessionDate } from "@/lib/shifts";
import { qualityActionFormDate, recordedAtOnSave } from "@/lib/qualityActionDate";

/**
 * Audit 2026-11-02, BIZ-001. A night action logged at 02:30 on Thursday belongs to
 * Wednesday's night. Opening it for edit showed Thursday (the UTC calendar date of the
 * timestamp) and saving wrote Thursday 12:00 — so fixing a typo in the description moved
 * the action into Thursday's day, and onto whoever led that shift.
 */
const NIGHT_0230 = "2026-10-29T02:30:00.000Z";

describe("editing a quality action", () => {
  it("opens on the shift's own date, not the calendar date of the timestamp", () => {
    expect(qualityActionFormDate(NIGHT_0230, "NIGHT")).toBe("2026-10-28");
    expect(qualityActionFormDate("2026-10-29T10:00:00.000Z", "DAY")).toBe("2026-10-29");
  });

  it("keeps the recorded time when neither date nor shift was changed", () => {
    const form = { date: "2026-10-28", shift: "NIGHT" };
    const original = { recorded_at: NIGHT_0230, shift: "NIGHT" };
    const saved = recordedAtOnSave(form, original);
    expect(saved).toBe(NIGHT_0230);
    expect(shiftSessionDate(saved, "NIGHT")).toBe("2026-10-28");
  });

  it("moves to midday of the chosen date only when the date or shift was changed", () => {
    const original = { recorded_at: NIGHT_0230, shift: "NIGHT" };
    const moved = recordedAtOnSave({ date: "2026-10-27", shift: "NIGHT" }, original);
    expect(shiftSessionDate(moved, "NIGHT")).toBe("2026-10-27");
    const day = recordedAtOnSave({ date: "2026-10-28", shift: "DAY" }, original);
    expect(shiftSessionDate(day, "DAY")).toBe("2026-10-28");
  });

  it("a new action is stamped at midday of the chosen date, as before", () => {
    expect(shiftSessionDate(recordedAtOnSave({ date: "2026-10-28", shift: "NIGHT" }, null), "NIGHT"))
      .toBe("2026-10-28");
  });
});
