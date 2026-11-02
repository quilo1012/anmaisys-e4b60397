import { describe, it, expect } from "vitest";
import { boldText,
  buildMaintenanceShiftReport,
  shiftWindowAt,
  type ShiftReportData,
} from "@/lib/maintenanceShiftReport";

// 29/10/2026 is GMT (the clocks went back on the 25th), so London = UTC.
const DAY = shiftWindowAt(new Date("2026-10-29T14:30:00Z"));
const at = (hm: string) => `2026-10-29T${hm}:00.000Z`;

function data(over: Partial<ShiftReportData> = {}): ShiftReportData {
  return {
    window: DAY,
    generatedAt: new Date(at("14:30")),
    workOrders: [],
    events: [],
    exclusions: [],
    plannedProblems: [],
    ...over,
  };
}

const wo = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  wo_number: Number(id.replace(/\D/g, "")) || 1,
  line_at_time: "Line 4",
  line_name: null,
  description: "Capper jam",
  resolution_notes: "Replaced the capper belt",
  status: "finished",
  engineer_name: "Eng A",
  machine: "Capper",
  ...extra,
});

describe("shiftWindowAt", () => {
  it("is the London shift running at that instant, not the one the page opened in", () => {
    expect(DAY.shift).toBe("day");
    expect(DAY.sessionDate).toBe("2026-10-29");
    expect(DAY.start.toISOString()).toBe(at("06:00"));
    expect(DAY.end.toISOString()).toBe(at("18:00"));
  });

  it("files 02:00 under the night that started the evening before", () => {
    const w = shiftWindowAt(new Date("2026-10-29T02:00:00Z"));
    expect(w.shift).toBe("night");
    expect(w.sessionDate).toBe("2026-10-28");
    expect(w.start.toISOString()).toBe("2026-10-28T18:00:00.000Z");
    expect(w.end.toISOString()).toBe(at("06:00"));
  });

  it("follows London summer time, not the browser's zone", () => {
    const w = shiftWindowAt(new Date("2026-07-15T12:00:00Z"));
    expect(w.start.toISOString()).toBe("2026-07-15T05:00:00.000Z"); // 06:00 BST
  });
});

