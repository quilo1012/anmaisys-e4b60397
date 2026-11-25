import { describe, it, expect } from "vitest";
import { areaTextOn } from "@/lib/myShiftText";
import type { MyShift } from "@/lib/myAttendance";
const sh = (date: string): MyShift => ({ date, shift: "Day", hours: "06:00–18:00", kind: "scheduled", area: "Line 4", leader: false } as MyShift);
describe("work area on employee screens", () => {
  it("shows today's area", () => expect(areaTextOn(sh("2026-11-25"), "2026-11-25")).toBe("Line 4"));
  it("shows past areas", () => expect(areaTextOn(sh("2026-11-24"), "2026-11-25")).toBe("Line 4"));
  it("hides tomorrow's area", () => expect(areaTextOn(sh("2026-11-26"), "2026-11-25")).toBe("Work area shown on the day"));
});
