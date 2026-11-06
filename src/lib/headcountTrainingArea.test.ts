import { describe, it, expect } from "vitest";
import { foldTrainingArea, isTrainingArea } from "@/lib/headcountBlocks";
import { tallyBoard } from "@/lib/boardTally";

const areas = [
  { id: "l1", name: "Line 1", kind: "production" },
  { id: "tr", name: " Training ", kind: "production" },
];

describe("the Training area is the Training column", () => {
  it("knows the area by name, whatever its case and spaces", () => {
    expect(isTrainingArea({ name: "TRAINING" })).toBe(true);
    expect(isTrainingArea({ name: "Training room" })).toBe(false);
  });

  it("reads a row on it as training, and leaves overtime as overtime", () => {
    const out = foldTrainingArea([
      { employee_id: "a", area_id: "tr", status: "assigned" },
      { employee_id: "b", area_id: "tr", status: "overtime" },
      { employee_id: "c", area_id: "l1", status: "assigned" },
    ], areas);
    expect(out.map((r) => [r.area_id, r.status])).toEqual([
      [null, "training"], [null, "overtime"], ["l1", "assigned"],
    ]);
  });

  it("stops counting them on a line", () => {
    const allocations = [
      { employee_id: "a", area_id: "tr", status: "assigned" },
      { employee_id: "c", area_id: "l1", status: "assigned" },
    ];
    const t = tallyBoard({
      allocations: foldTrainingArea(allocations, areas),
      areas: areas.filter((a) => !isTrainingArea(a)),
      roster: [],
      drawable: () => true,
    });
    expect(t.onLines).toBe(1);
    expect(t.working).toBe(1);
    expect(t.training).toBe(1);
  });
});
