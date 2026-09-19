import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  buildHeadcountWorkbook, parseHeadcountWorkbook, printSheetLayout, parseSheetDate, datesBetween, rowsToImport,
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
    expect(p.unmatchedNames).toEqual([{
      name: "Maria", column: "Line 1", date: "2026-08-04", reason: "ambiguous",
      candidates: [{ id: "e5", full_name: "Maria Souza" }, { id: "e6", full_name: "Maria Costa" }],
    }]);
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

describe("the names the factory's own sheet actually writes", () => {
  // Measured against `Production Headcount August.xlsx`: of 249 names the company
  // sheet carries over four days, 61 landed nowhere. These are the shapes they had.
  const named = (id: string, full_name: string, department: string | null = null,
                 sheet_aliases: string | null = null): HeadcountEmployee =>
    ({ id, full_name, shift_group: "Day", department, shift_pattern_id: null, sheet_aliases }) as HeadcountEmployee;

  const sheet = (rows: (string | number)[][]) => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "04.08.2026");
    return wb;
  };

  it("takes an abbreviated name when exactly one person answers to it", () => {
    // "RICARDO F" is Ricardo Fernandes, and cannot be Ricardo Marques.
    const roster = [named("rf", "Ricardo Fernandes"), named("rm", "Ricardo Marques")];
    const p = parseHeadcountWorkbook(sheet([["Line 1"], ["RICARDO F"]]),
      { areas: AREAS, roster, shift: "Day", fallbackYear: 2026 });
    expect(p.matched.map((m) => m.employeeId)).toEqual(["rf"]);
  });

  it("takes a shortened first name nobody else answers to", () => {
    const roster = [named("ak", "Aleksandra Kopec"), named("kg", "Karoline Goncalves")];
    const p = parseHeadcountWorkbook(sheet([["Line 1", "Line 5"], ["Aleks", "KAROL"]]),
      { areas: AREAS, roster, shift: "Day", fallbackYear: 2026 });
    expect(p.matched.map((m) => m.employeeId).sort()).toEqual(["ak", "kg"]);
  });

  it("settles a shared first name by the department of the column it is under", () => {
    // Two Lucases. The one under Office is the one who works in the Office.
    const areas: HeadcountArea[] = [
      { ...area("of", "Office", "support"), department: "Office" },
      { ...area("l1", "Line 1"), department: "Production" },
    ];
    const roster = [named("ld", "Lucas Duarte", "Office"), named("lg", "Lucas Gloor", "Production")];
    const p = parseHeadcountWorkbook(sheet([["Office", "Line 1"], ["Lucas", "Lucas Gloor"]]),
      { areas, roster, shift: "Day", fallbackYear: 2026 });
    expect(p.matched.find((m) => m.areaId === "of")?.employeeId).toBe("ld");
  });

  it("still refuses a shared first name the column cannot settle", () => {
    const roster = [named("p1", "Pedro Correia", "Production"), named("p2", "Pedro De Assis", "Production")];
    const p = parseHeadcountWorkbook(sheet([["Line 1"], ["Pedro"]]),
      { areas: AREAS, roster, shift: "Day", fallbackYear: 2026 });
    expect(p.matched).toHaveLength(0);
    expect(p.unmatchedNames[0]).toMatchObject({ name: "Pedro", reason: "ambiguous" });
  });

  it("hands back who a refused name could be, so it can be settled on screen", () => {
    const roster = [named("p1", "Pedro Correia"), named("p2", "Pedro De Assis")];
    const p = parseHeadcountWorkbook(sheet([["Line 1"], ["Pedro"]]),
      { areas: AREAS, roster, shift: "Day", fallbackYear: 2026 });
    expect(p.unmatchedNames[0].candidates.map((c) => c.id).sort()).toEqual(["p1", "p2"]);
  });

  it("says nobody rather than ambiguous when the name is not on the payroll", () => {
    const p = parseHeadcountWorkbook(sheet([["Line 1"], ["Joao Passacantando"]]),
      { areas: AREAS, roster: ROSTER, shift: "Day", fallbackYear: 2026 });
    expect(p.unmatchedNames[0]).toMatchObject({ reason: "unknown", candidates: [] });
  });

  it("takes the spelling the sheet uses when it is written on the person", () => {
    // "LUCAS GLOR", "Crsitiano", "GYOVANI", "Gimenez" — a month of typos that no
    // rule should guess at and no office should have to fix twice.
    const roster = [named("lg", "Lucas Gloor", "Production", "LUCAS GLOR"),
                    named("gg", "Giovany Gava", "Production", "GYOVANI, Gyovani")];
    const p = parseHeadcountWorkbook(sheet([["Line 1", "Line 5"], ["LUCAS GLOR", "GYOVANI"]]),
      { areas: AREAS, roster, shift: "Day", fallbackYear: 2026 });
    expect(p.matched.map((m) => m.employeeId).sort()).toEqual(["gg", "lg"]);
  });

  it("honours a name settled by hand over everything it works out itself", () => {
    const roster = [named("p1", "Pedro Correia"), named("p2", "Pedro De Assis")];
    const p = parseHeadcountWorkbook(sheet([["Line 1"], ["Pedro"]]),
      { areas: AREAS, roster, shift: "Day", fallbackYear: 2026, assigned: { Pedro: "p2" } });
    expect(p.matched.map((m) => m.employeeId)).toEqual(["p2"]);
  });

  it("reads the overtime column the company sheet heads its own way", () => {
    const p = parseHeadcountWorkbook(sheet([["Line 1", "Overtime staff"], ["Izildo Santos", "Leonardo Silva"]]),
      { areas: AREAS, roster: ROSTER, shift: "Day", fallbackYear: 2026 });
    expect(p.matched.find((m) => m.employeeId === "e2")).toMatchObject({ status: "overtime", areaId: null });
    expect(p.unknownColumns).not.toContain("Overtime staff");
  });

  it("reports the Absence column instead of dropping everyone under it", () => {
    // The sheet has one Absence column; the board has Sickness and Unpaid. Which one
    // it means is a payroll fact and is asked for, not invented.
    const p = parseHeadcountWorkbook(sheet([["Line 1", "Absence"], ["Izildo Santos", "Leonardo Silva"]]),
      { areas: AREAS, roster: ROSTER, shift: "Day", fallbackYear: 2026 });
    expect(p.absenceColumnFound).toBe(true);
    expect(p.matched.find((m) => m.employeeId === "e2")).toBeUndefined();
  });

  it("writes the Absence column as whatever the office says it means", () => {
    const p = parseHeadcountWorkbook(sheet([["Line 1", "Absence"], ["Izildo Santos", "Leonardo Silva"]]),
      { areas: AREAS, roster: ROSTER, shift: "Day", fallbackYear: 2026, absenceAs: "unpaid" });
    expect(p.matched.find((m) => m.employeeId === "e2")).toMatchObject({ status: "unpaid", areaId: null });
  });

  it("prefers the person on this board when two share a first name across boards", () => {
    // Quality and Maintenance are on the Day sheet and on the night crew both. The
    // roster has to carry both, or "Toni" can never land — but a Day name must not
    // be taken off the night crew when a Day person answers to it too.
    const day = { ...named("ta", "Toni Alves"), shift_group: "Day" } as HeadcountEmployee;
    const night = { ...named("ts", "Toni Spinelli"), shift_group: "Night" } as HeadcountEmployee;
    const p = parseHeadcountWorkbook(sheet([["Line 1"], ["Toni"]]),
      { areas: AREAS, roster: [night, day], shift: "Day", fallbackYear: 2026 });
    expect(p.matched.map((m) => m.employeeId)).toEqual(["ta"]);
  });
});

