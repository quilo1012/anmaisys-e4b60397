import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseTimeMotoWorkbook, parseHm, parseDmy, matchNames } from "@/lib/timeMotoSheet";

const book = (rows: unknown[][]) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Timesheet");
  return wb;
};

describe("parseHm", () => {
  it("reads hours and minutes", () => {
    expect(parseHm("8:30")).toBe(510);
    expect(parseHm("12:00")).toBe(720);
    expect(parseHm("07:45")).toBe(465);
  });

  it("keeps a negative balance negative", () => {
    // A short day is -1:15. Reading it as 75 minutes owed inverts somebody's balance.
    expect(parseHm("-1:15")).toBe(-75);
    expect(parseHm("-11:00")).toBe(-660);
  });

  it("reads an Excel time cell, which is a fraction of a day", () => {
    expect(parseHm(0.5)).toBe(720);
    expect(parseHm(0.25)).toBe(360);
  });

  it("says nothing rather than zero when the cell is empty", () => {
    expect(parseHm("")).toBeNull();
    expect(parseHm(null)).toBeNull();
    expect(parseHm("not a time")).toBeNull();
  });
});

describe("parseDmy", () => {
  it("reads the export's day-first dates", () => {
    expect(parseDmy("04/08/26", 2026)).toBe("2026-08-04");
    expect(parseDmy("4/8/2026", 2026)).toBe("2026-08-04");
    expect(parseDmy("04/08", 2026)).toBe("2026-08-04");
  });

  it("reads ISO before day-first", () => {
    // "2026-08-04" contains "26-08-04", which day-first reads as 2004.
    expect(parseDmy("2026-08-04", 2026)).toBe("2026-08-04");
  });

  it("returns null rather than inventing a day", () => {
    expect(parseDmy("Total", 2026)).toBeNull();
    expect(parseDmy("", 2026)).toBeNull();
  });
});

describe("parseTimeMotoWorkbook", () => {
  const HEADER = ["Name", "Date", "In", "Out", "Duration", "Balance", "Absence", "Remarks"];

  it("finds the header under the export's title rows", () => {
    const wb = book([
      ["TimeMoto Timesheet"],
      ["01/08/2026 - 31/08/2026"],
      [],
      HEADER,
      ["Ana Silva", "04/08/26", "06:00", "18:00", "12:00", "3:00", "", ""],
    ]);
    const p = parseTimeMotoWorkbook(wb, 2026);
    expect(p.rows).toHaveLength(1);
    expect(p.rows[0]).toMatchObject({ name: "Ana Silva", date: "2026-08-04", workedMinutes: 720, balanceMinutes: 180 });
  });

  it("carries the name down a block where the export leaves it blank", () => {
    const wb = book([
      HEADER,
      ["Ana Silva", "04/08/26", "06:00", "18:00", "12:00", "3:00", "", ""],
      ["", "05/08/26", "06:00", "14:00", "8:00", "-1:00", "", ""],
    ]);
    const p = parseTimeMotoWorkbook(wb, 2026);
    expect(p.rows).toHaveLength(2);
    expect(p.rows[1].name).toBe("Ana Silva");
    expect(p.rows[1].balanceMinutes).toBe(-60);
  });

  it("records an absence as zero worked, whatever the duration says", () => {
    const wb = book([
      HEADER,
      ["Ana Silva", "06/08/26", "", "", "11:00", "-11:00", "Sickness", "off"],
    ]);
    const p = parseTimeMotoWorkbook(wb, 2026);
    expect(p.rows[0]).toMatchObject({ absence: "Sickness", workedMinutes: 0, balanceMinutes: -660 });
  });

  it("skips a total line instead of importing it as a person", () => {
    const wb = book([
      HEADER,
      ["Ana Silva", "04/08/26", "06:00", "18:00", "12:00", "3:00", "", ""],
      ["Total", "", "", "", "12:00", "3:00", "", ""],
    ]);
    const p = parseTimeMotoWorkbook(wb, 2026);
    expect(p.rows).toHaveLength(1);
    expect(p.skipped.some((s) => s.reason.includes("total"))).toBe(true);
  });

  it("says so when it cannot find the columns at all", () => {
    // A file this parser does not understand must report that, not import nothing
    // quietly and look like an empty month.
    const p = parseTimeMotoWorkbook(book([["Something", "Else"], ["a", "b"]]), 2026);
    expect(p.rows).toHaveLength(0);
    expect(p.skipped[0].reason).toContain("No header row");
  });

  it("reports the headings it did not recognise", () => {
    const wb = book([
      [...HEADER, "Cost Centre"],
      ["Ana Silva", "04/08/26", "06:00", "18:00", "12:00", "3:00", "", "", "Packing"],
    ]);
    const p = parseTimeMotoWorkbook(wb, 2026);
    expect(p.ignoredColumns).toContain("Cost Centre");
    expect(p.columns["Duration"]).toBe("workedMinutes");
  });

  it("reports the range it covers", () => {
    const wb = book([
      HEADER,
      ["Ana Silva", "04/08/26", "", "", "8:00", "", "", ""],
      ["Ana Silva", "01/08/26", "", "", "8:00", "", "", ""],
    ]);
    const p = parseTimeMotoWorkbook(wb, 2026);
    expect(p.from).toBe("2026-08-01");
    expect(p.to).toBe("2026-08-04");
  });
});

