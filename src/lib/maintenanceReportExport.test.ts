import { describe, it, expect } from "vitest";
import XLSX from "xlsx-js-style";
import { buildMaintenanceShiftReport, shiftWindowFor } from "@/lib/maintenanceShiftReport";
import { reportToFile } from "@/lib/maintenanceReportExport";

/**
 * Three formats, one report. Each file is read back and checked against the report
 * object it was drawn from — the same completed orders, open orders and totals.
 */
const t = (s: string) => `2026-10-${s}:00.000Z`;
const report = buildMaintenanceShiftReport({
  window: shiftWindowFor("2026-10-28", "night"),
  generatedAt: new Date(t("29T06:10")),
  generatedBy: "Eng B",
  workOrders: [
    { id: "a", wo_number: 101, line_at_time: "Line 2", line_name: null, description: "Labeller fault", resolution_notes: "Reset sensor", status: "closed", engineer_name: "Eng A", machine: "Labeller" },
    { id: "b", wo_number: 102, line_at_time: "Line 3", line_name: null, description: "Jam", resolution_notes: null, status: "finished", engineer_name: null, machine: null },
  ],
  events: [
    { id: "e1", work_order_id: "a", stopped_at: t("28T20:00"), resumed_at: t("28T20:47"), duration_minutes: 47 },
    { id: "e2", work_order_id: "b", stopped_at: t("28T22:00"), resumed_at: t("28T22:05"), duration_minutes: 5 },
    { id: "e3", work_order_id: "gone", stopped_at: t("29T01:00"), resumed_at: t("29T01:30"), duration_minutes: 30 },
  ],
  exclusions: [],
  plannedProblems: [],
  completedOrders: [
    { id: "a", wo_number: 101, line_at_time: "Line 2", line_name: null, description: "Labeller fault", resolution_notes: "Reset sensor", status: "closed", engineer_name: "Eng A", machine: "Labeller", completed_at_effective: t("28T21:00") },
    { id: "b", wo_number: 102, line_at_time: "Line 3", line_name: null, description: "Jam", resolution_notes: null, status: "finished", engineer_name: null, machine: null, completed_at_effective: t("28T23:00") },
  ],
  pending: [{
    id: "p", wo_number: 200, line_at_time: "Line 7", line_name: null, description: "Filler leak", status: "in_progress",
    engineer_name: "Eng A", created_at: t("29T05:00"),
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

  it("Excel holds the summary, the completed orders and the open orders", async () => {
    const f = await reportToFile(report, "xlsx");
    expect(f.name).toBe("Maintenance_Report_Night_Shift_2026-10-28.xlsx");
    const wb = XLSX.read(await bytes(f), { type: "buffer" });
    expect(wb.SheetNames).toEqual(["Summary", "Completed", "Open"]);

    const sum = XLSX.utils.sheet_to_json<string[]>(wb.Sheets["Summary"], { header: 1 });
    const get = (k: string) => sum.find((row) => row[0] === k)?.[1];
    expect(get("Completed work orders")).toBe(2);
    expect(get("Downtime events")).toBe(2);
    expect(get("Total counted downtime")).toBe("0h 52m");
    expect(get("Open work orders")).toBe(1);

    const done = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Completed"]);
    expect(done.map((r) => [r["WO"], r["Problem"], r["Work carried out"], r["Engineer"], r["Downtime"]])).toEqual([
      [102, "Jam", "Not recorded", "Not assigned", "0h 5m"],
      [101, "Labeller fault", "Reset sensor", "Eng A", "0h 47m"],
    ]);

    const open = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Open"]);
    expect(open.map((r) => [r["WO"], r["Line"], r["Problem"], r["Engineer"], r["Status"], r["Downtime"]])).toEqual([
      [200, "Line 7", "Filler leak", "Eng A", "OPEN", "No downtime this shift"],
    ]);
  });

  it("an order that stopped the line this shift and was finished later is in its own sheet and PDF table", async () => {
    const later = buildMaintenanceShiftReport({
      window: shiftWindowFor("2026-10-28", "night"),
      generatedAt: new Date(t("30T10:00")),
      workOrders: [{ id: "c", wo_number: 149, line_at_time: "Capsules Machine 2", line_name: null, description: "Drill Fault", resolution_notes: null, status: "finished", engineer_name: "Eng A", machine: null, completed_at_effective: t("29T09:00") }],
      events: [{ id: "e1", work_order_id: "c", stopped_at: t("29T05:00"), resumed_at: t("29T07:00"), duration_minutes: 120 }],
      exclusions: [],
      plannedProblems: [],
    });
    const wb = XLSX.read(await bytes(await reportToFile(later, "xlsx")), { type: "buffer" });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Completed later"]);
    expect(rows.map((r) => [r["WO"], r["Line"], r["Status"], r["Downtime"]])).toEqual([
      [149, "Capsules Machine 2", "Completed 29/10/2026 09:00", "1h 0m"],
    ]);
    const pdf = (await bytes(await reportToFile(later, "pdf"))).toString("latin1");
    expect(pdf).toContain("(Stopped this shift, completed later)");
    expect(pdf).toContain("WO-149");
  });

  it("PDF names the shift, shows the total downtime prominently and lists completed and open orders", async () => {
    const f = await reportToFile(report, "pdf");
    expect(f.name).toBe("Maintenance_Report_Night_Shift_2026-10-28.pdf");
    const pdf = (await bytes(f)).toString("latin1");
    expect(pdf.startsWith("%PDF")).toBe(true);
    expect(pdf).toContain("(Night Shift \u00b7 28/10/2026)");
    expect(pdf).toContain("(TOTAL COUNTED DOWNTIME)");
    expect(pdf).toContain("(Completed work orders)");
    expect(pdf).toContain("(Open work orders)");
    expect(pdf).toContain("WO-101");
    expect(pdf).toContain("WO-200");
    expect(pdf).toContain("(OPEN)");
    // No technical detail: no sources, no generator, no validation counters.
    expect(pdf).not.toContain("downtime_events");
    expect(pdf).not.toContain("NOT VALIDATED");
    expect(pdf).not.toContain("(Generated by");
  });
});
