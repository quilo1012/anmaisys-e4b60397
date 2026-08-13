import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  buildHeadcountWorkbook, parseHeadcountWorkbook, parseSheetDate, datesBetween, rowsToImport,
  type ImportedAllocation,
} from "@/lib/headcountSheet";
import type { HeadcountArea, HeadcountEmployee, Allocation } from "@/hooks/useHeadcount";
import type { AllocStatus } from "@/lib/rotaStatus";

const area = (id: string, name: string, kind = "production"): HeadcountArea => ({
  id, name, kind, section: "main_lines", department: null, sort_order: 0, active: true,
});
const emp = (id: string, full_name: string): HeadcountEmployee => ({
  id, full_name, shift_group: "Day", department: null, shift_pattern_id: null,
});
const alloc = (employee_id: string, area_id: string | null, status = "assigned"): Allocation => ({
  id: `a-${employee_id}`, on_date: "2026-08-04", shift: "Day", employee_id, area_id,
  status, half_day: false, left_early_at: null, arrived_late_at: null, note: null, is_leader: false,
});

const AREAS = [area("l1", "Line 1"), area("l5", "Line 5"), area("hy", "Hygiene", "support")];
const ROSTER = [
  emp("e1", "Izildo Santos"), emp("e2", "Leonardo Silva"), emp("e3", "Joao Pedro"),
  emp("e4", "Carlos Geraldi"), emp("e5", "Maria Souza"), emp("e6", "Maria Costa"),
];

describe("parseSheetDate", () => {
  it("reads the ways the factory names a tab", () => {
    expect(parseSheetDate("04.08", 2026)).toBe("2026-08-04");
    expect(parseSheetDate("Mon 04/08", 2026)).toBe("2026-08-04");
    expect(parseSheetDate("2026-08-04 Day", 2026)).toBe("2026-08-04");
    expect(parseSheetDate("4-8-26", 2026)).toBe("2026-08-04");
  });

  it("returns null rather than guessing", () => {
    // Writing a day's allocation onto the wrong date is worse than not writing it.
    expect(parseSheetDate("Summary", 2026)).toBeNull();
    expect(parseSheetDate("Notes", 2026)).toBeNull();
  });
});

describe("datesBetween", () => {
  it("is inclusive at both ends", () => {
    expect(datesBetween("2026-08-04", "2026-08-06")).toEqual(["2026-08-04", "2026-08-05", "2026-08-06"]);
    expect(datesBetween("2026-08-04", "2026-08-04")).toEqual(["2026-08-04"]);
  });

  it("steps over a month end", () => {
    expect(datesBetween("2026-07-31", "2026-08-01")).toEqual(["2026-07-31", "2026-08-01"]);
  });
});

describe("export then import", () => {
  const allocations = [
    alloc("e1", "l1"), alloc("e2", "l1"), alloc("e3", "l5"),
    alloc("e4", "hy"), alloc("e5", null, "unpaid"), alloc("e6", null, "sick"),
  ];
  const wb = buildHeadcountWorkbook({
    days: [{ date: "2026-08-04", shift: "Day" }],
    areas: AREAS,
    employeeById: new Map(ROSTER.map((e) => [e.id, e])),
    allocationsFor: () => allocations,
  });

  it("writes one tab per day", () => {
    expect(wb.SheetNames).toEqual(["2026-08-04 Day"]);
  });

  it("comes back with every person on the area they were on", () => {
    const p = parseHeadcountWorkbook(wb, { areas: AREAS, roster: ROSTER, shift: "Day", fallbackYear: 2026 });
    expect(p.unmatchedNames).toEqual([]);
    expect(p.matched).toHaveLength(6);
    const on = (id: string) => p.matched.find((m) => m.employeeId === id);
    expect(on("e1")!.areaId).toBe("l1");
    expect(on("e3")!.areaId).toBe("l5");
    expect(on("e4")!.areaId).toBe("hy");
    // Sickness and unpaid are separate columns and must survive the round trip as
    // themselves — collapsing them back into one absence is exactly what the board
    // stopped doing.
    expect(on("e5")).toMatchObject({ status: "unpaid", areaId: null });
    expect(on("e6")).toMatchObject({ status: "sick", areaId: null });
  });

  it("does not mistake a column's count row for a person", () => {
    const p = parseHeadcountWorkbook(wb, { areas: AREAS, roster: ROSTER, shift: "Day", fallbackYear: 2026 });
    expect(p.matched.every((m) => m.employeeId.startsWith("e"))).toBe(true);
    expect(p.unmatchedNames.map((u) => u.name)).not.toContain("2");
  });
});

