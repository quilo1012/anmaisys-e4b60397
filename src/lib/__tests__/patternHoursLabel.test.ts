import { describe, it, expect } from "vitest";
import { patternHoursLabel } from "@/lib/patternHoursLabel";
describe("patternHoursLabel", () => {
  it("shows hours for a shift that is not 12 hours", () => {
    expect(patternHoursLabel({ starts_at: "08:00:00", ends_at: "16:00:00" }, "2026-11-28")).toBe("08:00–16:00");
  });
  it("shows nothing for a 12-hour day or night shift", () => {
    expect(patternHoursLabel({ starts_at: "06:00", ends_at: "18:00" }, "2026-11-28")).toBeNull();
    expect(patternHoursLabel({ starts_at: "18:00", ends_at: "06:00" }, "2026-11-28")).toBeNull();
  });
  it("uses the weekday's own hours when they differ", () => {
    // 28/11/2026 is a Saturday (ISO 6)
    expect(patternHoursLabel({ starts_at: "06:00", ends_at: "18:00",
      dayOverrides: [{ weekday: 6, starts_at: "08:00", ends_at: "14:00" }] }, "2026-11-28")).toBe("08:00–14:00");
  });
});
