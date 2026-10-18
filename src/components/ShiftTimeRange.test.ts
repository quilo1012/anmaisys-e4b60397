import { describe, it, expect } from "vitest";
import { nextDaySuffix } from "./ShiftTimeRange";

describe("record time annotations", () => {
  it("marks 18:00–06:00 as ending next day", () => {
    expect(nextDaySuffix("18:00:00", "06:00:00")).toBe(" +1");
  });
  it("marks 18:00–02:00 as ending next day", () => {
    expect(nextDaySuffix("18:00", "02:00")).toBe(" +1");
  });
  it("does not mark a same-day range", () => {
    expect(nextDaySuffix("06:00", "18:00")).toBe("");
  });
});