/**
 * What the importer still dropped, found by feeding it the sheets a Portuguese-speaking
 * office actually types: capitals without accents, first and last name with the middle
 * ones left out, tabs named "4 Aug", a single tab nobody renamed from "Sheet1", and a
 * workbook that carries the night board beside the day one.
 */
describe("the sheets the office actually types", () => {
  const AREAS2 = [area("l1", "Line 1"), area("l5", "Line 5")];
  const wbOf = (tabs: Record<string, (string | number)[][]>) => {
    const wb = XLSX.utils.book_new();
    for (const [name, rows] of Object.entries(tabs)) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
    }
    return wb;
  };
  const read = (wb: XLSX.WorkBook, roster: HeadcountEmployee[]) =>
    parseHeadcountWorkbook(wb, { areas: AREAS2, roster, shift: "Day", fallbackYear: 2026 });

  it("matches a name typed without its accents", () => {
    const p = read(
      wbOf({ "04.08": [["Line 1", "Line 5"], ["JOAO SILVA", "Jose"]] }),
      [emp("e1", "João Silva"), emp("e2", "José Antônio")],
    );
    expect(p.matched.map((m) => m.employeeId).sort()).toEqual(["e1", "e2"]);
    expect(p.unmatchedNames).toEqual([]);
  });

  it("matches an accented name against a payroll typed without them", () => {
    const p = read(wbOf({ "04.08": [["Line 1"], ["Antônio Conceição"]] }), [emp("e1", "Antonio Conceicao")]);
    expect(p.matched).toHaveLength(1);
  });

  it("takes first and last name when the payroll has the middle ones too", () => {
    const p = read(
      wbOf({ "04.08": [["Line 1", "Line 5"], ["Elias Alves", "Felipe Nascimento"]] }),
      [emp("e1", "Elias Carvalho Alves"), emp("e2", "Felipe de Oliveira Nascimento"), emp("e3", "Elias Marques")],
    );
    expect(p.matched.map((m) => m.employeeId).sort()).toEqual(["e1", "e2"]);
  });

  it("still refuses first and last name when two people answer to it", () => {
    const p = read(
      wbOf({ "04.08": [["Line 1"], ["Ana Lima"]] }),
      [emp("e1", "Ana Paula Lima"), emp("e2", "Ana Beatriz Lima")],
    );
    expect(p.matched).toEqual([]);
    expect(p.unmatchedNames[0].reason).toBe("ambiguous");
    expect(p.unmatchedNames[0].candidates.map((c) => c.id).sort()).toEqual(["e1", "e2"]);
  });

  it("reads a tab named after the month in words", () => {
    expect(parseSheetDate("4 Aug", 2026)).toBe("2026-08-04");
    expect(parseSheetDate("Tue 4 Aug", 2026)).toBe("2026-08-04");
    expect(parseSheetDate("4 August 2025", 2026)).toBe("2025-08-04");
    expect(parseSheetDate("Aug 4", 2026)).toBe("2026-08-04");
    expect(parseSheetDate("4 ago", 2026)).toBe("2026-08-04");
    expect(parseSheetDate("1 Set", 2026)).toBe("2026-09-01");
  });

  it("refuses a day the calendar does not have", () => {
    // Postgres refuses `2026-02-31`, and it refuses the whole upsert with it — one
    // mistyped tab took a month of board down.
    expect(parseSheetDate("31.02", 2026)).toBeNull();
    expect(parseSheetDate("29.02", 2026)).toBeNull();
    expect(parseSheetDate("29.02", 2028)).toBe("2028-02-29");
  });

  it("takes the date from the sheet's own title when the tab was never renamed", () => {
    const p = read(
      wbOf({ Sheet1: [["Day shift — 2026-08-04"], [], ["Line 1"], ["Ana Lima"]] }),
      [emp("e1", "Ana Lima")],
    );
    expect(p.skippedSheets).toEqual([]);
    expect(p.matched).toEqual([expect.objectContaining({ employeeId: "e1", date: "2026-08-04" })]);
  });

  it("does not report the sheet's own total as a column nobody knows", () => {
    const p = read(
      wbOf({ "04.08": [["Line 1", "Line 5", "Total staff  in Production", "Canteen"], ["Ana Lima", "", 77, "Rui Paz"]] }),
      [emp("e1", "Ana Lima")],
    );
    expect(p.unknownColumns).toEqual(["Canteen"]);
  });

  it("does not write the night tab onto the day board", () => {
    const p = read(
      wbOf({
        "04.08 Day": [["Line 1"], ["Ana Lima"]],
        "04.08 Night": [["Line 1"], ["Rui Paz"]],
        "Monday 05.08": [["Line 1"], ["Ana Lima"]],
      }),
      [emp("e1", "Ana Lima"), { ...emp("e2", "Rui Paz"), shift_group: "Night" }],
    );
    expect(p.matched.map((m) => `${m.employeeId}@${m.date}`)).toEqual(["e1@2026-08-04", "e1@2026-08-05"]);
    expect(p.otherShiftSheets).toEqual(["04.08 Night"]);
  });
});

