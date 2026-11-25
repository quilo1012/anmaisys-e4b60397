import { describe, it, expect } from "vitest";
import { shiftLine } from "@/lib/chat";
import { areaVisibleOn } from "@/lib/myShiftText";

describe("shiftLine", () => {
  it("keeps only the shift", () => expect(shiftLine("Employee · Lab · Night shift")).toBe("Night shift"));
  it("weekend variants", () => expect(shiftLine("Employee · Warehouse Weekend shift")).toBe("Warehouse Weekend shift"));
  it("no shift gives null", () => expect(shiftLine("Employee · Lab")).toBeNull());
  it("empty gives null", () => { expect(shiftLine(null)).toBeNull(); expect(shiftLine("")).toBeNull(); });
});

describe("areaVisibleOn", () => {
  it("today", () => expect(areaVisibleOn("2026-11-25", "2026-11-25")).toBe(true));
  it("past", () => expect(areaVisibleOn("2026-11-24", "2026-11-25")).toBe(true));
  it("future", () => expect(areaVisibleOn("2026-11-26", "2026-11-25")).toBe(false));
});
