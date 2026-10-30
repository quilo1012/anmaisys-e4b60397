import { describe, it, expect } from "vitest";
import { applyLineOrder, moveLine, renumber } from "@/lib/lineOrder";

const lines = Array.from({ length: 10 }, (_, i) => `Line ${i + 1}`);
const numbered = new Map(lines.map((id, i) => [id, (i + 1) * 10]));

describe("moving a column of the board", () => {
  it("Line 2 onto Line 3 swaps the two and writes only those two", () => {
    const next = moveLine(lines, "Line 2", "Line 3")!;
    expect(next.slice(0, 4)).toEqual(["Line 1", "Line 3", "Line 2", "Line 4"]);
    expect(renumber(next, numbered).save).toEqual([
      { id: "Line 3", sort_order: 20 },
      { id: "Line 2", sort_order: 30 },
    ]);
  });

  it("Line 1 onto Line 6 puts it sixth and slides 2–6 one place left", () => {
    const next = moveLine(lines, "Line 1", "Line 6")!;
    expect(next.slice(0, 7)).toEqual(["Line 2", "Line 3", "Line 4", "Line 5", "Line 6", "Line 1", "Line 7"]);
  });

  it.each([
    ["Line 3", "Line 8", 7],
    ["Line 6", "Line 1", 0],
    ["Line 10", "Line 4", 3],
  ])("%s onto %s lands at index %i, with every line still there exactly once", (from, to, at) => {
    const next = moveLine(lines, from, to)!;
    expect(next.indexOf(from)).toBe(at);
    expect([...next].sort()).toEqual([...lines].sort());
  });

  it("does nothing when dropped on itself or on something outside the band", () => {
    expect(moveLine(lines, "Line 4", "Line 4")).toBeNull();
    expect(moveLine(lines, "Line 4", "Gel Packing")).toBeNull();
  });

  it("works for a line nobody has heard of yet", () => {
    const withNew = [...lines, "Line 11"];
    expect(moveLine(withNew, "Line 11", "Line 1")![0]).toBe("Line 11");
  });

  it("undo puts back the exact numbers, ties and gaps included", () => {
    const messy = new Map([["A", 5], ["B", 5], ["C", 90]]);
    const next = moveLine(["A", "B", "C"], "C", "A")!;
    const { save, undo } = renumber(next, messy);
    expect(save).toEqual([{ id: "C", sort_order: 10 }, { id: "A", sort_order: 20 }, { id: "B", sort_order: 30 }]);
    expect(undo).toEqual([{ id: "C", sort_order: 90 }, { id: "A", sort_order: 5 }, { id: "B", sort_order: 5 }]);
  });

  it("re-sorts the cached list so the screen shows the new order before the save returns", () => {
    const areas = lines.slice(0, 3).map((id, i) => ({ id, name: id, sort_order: (i + 1) * 10 }));
    const { save } = renumber(moveLine(areas.map((a) => a.id), "Line 3", "Line 1")!, numbered);
    expect(applyLineOrder(areas, save).map((a) => a.id)).toEqual(["Line 3", "Line 1", "Line 2"]);
  });
});
