import { describe, expect, it } from "vitest";
import { buildPatternWhatsAppReport, patternReportRecords, type PatternReportRecord } from "./patternWhatsAppReport";

const scope = { fromMs: Date.parse("2026-10-19T05:00:00Z"), toMs: Date.parse("2026-10-20T05:00:00Z"), lineFilter: "all", shiftFilter: "Day" as const };
const row: PatternReportRecord = { id: "a", line: "Line 1", category: "Mechanical", reason: "Flange adjustment required.",
  notes: "Awaiting inspection", started_at: "2026-10-19T16:30:00Z", ended_at: "2026-10-19T18:00:00Z", source: "manual" };
const report = (records: PatternReportRecord[], lines = ["Line 1"], categories = ["Mechanical"]) => buildPatternWhatsAppReport(records, scope, lines, categories);

describe("Pattern Matrix WhatsApp report accuracy", () => {
  it("uses only the selected shift portion of a spanning stop", () => {
    expect(report([row])).toContain("0h 30m");
    expect(report([row])).not.toContain("1h 30m");
  });
  it("includes a night portion even when the stop started in Day", () => {
    expect(patternReportRecords([row], { ...scope, shiftFilter: "Night" })).toHaveLength(1);
  });
  it("preserves problem and operational notes", () => {
    expect(report([row])).toContain(row.reason);
    expect(report([row])).toContain(row.notes);
  });
  it("excludes No Planned Shift", () => {
    expect(report([{ ...row, reason: "No Planned Shift" }])).toBe("");
  });
  it("respects line and recorded-category selection", () => {
    expect(report([row], ["Line 3"])).toBe("");
    expect(report([row], ["Line 1"], ["Electrical"])).toBe("");
    expect(buildPatternWhatsAppReport([row], { ...scope, lineFilter: "Line 3" }, ["Line 1"], ["Mechanical"])).toBe("");
  });
  it("excludes records outside the selected date range", () => {
    expect(report([{ ...row, started_at: "2026-10-18T06:00:00Z", ended_at: "2026-10-18T07:00:00Z" }])).toBe("");
  });
  it("joins exclusion fragments once without double-counting their duration", () => {
    const fragments = [{ ...row, id: "a#0", source_row_id: "a", started_at: "2026-10-19T06:00:00Z", ended_at: "2026-10-19T06:10:00Z" },
      { ...row, id: "a#1", source_row_id: "a", started_at: "2026-10-19T06:20:00Z", ended_at: "2026-10-19T06:30:00Z" }];
    expect(report(fragments).split("Flange adjustment required.")).toHaveLength(2);
    expect(report(fragments)).toContain("0h 20m");
  });
  it("does not treat automatically closed time as a repair", () => {
    const result = report([{ ...row, source: "wo_event", notes: "Auto-closed at shift end" }]);
    expect(result).toContain("not evidence that the issue was resolved");
  });
  it("does not invent an issue when nothing is recorded", () => {
    expect(report([])).toBe("");
  });
});