describe("buildMaintenanceShiftReport — the printed file", () => {
  it("carries no technical information: no sources, no generator, no counters, no hand-over, no greeting", () => {
    const r = buildMaintenanceShiftReport(data({
      generatedBy: "Eng B",
      workOrders: [wo("w1")],
      events: [{ id: "e1", work_order_id: "w1", stopped_at: at("08:00"), resumed_at: at("08:40"), duration_minutes: 40 }],
      completedOrders: [wo("w1", { completed_at_effective: at("09:00") })],
      pending: [{ id: "p", wo_number: 9, line_at_time: "Line 7", line_name: null, description: "Filler leak", status: "open", engineer_name: null, created_at: at("10:00") }],
    }));
    expect(r.text).not.toMatch(/source|generated|planned stop|team-activity|not validated|handover|have a good day/i);
    expect(r.text).not.toContain("Eng B");
  });

  it("shows each genuinely completed order with its problem, the work carried out, the engineer and a prominent downtime", () => {
    const r = buildMaintenanceShiftReport(data({
      workOrders: [wo("w1")],
      events: [{ id: "e1", work_order_id: "w1", stopped_at: at("08:00"), resumed_at: at("08:40"), duration_minutes: 40 }],
      completedOrders: [wo("w1", { completed_at_effective: at("09:00") })],
    }));
    expect(r.completed).toHaveLength(1);
    expect(r.completed[0].totalMinutes).toBe(40);
    expect(r.text).toContain(boldText("Line 4 – WO-1"));
    expect(r.text).toContain("Machine: Capper");
    expect(r.text).toContain("Problem: Capper jam");
    expect(r.text).toContain("Work carried out: Replaced the capper belt");
    expect(r.text).toContain("Engineer: Eng A");
    expect(r.text).toContain(`Downtime: ${boldText("0h 40m")}`);
  });

  it("lists a completed order that had no stoppage at all — completed is not derived from downtime", () => {
    const r = buildMaintenanceShiftReport(data({
      completedOrders: [wo("w2", { completed_at_effective: at("11:00") })],
    }));
    expect(r.completed).toHaveLength(1);
    expect(r.completed[0].totalMinutes).toBe(0);
    expect(r.text).toContain("Completed work orders: 1");
    expect(r.text).toContain(`Downtime: ${boldText("0h 0m")}`);
  });

  it("an open order with a stoppage is open, never completed — and its minutes still count", () => {
    // The 01/11 Day shift shape: WO-1451 Printer Fault, Line 2, open, not assigned.
    const r = buildMaintenanceShiftReport(data({
      workOrders: [wo("w1451", { wo_number: 1451, line_at_time: "Line 2", description: "Printer Fault", status: "open", engineer_name: null })],
      events: [{ id: "e1", work_order_id: "w1451", stopped_at: at("12:10"), resumed_at: at("12:22"), duration_minutes: 12 }],
      pending: [{ id: "w1451", wo_number: 1451, line_at_time: "Line 2", line_name: null, description: "Printer Fault", status: "open", engineer_name: null, created_at: at("12:00") }],
    }));
    expect(r.completed).toHaveLength(0);
    expect(r.open.map((p) => p.wo_number)).toEqual([1451]);
    expect(r.downtimeEvents).toBe(1);
    expect(r.totalCountedMinutes).toBe(12);
    expect(r.text).toContain("Completed work orders: 0");
    expect(r.text).toContain(`Total counted downtime: ${boldText("0h 12m")}`);
    expect(r.text).toContain("WO-1451 · Line 2 · Printer Fault · Not assigned · Open");
    expect(r.text).not.toContain(boldText("Line 2 – WO-1451"));
  });

  it("counts short stops: there is no minimum-minutes floor on real downtime", () => {
    const r = buildMaintenanceShiftReport(data({
      workOrders: [wo("w1")],
      events: [
        { id: "e1", work_order_id: "w1", stopped_at: at("08:00"), resumed_at: at("08:01"), duration_minutes: 1 },
        { id: "e2", work_order_id: "w1", stopped_at: at("09:00"), resumed_at: at("09:02"), duration_minutes: 2 },
      ],
    }));
    expect(r.downtimeEvents).toBe(2);
    expect(r.totalCountedMinutes).toBe(3);
  });

  it("counts only the minutes inside this shift for a stop carried over from the last one", () => {
    const r = buildMaintenanceShiftReport(data({
      workOrders: [wo("w3")],
      events: [{ id: "e1", work_order_id: "w3", stopped_at: at("05:00"), resumed_at: at("06:30"), duration_minutes: 90 }],
    }));
    expect(r.totalCountedMinutes).toBe(30);
  });

  it("subtracts team-activity exclusions, as the order's own downtime does", () => {
    const r = buildMaintenanceShiftReport(data({
      workOrders: [wo("w4")],
      events: [{ id: "e1", work_order_id: "w4", stopped_at: at("10:00"), resumed_at: at("10:30"), duration_minutes: 30 }],
      exclusions: [{ work_order_id: "w4", started_at: at("10:00"), ended_at: at("10:20") }],
    }));
    expect(r.totalCountedMinutes).toBe(10);
    expect(r.excludedMinutes).toBe(20);
  });

  it("leaves planned problems out of the downtime", () => {
    const r = buildMaintenanceShiftReport(data({
      workOrders: [wo("w5", { description: "Planned Shutdown" })],
      events: [{ id: "e1", work_order_id: "w5", stopped_at: at("07:00"), resumed_at: at("09:00"), duration_minutes: 120 }],
      plannedProblems: ["planned shutdown"],
    }));
    expect(r.downtimeEvents).toBe(0);
    expect(r.totalCountedMinutes).toBe(0);
    expect(r.plannedStops).toBe(1);
  });

  it("ignores a stop that starts after the shift and one that ended before it", () => {
    const r = buildMaintenanceShiftReport(data({
      workOrders: [wo("w6")],
      events: [
        { id: "e1", work_order_id: "w6", stopped_at: at("18:00"), resumed_at: at("19:00"), duration_minutes: 60 },
        { id: "e2", work_order_id: "w6", stopped_at: at("04:00"), resumed_at: at("05:00"), duration_minutes: 60 },
      ],
    }));
    expect(r.downtimeEvents).toBe(0);
    expect(r.stopsRead).toBe(0);
  });

  it("reads a duplicated event row once", () => {
    const e = { id: "e1", work_order_id: "w7", stopped_at: at("08:00"), resumed_at: at("08:20"), duration_minutes: 20 };
    const r = buildMaintenanceShiftReport(data({ workOrders: [wo("w7")], events: [e, { ...e }] }));
    expect(r.downtimeEvents).toBe(1);
    expect(r.stopsRead).toBe(1);
  });

  it("flags a stop whose order could not be read instead of dropping it", () => {
    const r = buildMaintenanceShiftReport(data({
      events: [{ id: "e1", work_order_id: "missing", stopped_at: at("08:00"), resumed_at: at("09:00"), duration_minutes: 60 }],
    }));
    expect(r.problems).toHaveLength(1);
    expect(r.downtimeEvents).toBe(0);
  });

  it("flags a stored duration that disagrees with its own timestamps", () => {
    const r = buildMaintenanceShiftReport(data({
      workOrders: [wo("w8")],
      events: [{ id: "e1", work_order_id: "w8", stopped_at: at("08:00"), resumed_at: at("09:00"), duration_minutes: 5 }],
    }));
    expect(r.problems[0]).toMatch(/WO-8/);
  });

  it("does not invent a line, a description, a repair or an engineer that was never recorded", () => {
    const r = buildMaintenanceShiftReport(data({
      completedOrders: [wo("w9", { line_at_time: null, line_name: null, description: "", resolution_notes: null, engineer_name: null, machine: null, completed_at_effective: at("10:00") })],
    }));
    expect(r.text).toContain(boldText("Line not recorded – WO-9"));
    expect(r.text).toContain("Problem: Not recorded");
    expect(r.text).toContain("Work carried out: Not recorded");
    expect(r.text).toContain("Engineer: Not assigned");
    expect(r.text).not.toContain("Machine:");
  });

  it("flags a stop that ends before it starts instead of dropping it in silence (WO 918's shape)", () => {
    const r = buildMaintenanceShiftReport(data({
      workOrders: [wo("w11", { wo_number: 918 })],
      events: [{ id: "e1", work_order_id: "w11", stopped_at: at("14:42"), resumed_at: at("05:59"), duration_minutes: -523 }],
    }));
    expect(r.downtimeEvents).toBe(0);
    expect(r.problems[0]).toMatch(/WO-918: ends .* before it starts/);
  });

  it("leaves out a 'no planned shift' stop, as the Shift Breakdown does", () => {
    const r = buildMaintenanceShiftReport(data({
      workOrders: [wo("w12")],
      events: [{ id: "e1", work_order_id: "w12", stopped_at: at("07:00"), resumed_at: at("09:00"), duration_minutes: 120, stopped_reason: "No planned shift" }],
    }));
    expect(r.downtimeEvents).toBe(0);
    expect(r.plannedStops).toBe(1);
  });

  it("leaves out warehouse service orders, which never stop a line", () => {
    const r = buildMaintenanceShiftReport(data({
      workOrders: [wo("w13", { wo_type: "warehouse_service" })],
      events: [{ id: "e1", work_order_id: "w13", stopped_at: at("07:00"), resumed_at: at("09:00"), duration_minutes: 120 }],
    }));
    expect(r.downtimeEvents).toBe(0);
    expect(r.stopsRead).toBe(0);
  });

  it("matches a planned problem the way the database view does: whole name, case-insensitive", () => {
    const r = buildMaintenanceShiftReport(data({
      workOrders: [wo("w14", { description: "PLANNED SHUTDOWN" }), wo("w15", { description: "Planned shutdown overrun" })],
      events: [
        { id: "e1", work_order_id: "w14", stopped_at: at("07:00"), resumed_at: at("09:00"), duration_minutes: 120 },
        { id: "e2", work_order_id: "w15", stopped_at: at("10:00"), resumed_at: at("11:00"), duration_minutes: 60 },
      ],
      plannedProblems: ["planned shutdown"],
    }));
    expect(r.plannedStops).toBe(1);
    expect(r.totalCountedMinutes).toBe(60);
  });

  it("says which shift and date the report is for, and when the shift is still running", () => {
    const r = buildMaintenanceShiftReport(data());
    expect(r.text.split("\n").slice(0, 3)).toEqual([
      boldText("MAINTENANCE REPORT"),
      "Day Shift (06:00–18:00) · 29/10/2026",
      "Shift in progress — figures as at 14:30.",
    ]);
    expect(r.text).toContain("Completed work orders: 0");
    expect(r.text).toContain("No work orders were completed during this shift.");
  });

  it("a finished shift carries no 'still running' line", () => {
    const r = buildMaintenanceShiftReport(data({ generatedAt: new Date("2026-10-30T09:00:00Z") }));
    expect(r.text).not.toContain("in progress");
  });

  it("writes out the first twenty open orders and counts the rest", () => {
    const many = Array.from({ length: 23 }, (_, i) => ({
      id: `p${i}`, wo_number: 100 + i, line_at_time: "Line 7", line_name: null,
      description: "Filler leak", status: "open", engineer_name: "Eng A", created_at: at("10:00"),
    }));
    const r = buildMaintenanceShiftReport(data({ pending: many }));
    expect(r.open).toHaveLength(23);
    expect(r.text).toContain("…and 3 more — see Work Orders.");
    expect(r.text).not.toContain("WO-120 ·");
  });

  it("a finished order in the open list is filtered out", () => {
    const r = buildMaintenanceShiftReport(data({
      pending: [{ id: "p", wo_number: 9, line_at_time: "Line 7", line_name: null, description: "Filler leak", status: "finished", engineer_name: null, created_at: at("10:00") }],
    }));
    expect(r.open).toHaveLength(0);
    expect(r.text).not.toContain(boldText("OPEN WORK ORDERS"));
  });

  // The fixture docs/verify/maintenance-report-vs-records.sql was run against (local
  // Postgres, 29/10/2026). The SQL said: counted WO-106 (30m, carried over) and WO-101
  // (47m); planned 104 and the "no planned shift" stop on 101; 103's 5m stop counts now
  // (no floor); 107 warehouse; 918 inverted. The report must say the same.
  it("agrees with the verification SQL on the same rows", () => {
    const W = (id: string, n: number, extra: Record<string, unknown> = {}) => wo(id, { wo_number: n, ...extra });
    const r = buildMaintenanceShiftReport(data({
      workOrders: [W("w101", 101), W("w103", 103), W("w104", 104, { description: "Planned Shutdown" }),
        W("w918", 918, { status: "force_closed" }), W("w106", 106), W("w107", 107, { wo_type: "warehouse_service" })],
      events: [
        { id: "a", work_order_id: "w101", stopped_at: at("08:00"), resumed_at: at("08:47"), duration_minutes: 47 },
        { id: "b", work_order_id: "w103", stopped_at: at("10:00"), resumed_at: at("10:05"), duration_minutes: 5 },
        { id: "c", work_order_id: "w104", stopped_at: at("07:00"), resumed_at: at("09:00"), duration_minutes: 120 },
        { id: "d", work_order_id: "w918", stopped_at: at("14:42"), resumed_at: at("05:59"), duration_minutes: -523 },
        { id: "e", work_order_id: "w106", stopped_at: at("05:00"), resumed_at: at("06:30"), duration_minutes: 90 },
        { id: "f", work_order_id: "w106", stopped_at: at("11:00"), resumed_at: at("11:30"), duration_minutes: 30 },
        { id: "g", work_order_id: "w107", stopped_at: at("12:00"), resumed_at: at("13:00"), duration_minutes: 60 },
        { id: "h", work_order_id: "w101", stopped_at: at("15:00"), resumed_at: at("16:00"), duration_minutes: 60, stopped_reason: "No planned shift" },
      ],
      exclusions: [{ work_order_id: "w106", started_at: at("11:00"), ended_at: at("11:20") }],
      plannedProblems: ["planned shutdown"],
      generatedAt: new Date(at("17:00")),
    }));
    // Counted: 101 → 47m; 103 → 5m; 106 → 30m carried over + 10m after the 20m exclusion.
    expect(r.downtimeEvents).toBe(4);
    expect(r.totalCountedMinutes).toBe(47 + 5 + 30 + 10);
    expect(r.plannedStops).toBe(2);
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toMatch(/WO-918/);
    expect(r.stopsRead).toBe(6);
    expect(r.ordersRead).toBe(4);
  });
});
