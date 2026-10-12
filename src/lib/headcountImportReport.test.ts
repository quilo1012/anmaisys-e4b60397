import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseHeadcountWorkbook, parseSheetDate, rowsToImport } from "@/lib/headcountSheet";
import { headcountApiToWorkbook } from "@/lib/headcountApi";
import { importReport, otherBoardLeftOut, boardNotImported } from "@/lib/headcountImportReport";
import type { HeadcountArea, HeadcountEmployee } from "@/hooks/useHeadcount";

const area = (id: string, name: string, sheet_label: string | null = null): HeadcountArea => ({
  id, name, kind: "production", section: "production", department: null, sort_order: 0, active: true, sheet_label,
} as HeadcountArea);
const person = (id: string, full_name: string, shift_group: string): HeadcountEmployee => ({
  id, full_name, shift_group, department: null, shift_pattern_id: null,
});

const AREAS = [area("l1", "Line 1"), area("l5", "Line 5", "Line 5 (A&B)"), area("hy", "Hygiene")];
const ROSTER = [
  person("n1", "Kazimieras Kaz", "Night"), person("n2", "Emily Rose", "Night"),
  person("n3", "Cainan Lopes", "Night"), person("n4", "Gessica Alves", "Night"),
  person("d1", "Ana Lima", "Day"),
];

/** The night workbook as the factory keeps it: one tab per date, no shift in the name. */
function nightBook(tabs: Record<string, string[][]>) {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(tabs)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  return wb;
}
const NIGHT_TAB = [
  ["Line 1", "Line 5 (A&B)", "Hygiene"],
  ["KAZ", "CAINAN", "GESSICA"],
  ["EMILY", "", ""],
];
const read = (wb: XLSX.WorkBook, shift: "Day" | "Night") =>
  parseHeadcountWorkbook(wb, { areas: AREAS, roster: ROSTER, shift, fallbackYear: 2026 });

