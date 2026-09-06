import { describe, it, expect } from "vitest";
import { downtimeToMinutes, numberOrUndefined, mapRagApiRecords, type RagApiRecord } from "@/lib/ragApiMapping";

const LINES = ["Line 1", "Line 2", "Capsules and Tablets"];

const rec = (over: Partial<RagApiRecord> = {}): RagApiRecord => ({
  date: "2026-08-24",
  line: "Line 1",
  sheet: "WC 240826",
  source_file: "August Production RAG Performance v1.xlsx",
  metrics: {
    plan: { day: 3449, night: 3300, total: 6749 },
    actual: { day: 2543, night: 3306, total: 5849 },
    upm_target: { day: null, night: null, total: 5.92 },
    upm_actual: { day: null, night: null, total: 5.13 },
    downtime: { day: "2:00", night: "0:30", total: "2:30" },
  },
  ...over,
});

describe("downtimeToMinutes", () => {
  it("reads a workbook time as minutes", () => {
    expect(downtimeToMinutes("2:00")).toBe(120);
    expect(downtimeToMinutes("02:45:00")).toBe(165);
    expect(downtimeToMinutes(45)).toBe(45);
  });
  it("says nothing when the cell is empty", () => {
    expect(downtimeToMinutes("")).toBeUndefined();
    expect(downtimeToMinutes(null)).toBeUndefined();
  });
});

describe("numberOrUndefined", () => {
  it("never turns a blank into a zero", () => {
    expect(numberOrUndefined(null)).toBeUndefined();
    expect(numberOrUndefined("")).toBeUndefined();
    expect(numberOrUndefined(0)).toBe(0);
    expect(numberOrUndefined("1,200")).toBe(1200);
  });
});

describe("mapRagApiRecords", () => {
  it("splits a day into two shifts with its own volumes and downtime", () => {
    const { rows } = mapRagApiRecords([rec()], LINES);
    const day = rows.find((r) => r.shift === "DAY")!;
    const night = rows.find((r) => r.shift === "NIGHT")!;
    expect(day.plan_qty).toBe(3449);
    expect(night.actual_qty).toBe(3306);
    expect(day.downtime_min).toBe(120);
    expect(night.downtime_min).toBe(30);
  });

  it("spreads the day-total UPM to both shifts", () => {
    const { rows } = mapRagApiRecords([rec()], LINES);
    expect(rows.every((r) => r.upm_target === 5.92 && r.upm_actual === 5.13)).toBe(true);
  });

  it("does not give UPM to a shift that never ran", () => {
    const r = rec({
      metrics: {
        plan: { day: 100, night: null },
        actual: { day: 90, night: null },
        upm_target: { total: 5 },
        upm_actual: { total: 4 },
        downtime: { day: null, night: null },
      },
    });
    const { rows } = mapRagApiRecords([r], LINES);
    expect(rows).toHaveLength(1);
    expect(rows[0].shift).toBe("DAY");
    expect(rows[0].upm_target).toBe(5);
  });

  it("leaves a missing value out instead of writing zero", () => {
    const r = rec({
      metrics: { plan: { day: 100, night: null }, actual: {}, downtime: {} },
    });
    const { rows } = mapRagApiRecords([r], LINES);
    expect(rows[0].actual_qty).toBeUndefined();
    expect(rows[0].downtime_min).toBeUndefined();
  });

  it("never imports variance", () => {
    const r = rec({ metrics: { ...rec().metrics, variance: { day: -0.2 } } as any });
    const { rows } = mapRagApiRecords([r], LINES);
    expect(JSON.stringify(rows)).not.toContain("variance");
  });

  it("matches line names ignoring case and punctuation", () => {
    const { rows, linesDetected } = mapRagApiRecords([rec({ line: "capsules & tablets" })], LINES);
    expect(rows[0].line).toBe("Capsules and Tablets");
    expect(linesDetected).toEqual(["Capsules and Tablets"]);
  });

  it("reports a line the board does not know instead of dropping it quietly", () => {
    const { rows, linesIgnored } = mapRagApiRecords([rec({ line: "Line 9" })], LINES);
    expect(rows).toHaveLength(0);
    expect(linesIgnored).toEqual([{ name: "Line 9", reason: "no line with this name on the board" }]);
  });

  it("keeps the day a comment belongs to and its Monday", () => {
    const r = rec({ date: "2026-08-26", metrics: { ...rec().metrics, comments: "Blender fault" } as any });
    const { comments } = mapRagApiRecords([r], LINES);
    expect(comments[0]).toMatchObject({
      line: "Line 1", comment: "Blender fault", entry_date: "2026-08-26", week_start: "2026-08-24",
    });
  });

  it("collects the sheets, files and dates it read", () => {
    const { sheets, files, datesDetected } = mapRagApiRecords([rec(), rec({ date: "2026-08-25" })], LINES);
    expect(sheets).toEqual(["WC 240826"]);
    expect(files).toEqual(["August Production RAG Performance v1.xlsx"]);
    expect(datesDetected).toEqual(["2026-08-24", "2026-08-25"]);
  });

  it("maps every weekday by its API date, regardless of array order", () => {
    const sunday = rec({
      date: "2026-09-13",
      metrics: {
        plan: { day: null, night: null, total: 0, yield_percent: 0.98 },
        actual: { day: null, night: null, total: 0 },
        downtime: { day: null, night: null, total: 0 },
      },
    });
    const monday = rec({ date: "2026-09-07" });

    const { rows, datesDetected } = mapRagApiRecords([sunday, monday], LINES);

    expect(rows.filter((row) => row.entry_date === "2026-09-13")).toEqual([]);
    expect(rows.filter((row) => row.entry_date === "2026-09-07")).toHaveLength(2);
    expect(datesDetected).toEqual(["2026-09-07"]);
  });

  it("never turns a day total or progressive total into a shift value", () => {
    const { rows } = mapRagApiRecords([rec({
      date: "2026-09-13",
      metrics: {
        plan: { day: null, night: null, total: 4526 },
        actual: { day: null, night: null, total: 0 },
        downtime: { day: null, night: null, total: 0 },
      },
    })], LINES);

    expect(rows).toEqual([]);
  });
});
