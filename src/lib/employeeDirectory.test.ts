import { describe, expect, it } from "vitest";
import {
  ALL, NOT_SET, compareNames, filterDirectory, filterOptions, normaliseName, paginate, shiftPatternConflict, sortByName,
  type DirectoryRow,
} from "./employeeDirectory";

const row = (name: string, department: string | null, shift: string | null, extra: string[] = [], lineId: string | null = null): DirectoryRow => ({
  name, department, shift, lineId, extra,
});

describe("sorting", () => {
  it("is A–Z ignoring case and accents, and Z–A reverses it exactly", () => {
    const rows = [{ name: "zoe" }, { name: "Álvaro" }, { name: "BRUNO" }, { name: "alice" }];
    expect(sortByName(rows).map((r) => r.name)).toEqual(["alice", "Álvaro", "BRUNO", "zoe"]);
    expect(sortByName(rows, "desc").map((r) => r.name)).toEqual(["zoe", "BRUNO", "Álvaro", "alice"]);
  });

  it("does not change the list it was given", () => {
    const rows = [{ name: "b" }, { name: "a" }];
    sortByName(rows);
    expect(rows.map((r) => r.name)).toEqual(["b", "a"]);
  });

  it("is stable for names that differ only in case", () => {
    expect(compareNames("ana", "Ana")).not.toBe(0);
    expect(compareNames("ana", "ana")).toBe(0);
    expect(normaliseName("  João   SILVA ")).toBe("joao silva");
  });

  it("puts a missing name last-safe rather than throwing", () => {
    expect(() => sortByName([{ name: "" }, { name: "A" }])).not.toThrow();
  });
});

describe("filters", () => {
  const rows = [
    row("Ana Silva", "Production", "Day", ["ana@x.com"], "L1"),
    row("Bruno Costa", "Production", "Night", [], "L2"),
    row("Carla Dias", "Warehouse", "Day", ["badge 123"], null),
    row("Diogo Ramos", null, null, [], null),
    row("Eva Rocha", "Production", null, [], "L1"),
  ];
  const names = (r: DirectoryRow[]) => r.map((x) => x.name);

  it("combines department, shift and search without one resetting another", () => {
    expect(names(filterDirectory(rows, { department: "Production", shift: "Day" }))).toEqual(["Ana Silva"]);
    expect(names(filterDirectory(rows, { department: "Production", q: "costa" }))).toEqual(["Bruno Costa"]);
    expect(names(filterDirectory(rows, { department: "Production", shift: "Night", q: "ana" }))).toEqual([]);
  });

  it("finds the gaps: Not set matches exactly the rows with nothing recorded", () => {
    expect(names(filterDirectory(rows, { department: NOT_SET }))).toEqual(["Diogo Ramos"]);
    expect(names(filterDirectory(rows, { shift: NOT_SET }))).toEqual(["Diogo Ramos", "Eva Rocha"]);
    expect(names(filterDirectory(rows, { line: NOT_SET }))).toEqual(["Carla Dias", "Diogo Ramos"]);
    expect(names(filterDirectory(rows, { department: "Production", shift: NOT_SET }))).toEqual(["Eva Rocha"]);
  });

  it("treats ALL and undefined as no filter", () => {
    expect(filterDirectory(rows, { department: ALL, shift: ALL, line: ALL })).toHaveLength(5);
    expect(filterDirectory(rows, {})).toHaveLength(5);
  });

  it("searches name, department, shift and the extra words, ignoring case and accents", () => {
    expect(names(filterDirectory(rows, { q: "BADGE" }))).toEqual(["Carla Dias"]);
    expect(names(filterDirectory(rows, { q: "warehouse" }))).toEqual(["Carla Dias"]);
    expect(names(filterDirectory(rows, { q: "night" }))).toEqual(["Bruno Costa"]);
    expect(names(filterDirectory(rows, { q: "ANA@X" }))).toEqual(["Ana Silva"]);
  });

  it("never matches a department by a partial value: the filter is exact", () => {
    expect(filterDirectory(rows, { department: "Prod" })).toHaveLength(0);
  });

  it("builds options from what exists, A–Z, with Not set last and only when needed", () => {
    expect(filterOptions(["Warehouse", "Production", "Production", "Lab"])).toEqual([
      { value: "Lab", label: "Lab", count: 1 },
      { value: "Production", label: "Production", count: 2 },
      { value: "Warehouse", label: "Warehouse", count: 1 },
    ]);
    const withGap = filterOptions(["Production", null, "  ", undefined]);
    expect(withGap[withGap.length - 1]).toEqual({ value: NOT_SET, label: "Not set", count: 3 });
  });
});

describe("pagination", () => {
  const list = Array.from({ length: 53 }, (_, i) => i);
  it("returns the right slice and clamps a page that no longer exists", () => {
    expect(paginate(list, 0, 25).rows).toHaveLength(25);
    expect(paginate(list, 2, 25).rows).toHaveLength(3);
    const after = paginate(list.slice(0, 10), 2, 25); // a filter shrank the list
    expect(after.page).toBe(0);
    expect(after.pages).toBe(1);
    expect(paginate([], 5, 25)).toEqual({ rows: [], page: 0, pages: 1 });
  });

  it("keeps sorting and filtering across pages: page two is the next names, not a re-sort", () => {
    const sorted = sortByName(Array.from({ length: 30 }, (_, i) => ({ name: `P${String(29 - i).padStart(2, "0")}` })));
    expect(paginate(sorted, 1, 25).rows[0].name).toBe("P25");
  });
});

describe("shift against rota", () => {
  const day = { starts_at: "06:00:00", ends_at: "18:00:00" };
  const night = { starts_at: "18:00:00", ends_at: "06:00:00" };

  it("flags the clear contradictions only", () => {
    expect(shiftPatternConflict("Night", day)).toMatch(/Night shift/);
    expect(shiftPatternConflict("Day", night)).toMatch(/past midnight/);
  });

  it("is quiet when they agree, when there are no hours, or for crews with their own hours", () => {
    expect(shiftPatternConflict("Day", day)).toBeNull();
    expect(shiftPatternConflict("Night", night)).toBeNull();
    expect(shiftPatternConflict("Night", { starts_at: null, ends_at: null })).toBeNull();
    expect(shiftPatternConflict("Night", null)).toBeNull();
    expect(shiftPatternConflict(null, day)).toBeNull();
    expect(shiftPatternConflict("Weekend", day)).toBeNull();
    expect(shiftPatternConflict("Warehouse Day", { starts_at: "08:00:00", ends_at: "16:00:00" })).toBeNull();
  });
});