/**
 * Paper. The board printed as the board — cards and chips over three sheets — and what
 * the factory reads every morning is the company's own grid. `printSheetLayout` is that
 * grid, measured against `Production Headcount September.xlsx`.
 */
describe("the day laid out as the company's sheet", () => {
  const sa = (id: string, name: string, section: string, extra: Partial<HeadcountArea> = {}): HeadcountArea =>
    ({ ...area(id, name), section, kind: section === "production" ? "production" : "support", ...extra } as HeadcountArea);
  const AREAS3 = [
    sa("l1", "Line 1", "production"),
    sa("c1", "Capsules Machine 1", "production", { sheet_group: "Pill line" } as Partial<HeadcountArea>),
    sa("c2", "Capsules Machine 2", "production", { sheet_group: "Pill line" } as Partial<HeadcountArea>),
    sa("of", "Office", "support"),
    sa("old", "Closed Line", "production", { active: false }),
  ];
  const al = (employee_id: string, status: string, area_id: string | null, extra: Record<string, unknown> = {}) =>
    ({ id: `a-${employee_id}`, on_date: "2026-09-18", shift: "Day", employee_id, area_id, status,
       half_day: false, left_early_at: null, arrived_late_at: null, note: null, is_leader: false, ...extra }) as never;
  const people = [emp("e1", "Zeca Lima"), emp("e2", "Ana Paz"), emp("e3", "Rui Sá"), emp("e4", "Bia Reis"),
    emp("e5", "Caio Melo"), emp("e6", "Duda Luz"), emp("e7", "Edu Vaz")];
  const layout = (allocations: never[]) =>
    printSheetLayout({ areas: AREAS3, allocations, employeeById: new Map(people.map((p) => [p.id, p])) });

  it("puts the leader on the first row, whatever the alphabet says", () => {
    const l = layout([al("e2", "assigned", "l1"), al("e1", "assigned", "l1", { is_leader: true })]);
    expect(l.top[0].names.map((n) => n.name)).toEqual(["Zeca Lima", "Ana Paz"]);
    expect(l.top[0].names[0].leader).toBe(true);
  });

  it("prints two machines as the one column the sheet has", () => {
    const l = layout([al("e1", "assigned", "c1"), al("e2", "assigned", "c2")]);
    expect(l.top.map((c) => c.label)).toEqual(["Line 1", "Pill line"]);
    expect(l.top[1].names).toHaveLength(2);
  });

  it("has one Absence, and does not say which kind", () => {
    const l = layout([al("e1", "sick", null), al("e2", "unpaid", null)]);
    const absence = l.bottom.find((c) => c.label === "Absence")!;
    expect(absence.names.map((n) => n.name)).toEqual(["Ana Paz", "Zeca Lima"]);
    expect(JSON.stringify(l)).not.toMatch(/sick|unpaid/i);
  });

  it("lists overtime on the line and under Overtime staff, and counts the person once", () => {
    const l = layout([al("e1", "overtime", "l1"), al("e2", "assigned", "of")]);
    expect(l.top[0].names.map((n) => n.name)).toEqual(["Zeca Lima"]);
    expect(l.bottom.find((c) => c.label === "Overtime staff")!.names.map((n) => n.name)).toEqual(["Zeca Lima"]);
    expect(l.totalStaff).toBe(2);
  });

  it("writes the half day beside the name, the way the office does", () => {
    const l = layout([al("e1", "holiday", null, { half_day: true })]);
    expect(l.bottom.find((c) => c.label === "Holidays")!.names[0]).toMatchObject({ name: "Zeca Lima", note: "Half day" });
  });

  it("leaves Training off the sheet until somebody is on it", () => {
    expect(layout([]).bottom.map((c) => c.label)).toEqual(["Office", "Absence", "Holidays", "Overtime staff"]);
    expect(layout([al("e1", "training", null)]).bottom.map((c) => c.label)).toContain("Training");
  });

  it("prints first and last name, and every name when two people would read the same", () => {
    const crew = [emp("e1", "Felipe de Oliveira Nascimento"), emp("e2", "Maria Souza Santos"), emp("e3", "Maria Lima Santos")];
    const l = printSheetLayout({
      areas: AREAS3,
      allocations: [al("e1", "assigned", "l1"), al("e2", "assigned", "l1"), al("e3", "assigned", "of")],
      employeeById: new Map(crew.map((p) => [p.id, p])),
    });
    expect(l.top[0].names.map((n) => n.name)).toEqual(["Felipe Nascimento", "Maria Souza Santos"]);
    expect(l.bottom[0].names.map((n) => n.name)).toEqual(["Maria Lima Santos"]);
  });

  it("gives a closed area no column", () => {
    expect(layout([]).top.map((c) => c.label)).not.toContain("Closed Line");
  });
});
