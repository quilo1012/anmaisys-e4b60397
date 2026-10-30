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

import { hiddenGaps } from "@/lib/hiddenLines";

describe("where a hidden line is marked", () => {
  const band = ["L1", "L2", "L3", "L4", "L5"].map((id) => ({ id }));
  it("marks a hidden line on the left edge of the next line drawn, like Excel", () => {
    const g = hiddenGaps(band, new Set(["L1", "L3", "L5"]));
    expect(g.before.get("L3")?.map((a) => a.id)).toEqual(["L2"]);
    expect(g.before.get("L5")?.map((a) => a.id)).toEqual(["L4"]);
    expect(g.before.has("L1")).toBe(false);
    expect(g.after).toEqual([]);
  });
  it("groups neighbours hidden together into one mark", () => {
    const g = hiddenGaps(band, new Set(["L1", "L4"]));
    expect(g.before.get("L4")?.map((a) => a.id)).toEqual(["L2", "L3"]);
    expect(g.after.map((a) => a.id)).toEqual(["L5"]);
  });
  it("has no marks when nothing is hidden", () => {
    const g = hiddenGaps(band, new Set(band.map((a) => a.id)));
    expect(g.before.size).toBe(0);
    expect(g.after).toEqual([]);
  });
});
