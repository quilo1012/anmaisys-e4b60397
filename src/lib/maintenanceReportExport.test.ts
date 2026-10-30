import { describe, it, expect } from "vitest";
import XLSX from "xlsx-js-style";
import { buildMaintenanceShiftReport, shiftWindowFor } from "@/lib/maintenanceShiftReport";
import { reportToFile } from "@/lib/maintenanceReportExport";

/**
 * Three formats, one report. Each file is read back and checked against the report
 * object it was drawn from — the same items, totals and NOT VALIDATED list.
 */
const t = (s: string) => `2026-10-${s}:00.000Z`;
const report = buildMaintenanceShiftReport({
  window: shiftWindowFor("2026-10-28", "night"),
  generatedAt: new Date(t("29T06:10")),
  generatedBy: "Eng B",
  workOrders: [
    { id: "a", wo_number: 101, line_at_time: "Line 2", line_name: null, description: "Labeller fault", resolution_notes: "Reset sensor", status: "closed" },
    { id: "b", wo_number: 102, line_at_time: "Line 3", line_name: null, description: "Jam", resolution_notes: null, status: "finished" },
  ],
  events: [
    { id: "e1", work_order_id: "a", stopped_at: t("28T20:00"), resumed_at: t("28T20:47"), duration_minutes: 47 },
    { id: "e2", work_order_id: "b", stopped_at: t("28T22:00"), resumed_at: t("28T22:05"), duration_minutes: 5 },
    { id: "e3", work_order_id: "gone", stopped_at: t("29T01:00"), resumed_at: t("29T01:30"), duration_minutes: 30 },
  ],
  exclusions: [],
  plannedProblems: [],
  pending: [{
    id: "p", wo_number: 200, line_at_time: "Line 7", line_name: null, description: "Filler leak", status: "in_progress",
    engineer_name: "Eng A", paused_at: null, pause_reason: null, created_at: t("29T05:00"), stopped_since: t("29T05:30"),
  }],
});

// jsdom's File has no arrayBuffer(); FileReader it does have.
const bytes = (f: File) => new Promise<Buffer>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(Buffer.from(r.result as ArrayBuffer));
  r.onerror = () => reject(r.error);
  r.readAsArrayBuffer(f);
});

describe("reportToFile", () => {
  it("TXT is the report text, under the standard name", async () => {
    const f = await reportToFile(report, "txt");
    expect(f.name).toBe("Maintenance_Report_Night_Shift_2026-10-28.txt");
    expect((await bytes(f)).toString("utf8")).toBe(report.text);
  });

  it("Excel holds every stop read with the report's verdict, and the totals of the summary", async () => {
    const f = await reportToFile(report, "xlsx");
    expect(f.name).toBe("Maintenance_Report_Night_Shift_2026-10-28.xlsx");
    const wb = XLSX.read(await bytes(f), { type: "buffer" });
    expect(wb.SheetNames).toEqual(["Summary", "Over 15 min", "All stops read", "Handover", "Not validated"]);

    const all = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["All stops read"]);
    const cell = (v: unknown) => (v === undefined || v === "" ? null : v);
    expect(all.map((r) => [cell(r["WO"]), r["In report"], cell(r["Minutes in shift"])])).toEqual(
      report.rows.map((r) => [r.woNumber, r.verdict, r.minutes]),
    );

    const sum = XLSX.utils.sheet_to_json<string[]>(wb.Sheets["Summary"], { header: 1 });
    const get = (k: string) => sum.find((row) => row[0] === k)?.[1];
    expect(get("Stops recorded")).toBe(report.stopsRead);
    expect(get("Stops over 15 min")).toBe(1);
    expect(get("Minutes over 15 min")).toBe(47);
    expect(String(get("Validation"))).toMatch(/^NOT VALIDATED — 1/);

    const notValid = XLSX.utils.sheet_to_json<string[]>(wb.Sheets["Not validated"], { header: 1 }).slice(1).map((r) => r[0]);
    expect(notValid).toEqual(report.problems);
  });

  it("PDF names the shift, flags the disagreement and lists every stop read", async () => {
    const f = await reportToFile(report, "pdf");
    expect(f.name).toBe("Maintenance_Report_Night_Shift_2026-10-28.pdf");
    const pdf = (await bytes(f)).toString("latin1");
    expect(pdf.startsWith("%PDF")).toBe(true);
    expect(pdf).toContain("(Night Shift \u00b7 28/10/2026)");
    expect(pdf).toContain("NOT VALIDATED");
    expect(pdf).toContain("(Every stop read, and what the report did with it)");
    expect(pdf).toContain("(WO-101)");
    expect(pdf).toContain("(WO-200)");
  });
});