describe("the company sheet's own column names", () => {
  const labelled = [
    { ...area("l5", "Line 5"), sheet_label: "Line 5 (A&B)" },
    { ...area("c1", "Capsules Machine 1"), sheet_group: "Pill line" },
    { ...area("c2", "Capsules Machine 2"), sheet_group: "Pill line" },
    { ...area("gl", "Gel Line") },
  ];
  const staff = [emp("p1", "Ana Silva"), emp("p2", "Bruno Reis"), emp("p3", "Carla Dias")];

  it("prints the sheet's label rather than the system's name", () => {
    const wb = buildHeadcountWorkbook({
      days: [{ date: "2026-08-04", shift: "Day" }],
      areas: labelled,
      employeeById: new Map(staff.map((e) => [e.id, e])),
      allocationsFor: () => [alloc("p1", "l5")],
    });
    const grid = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[wb.SheetNames[0]], { header: 1 });
    expect(grid.flat()).toContain("Line 5 (A&B)");
    expect(grid.flat()).not.toContain("Line 5");
  });

  it("merges the two capsule machines into one Pill line column", () => {
    const wb = buildHeadcountWorkbook({
      days: [{ date: "2026-08-04", shift: "Day" }],
      areas: labelled,
      employeeById: new Map(staff.map((e) => [e.id, e])),
      allocationsFor: () => [alloc("p1", "c1"), alloc("p2", "c2")],
    });
    const flat = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[wb.SheetNames[0]], { header: 1 }).flat();
    expect(flat.filter((c) => c === "Pill line")).toHaveLength(1);
    // Both people survive the merge — this is the whole reason for merging rather
    // than dropping a column.
    expect(flat).toContain("Ana Silva");
    expect(flat).toContain("Bruno Reis");
  });

  it("still gives a column to an area the sheet has never heard of", () => {
    // A hard-coded column list would drop Gel Line for being empty today and lose
    // whoever is put there tomorrow.
    const wb = buildHeadcountWorkbook({
      days: [{ date: "2026-08-04", shift: "Day" }],
      areas: labelled,
      employeeById: new Map(staff.map((e) => [e.id, e])),
      allocationsFor: () => [alloc("p3", "gl")],
    });
    const flat = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[wb.SheetNames[0]], { header: 1 }).flat();
    expect(flat).toContain("Gel Line");
    expect(flat).toContain("Carla Dias");
  });

  it("states both definitions of the production total", () => {
    const wb = buildHeadcountWorkbook({
      days: [{ date: "2026-08-04", shift: "Day" }],
      areas: AREAS,
      employeeById: new Map(ROSTER.map((e) => [e.id, e])),
      allocationsFor: () => [alloc("e1", "l1"), alloc("e4", "hy")],
    });
    const flat = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[wb.SheetNames[0]], { header: 1 }).flat();
    expect(flat.some((c) => String(c).includes("kind = production"))).toBe(true);
    expect(flat.some((c) => String(c).includes("both bands"))).toBe(true);
  });
});

