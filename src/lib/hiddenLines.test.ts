import { describe, it, expect } from "vitest";
import { linesToDraw } from "@/lib/hiddenLines";

const areas = ["L1", "L4", "L5"].map((id) => ({ id }));

describe("hiding a line on one shift", () => {
  it("draws every line when nothing is hidden", () => {
    const r = linesToDraw(areas, new Set(), () => 0);
    expect(r.drawn.map((a) => a.id)).toEqual(["L1", "L4", "L5"]);
    expect([...r.hiddenButStaffed]).toEqual([]);
  });

  it("leaves a hidden, empty line off the board", () => {
    const r = linesToDraw(areas, new Set(["L4"]), () => 0);
    expect(r.drawn.map((a) => a.id)).toEqual(["L1", "L5"]);
  });

  it("still draws a hidden line that has people on it, flagged, so nobody drops off the headcount", () => {
    const r = linesToDraw(areas, new Set(["L4"]), (id) => (id === "L4" ? 3 : 0));
    expect(r.drawn.map((a) => a.id)).toEqual(["L1", "L4", "L5"]);
    expect([...r.hiddenButStaffed]).toEqual(["L4"]);
  });
});