describe("the real TimeMoto column names", () => {
  // Firstname and Lastname are separate columns in the export. A parser looking only
  // for "Name" finds no name column, fails the header hunt, and rejects the whole
  // file as unreadable — which is what the first version of this did.
  const REAL = ["Firstname", "Lastname", "Date", "Duration", "WorkSchedule", "Balance", "OvertimeAdjustment", "AbsenceName"];

  it("joins Firstname and Lastname into one person", () => {
    const p = parseTimeMotoWorkbook(book([
      REAL,
      ["Ana", "Silva", "04/08/26", "12:00", "8:00", "4:00", "0:00", ""],
    ]), 2026);
    expect(p.rows).toHaveLength(1);
    expect(p.rows[0].name).toBe("Ana Silva");
  });

  it("reads WorkSchedule and OvertimeAdjustment, which the table has columns for", () => {
    const p = parseTimeMotoWorkbook(book([
      REAL,
      ["Ana", "Silva", "04/08/26", "12:00", "8:00", "4:00", "-0:30", ""],
    ]), 2026);
    expect(p.rows[0].scheduledMinutes).toBe(480);
    expect(p.rows[0].overtimeAdjMinutes).toBe(-30);
  });

  it("reads AbsenceName and forces the day to zero worked", () => {
    const p = parseTimeMotoWorkbook(book([
      REAL,
      ["Ana", "Silva", "06/08/26", "11:00", "8:00", "-11:00", "0:00", "Sickness"],
    ]), 2026);
    expect(p.rows[0]).toMatchObject({ absence: "Sickness", workedMinutes: 0, balanceMinutes: -660 });
  });

  it("carries a surname-only blank down the block", () => {
    const p = parseTimeMotoWorkbook(book([
      REAL,
      ["Ana", "Silva", "04/08/26", "8:00", "8:00", "0:00", "", ""],
      ["", "", "05/08/26", "8:00", "8:00", "0:00", "", ""],
    ]), 2026);
    expect(p.rows.map((r) => r.name)).toEqual(["Ana Silva", "Ana Silva"]);
  });
});

describe("matchNames", () => {
  const ROSTER = [
    { id: "e1", full_name: "Marcio Carvalho" },
    { id: "e2", full_name: "Ana Silva" },
    { id: "e3", full_name: "Maria Souza" },
    { id: "e4", full_name: "Maria Costa" },
  ];

  it("matches a full name that appears once", () => {
    expect(matchNames(["Ana Silva"], ROSTER).matched).toEqual([{ name: "Ana Silva", employeeId: "e2" }]);
  });

  it("refuses a suffixed duplicate account", () => {
    // "Marcio Carvalho 1" is a real row in the export. Attaching it to Marcio
    // Carvalho would post somebody else's hours to his record.
    const r = matchNames(["Marcio Carvalho 1"], ROSTER);
    expect(r.matched).toEqual([]);
    expect(r.unmatched).toEqual(["Marcio Carvalho 1"]);
  });

  it("refuses a first name two people share", () => {
    expect(matchNames(["Maria"], ROSTER).unmatched).toEqual(["Maria"]);
  });

  it("takes a first name only one person answers to", () => {
    expect(matchNames(["Marcio"], ROSTER).matched[0].employeeId).toBe("e1");
  });
});