describe("matching names typed by hand", () => {
  const sheet = (rows: (string | number)[][]) => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "04.08");
    return wb;
  };
  const parse = (rows: (string | number)[][]) =>
    parseHeadcountWorkbook(sheet(rows), { areas: AREAS, roster: ROSTER, shift: "Day", fallbackYear: 2026 });

  it("takes a first name when only one person answers to it", () => {
    const p = parse([["Line 1"], ["Izildo"]]);
    expect(p.matched).toHaveLength(1);
    expect(p.matched[0].employeeId).toBe("e1");
  });

  it("refuses a first name two people share", () => {
    // Two Marias. Guessing puts somebody on a line they were never on, and the board
    // looks right while being wrong.
    const p = parse([["Line 1"], ["Maria"]]);
    expect(p.matched).toHaveLength(0);
    expect(p.unmatchedNames).toEqual([{ name: "Maria", column: "Line 1", date: "2026-08-04" }]);
  });

  it("reads a column heading the sheet writes its own way", () => {
    const p = parse([["Line 5 (A&B)"], ["Joao Pedro"]]);
    expect(p.matched[0]?.areaId).toBe("l5");
  });

  it("reports a column that is not an area instead of dropping it", () => {
    const p = parse([["Line 1", "Packing Hall"], ["Izildo Santos", "Leonardo Silva"]]);
    expect(p.unknownColumns).toContain("Packing Hall");
    expect(p.matched).toHaveLength(1);
  });

  it("keeps one row per person when a name appears twice", () => {
    const p = parse([["Line 1", "Line 5"], ["Izildo Santos", "Izildo Santos"]]);
    expect(p.matched).toHaveLength(1);
  });

  it("skips a tab it cannot date rather than importing it somewhere", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Line 1"], ["Izildo Santos"]]), "Summary");
    const p = parseHeadcountWorkbook(wb, { areas: AREAS, roster: ROSTER, shift: "Day", fallbackYear: 2026 });
    expect(p.skippedSheets).toEqual(["Summary"]);
    expect(p.matched).toHaveLength(0);
  });

  it("does not read a total or a block label as somebody's name", () => {
    const p = parse([["Line 1"], ["Izildo Santos"], ["Total"], ["1"]]);
    expect(p.unmatchedNames).toEqual([]);
    expect(p.matched).toHaveLength(1);
  });
});

describe("columns the exporter renames or merges", () => {
  // The exporter labels a column with `sheet_group ?? sheet_label ?? name`. The reader
  // only knew `name`, so its own output came back with an unknown column and everybody
  // in it silently dropped — 47 people over a month of real boards.
  const cap1 = { ...area("c1", "Capsules Machine 1"), sheet_group: "Pill line" } as HeadcountArea;
  const cap2 = { ...area("c2", "Capsules Machine 2"), sheet_group: "Pill line" } as HeadcountArea;
  const l5 = { ...area("l5", "Line 5"), sheet_label: "Line 5 (A&B)" } as HeadcountArea;
  const AREAS2 = [cap1, cap2, l5];
  const ROSTER2 = [emp("e1", "Ana Silva"), emp("e2", "Bruno Costa")];

  const wb = buildHeadcountWorkbook({
    days: [{ date: "2026-08-04", shift: "Day" }],
    areas: AREAS2,
    employeeById: new Map(ROSTER2.map((e) => [e.id, e])),
    allocationsFor: () => [alloc("e1", "c1"), alloc("e2", "l5")],
  });

  it("reads its own merged column back instead of calling it unknown", () => {
    const p = parseHeadcountWorkbook(wb, { areas: AREAS2, roster: ROSTER2, shift: "Day", fallbackYear: 2026 });
    expect(p.unknownColumns).toEqual([]);
    expect(p.matched).toHaveLength(2);
    // A merged column cannot say which machine, so it lands on the first — the right
    // column, and one drag from the right machine.
    expect(p.matched.find((m) => m.employeeId === "e1")!.areaId).toBe("c1");
  });

  it("still reads a renamed column", () => {
    const p = parseHeadcountWorkbook(wb, { areas: AREAS2, roster: ROSTER2, shift: "Day", fallbackYear: 2026 });
    expect(p.matched.find((m) => m.employeeId === "e2")!.areaId).toBe("l5");
  });
});