describe("night sheet dates", () => {
  it("reads the night workbook's tabs as the date the night starts", () => {
    // A night dated D runs 18:00 on D to 06:00 on D+1, and the sheet is filed under D.
    expect(parseSheetDate("14.10.2026", 2026)).toBe("2026-10-14");
    expect(parseSheetDate("14.10.2026  ", 2026)).toBe("2026-10-14");
    expect(parseSheetDate("02.10.2026(OVERTIME)", 2026)).toBe("2026-10-02");
    expect(parseSheetDate("14.10 Night", 2026)).toBe("2026-10-14");
  });

  it("puts a 14/10 night tab on the Night board, on the 14th", () => {
    const p = read(nightBook({ "14.10.2026": NIGHT_TAB }), "Night");
    expect(p.days).toEqual(["2026-10-14"]);
    expect(p.otherShiftSheets).toEqual([]);
    expect(p.matched).toHaveLength(4);
    expect(new Set(p.matched.map((m) => `${m.date}|${m.shift}`))).toEqual(new Set(["2026-10-14|Night"]));
    expect(p.crews).toEqual({ Day: 0, Night: 4 });
  });

  it("reads every date of a three-night workbook, not only the first tab", () => {
    const p = read(nightBook({ "13.10.2026": NIGHT_TAB, "14.10.2026": NIGHT_TAB, "15.10.2026": NIGHT_TAB }), "Night");
    expect(p.days).toEqual(["2026-10-13", "2026-10-14", "2026-10-15"]);
    expect(p.matched).toHaveLength(12);
  });

  it("keeps the 14/10 night apart from the 14/10 day when both tabs are in one file", () => {
    const wb = nightBook({ "14.10 Day": [["Line 1"], ["Ana Lima"]], "14.10 Night": NIGHT_TAB });
    const night = read(wb, "Night");
    expect(night.matched.map((m) => m.employeeId).sort()).toEqual(["n1", "n2", "n3", "n4"]);
    expect(night.otherShiftSheets).toEqual(["14.10 Day"]);
    const day = read(wb, "Day");
    expect(day.matched.map((m) => `${m.employeeId}|${m.date}|${m.shift}`)).toEqual(["d1|2026-10-14|Day"]);
    expect(day.otherShiftSheets).toEqual(["14.10 Night"]);
  });

  it("files a SharePoint night answer for 14/10 under the 14th on the Night board", () => {
    const wb = headcountApiToWorkbook({
      date: "2026-10-14", shift: "night",
      production: { "Line 1": ["KAZ", "EMILY"], "Line 5 (A&B)": ["CAINAN"], Hygiene: ["GESSICA"] },
    });
    expect(wb.SheetNames).toEqual(["2026-10-14 Night"]);
    const p = read(wb, "Night");
    expect(p.matched).toHaveLength(4);
    expect(p.matched.every((m) => m.date === "2026-10-14" && m.shift === "Night")).toBe(true);
    // And refuses to put it on the Day board.
    expect(read(wb, "Day").otherShiftSheets).toEqual(["2026-10-14 Night"]);
  });

  it("writes one row per person per date and board — the key the upsert conflicts on", () => {
    const p = read(nightBook({ "14.10.2026": NIGHT_TAB }), "Night");
    const rows = rowsToImport({
      matched: p.matched,
      cover: () => ({ due: true, crew: "Night" }) as never,
      leaders: [],
    });
    const keys = rows.map((r) => `${r.employee_id}|${r.on_date}|${r.shift}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(rows.every((r) => r.on_date === "2026-10-14" && r.shift === "Night")).toBe(true);
  });
});

describe("importReport", () => {
  it("says, for every date, that a Day import leaves the Night board untouched", () => {
    const day = nightBook({
      "13.10.2026": [["Line 1"], ["Ana Lima"]],
      "14.10.2026": [["Line 1"], ["Ana Lima"]],
      "15.10.2026": [["Line 1"], ["Ana Lima"]],
    });
    const lines = importReport(read(day, "Day"), "Day", 2026);
    expect(lines.filter((l) => l.shift === "Day").map((l) => [l.date, l.written])).toEqual([
      ["2026-10-13", 1], ["2026-10-14", 1], ["2026-10-15", 1],
    ]);
    const night = lines.filter((l) => l.shift === "Night");
    expect(night.map((l) => l.date)).toEqual(["2026-10-13", "2026-10-14", "2026-10-15"]);
    expect(night.every((l) => l.written === 0 && /not in this file/.test(l.reasons[0]))).toBe(true);
    expect(otherBoardLeftOut(lines, "Day")).toEqual(["2026-10-13", "2026-10-14", "2026-10-15"]);
  });

  it("names the night tab it skipped and how to import it", () => {
    const wb = nightBook({ "14.10 Day": [["Line 1"], ["Ana Lima"]], "14.10 Night": NIGHT_TAB });
    const lines = importReport(read(wb, "Day"), "Day", 2026);
    const night = lines.find((l) => l.shift === "Night" && l.date === "2026-10-14")!;
    expect(night.written).toBe(0);
    expect(night.reasons[0]).toMatch(/“14.10 Night” is for the Night board — switch the target to Night/);
  });

  it("counts names held back on a date, with the reason", () => {
    const wb = nightBook({ "14.10.2026": [["Line 1", "Hygiene"], ["KAZ", "Nobody Known"], ["Ana", ""]] });
    const line = importReport(read(wb, "Night"), "Night", 2026).find((l) => l.shift === "Night")!;
    expect(line).toMatchObject({ date: "2026-10-14", written: 1, skipped: 2 });
    expect(line.reasons.join(" | ")).toMatch(/nobody on the payroll answers to/);
    expect(line.reasons.join(" | ")).toMatch(/only matching someone on the Day crew/);
  });

  it("reports a tab with no readable date instead of dropping it", () => {
    const lines = importReport(read(nightBook({ Sheet9: NIGHT_TAB }), "Night"), "Night", 2026);
    expect(lines).toEqual([expect.objectContaining({ date: null, reasons: [expect.stringMatching(/“Sheet9”/)] })]);
  });
});

describe("boardNotImported", () => {
  it("warns on an empty board the rota expects people on", () => {
    expect(boardNotImported({ loading: false, allocations: 0, dueOnRota: 64 })).toBe(true);
  });
  it("stays quiet while loading, once anybody is placed, and on a day nobody is due", () => {
    expect(boardNotImported({ loading: true, allocations: 0, dueOnRota: 64 })).toBe(false);
    expect(boardNotImported({ loading: false, allocations: 3, dueOnRota: 64 })).toBe(false);
    expect(boardNotImported({ loading: false, allocations: 0, dueOnRota: 0 })).toBe(false);
  });
});