describe("one area written several ways in the same workbook", () => {
  // The Blender Room is "Assembly" on most days of the factory's own sheet, "Blender
  // Team" on others and "Blender Room" on the rest. Three columns, one place. With a
  // single label two of the three came back unknown and everybody in them was dropped.
  const blender = {
    ...area("br", "Blender Room", "support"),
    sheet_label: "Blender Room, Assembly, Blender Team",
  } as HeadcountArea;
  const ROSTER2 = [emp("e1", "Ana Silva")];

  const sheetWith = (columnName: string) => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["Day shift — 2026-08-04"], [], ["SUPPORT"], [columnName], ["Ana Silva"], [1],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "2026-08-04 Day");
    return wb;
  };

  for (const label of ["Assembly", "Blender Team", "Blender Room"]) {
    it(`reads "${label}" as the Blender Room`, () => {
      const p = parseHeadcountWorkbook(sheetWith(label), {
        areas: [blender], roster: ROSTER2, shift: "Day", fallbackYear: 2026,
      });
      expect(p.unknownColumns).toEqual([]);
      expect(p.matched).toHaveLength(1);
      expect(p.matched[0].areaId).toBe("br");
    });
  }

  it("still calls a column nobody claims unknown", () => {
    // Beside a column it does know: a row of nothing but unknown headings is not read
    // as a heading row at all, which is what keeps stray text out of the import.
    const ws = XLSX.utils.aoa_to_sheet([
      ["Day shift — 2026-08-04"], [], ["SUPPORT"],
      ["Assembly", "Bottling"], ["Ana Silva", "Nobody Here"], [1, 1],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "2026-08-04 Day");
    const p = parseHeadcountWorkbook(wb, {
      areas: [blender], roster: ROSTER2, shift: "Day", fallbackYear: 2026,
    });
    expect(p.unknownColumns).toContain("Bottling");
    expect(p.matched[0].areaId).toBe("br");
  });
});

/**
 * `daily_allocations_one_leader_per_area` is a unique index over (day, shift, area)
 * where `is_leader`. The import writes `area_id` and says nothing about the mark, so a
 * sheet that moves the leader of Line 1 onto Line 5 carries the mark with them — and
 * Line 5 already has one. Postgres refuses the whole statement and a month of board
 * fails on one square, with "duplicate key value violates unique constraint" as the
 * only thing said about it.
 */
describe("rowsToImport, and the leader mark", () => {
  const ON = { known: true, coversDay: true, onThisBoard: true };
  const OFF = { known: true, coversDay: false, onThisBoard: true };
  const sheet = (areaId: string | null, status: AllocStatus = "assigned"): ImportedAllocation =>
    ({ date: "2026-08-08", shift: "Day", employeeId: "e1", areaId, status });
  const leads = (area_id: string | null) =>
    [{ on_date: "2026-08-08", shift: "Day", employee_id: "e1", area_id }];

  const rows = (matched: ImportedAllocation[], leaders = leads("l1"), cover = () => ON) =>
    rowsToImport({ matched, leaders, cover });

  it("drops the mark when the sheet puts the leader in another column", () => {
    expect(rows([sheet("l5")])[0].is_leader).toBe(false);
  });

  it("keeps the mark when the sheet puts them back where they stand", () => {
    // Re-importing the same file must not cost every leader their line.
    expect(rows([sheet("l1")])[0].is_leader).toBe(true);
  });

  it("drops the mark when the sheet says they were off", () => {
    // A holiday has no column, so it can lead none.
    const row = rows([sheet("l1", "holiday")])[0];
    expect(row.is_leader).toBe(false);
    expect(row.area_id).toBeNull();
  });

  it("never invents a mark for somebody who leads nothing", () => {
    expect(rows([sheet("l1")], [])[0].is_leader).toBe(false);
  });

  it("does not read one day's leader onto another day", () => {
    // The index is per day and per board: leading Line 1 on Friday says nothing about
    // Saturday, and a range import writes both in one statement.
    const other = [{ on_date: "2026-08-07", shift: "Day", employee_id: "e1", area_id: "l1" }];
    expect(rows([sheet("l1")], other)[0].is_leader).toBe(false);
    const night = [{ on_date: "2026-08-08", shift: "Night", employee_id: "e1", area_id: "l1" }];
    expect(rows([sheet("l1")], night)[0].is_leader).toBe(false);
  });

  it("still asks the rota about every row", () => {
    // The extraction must not lose the reason the import reads the rota at all: a day
    // nobody's rota covers is overtime, and is paid as one.
    expect(rows([sheet("l1")], [], () => OFF)[0].status).toBe("overtime");
  });
});
