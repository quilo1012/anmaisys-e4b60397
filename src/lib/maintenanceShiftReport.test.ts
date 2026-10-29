import { describe, it, expect } from "vitest";
import {
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

describe("buildMaintenanceShiftReport", () => {
  it("lists every stop over 15 minutes with the minutes the database recorded", () => {
    const r = buildMaintenanceShiftReport(data({
      workOrders: [wo("w1")],
      events: [
        { id: "e1", work_order_id: "w1", stopped_at: at("08:00"), resumed_at: at("08:40"), duration_minutes: 40 },
        { id: "e2", work_order_id: "w1", stopped_at: at("09:00"), resumed_at: at("09:10"), duration_minutes: 10 },
      ],
    }));
    expect(r.items).toHaveLength(1);
    expect(r.items[0].stops.map((s) => s.minutes)).toEqual([40]);
    expect(r.text).toContain("**Line 4:** Replaced the capper belt");
    expect(r.text).toContain("Downtime: 40m");
    expect(r.text).not.toContain("10m");
    expect(r.text).not.toMatch(/no issues/i);
  });

  it("includes an order that is still open: the line being down now is the biggest issue", () => {
    const r = buildMaintenanceShiftReport(data({
      workOrders: [wo("w2", { status: "in_progress", resolution_notes: null })],
      events: [{ id: "e1", work_order_id: "w2", stopped_at: at("13:00"), resumed_at: null, duration_minutes: null }],
    }));
    expect(r.items).toHaveLength(1);
    expect(r.text).toContain("Capper jam (in progress)");
    expect(r.text).toContain("Downtime: 90m so far (still stopped)");
  });

  it("counts only the minutes inside this shift for a stop carried over from the last one", () => {
    const r = buildMaintenanceShiftReport(data({
      workOrders: [wo("w3")],
      events: [{ id: "e1", work_order_id: "w3", stopped_at: at("05:00"), resumed_at: at("06:30"), duration_minutes: 90 }],
    }));
    expect(r.items[0].stops[0].minutes).toBe(30);
    expect(r.text).toContain("Downtime: 30m (from previous shift)");
  });

  it("subtracts team-activity exclusions, as the order's own downtime does", () => {
    const r = buildMaintenanceShiftReport(data({
      workOrders: [wo("w4")],
      events: [{ id: "e1", work_order_id: "w4", stopped_at: at("10:00"), resumed_at: at("10:30"), duration_minutes: 30 }],
      exclusions: [{ work_order_id: "w4", started_at: at("10:00"), ended_at: at("10:20") }],
    }));
    // 30 - 20 = 10, under the threshold.
    expect(r.items).toHaveLength(0);
    expect(r.text).toContain("No line stoppage over 15 minutes recorded this shift.");
  });

  it("leaves planned problems out of the downtime, and says how many it left out", () => {
    const r = buildMaintenanceShiftReport(data({
      workOrders: [wo("w5", { description: "Planned Shutdown" })],
      events: [{ id: "e1", work_order_id: "w5", stopped_at: at("07:00"), resumed_at: at("09:00"), duration_minutes: 120 }],
      plannedProblems: ["planned shutdown"],
    }));
    expect(r.items).toHaveLength(0);
    expect(r.plannedStops).toBe(1);
    expect(r.text).toContain("1 planned stop not counted");
  });

  it("ignores a stop that starts after the shift and one that ended before it", () => {
    const r = buildMaintenanceShiftReport(data({
      workOrders: [wo("w6")],
      events: [
        { id: "e1", work_order_id: "w6", stopped_at: at("18:00"), resumed_at: at("19:00"), duration_minutes: 60 },
        { id: "e2", work_order_id: "w6", stopped_at: at("04:00"), resumed_at: at("05:00"), duration_minutes: 60 },
      ],
    }));
    expect(r.items).toHaveLength(0);
    expect(r.stopsRead).toBe(0);
  });

  it("reads a duplicated event row once", () => {
    const e = { id: "e1", work_order_id: "w7", stopped_at: at("08:00"), resumed_at: at("08:20"), duration_minutes: 20 };
    const r = buildMaintenanceShiftReport(data({ workOrders: [wo("w7")], events: [e, { ...e }] }));
    expect(r.items[0].stops).toHaveLength(1);
    expect(r.stopsRead).toBe(1);
  });

  it("flags a stop whose order could not be read instead of dropping it", () => {
    const r = buildMaintenanceShiftReport(data({
      events: [{ id: "e1", work_order_id: "missing", stopped_at: at("08:00"), resumed_at: at("09:00"), duration_minutes: 60 }],
    }));
    expect(r.problems).toHaveLength(1);
    expect(r.text).toContain("NOT VALIDATED");
    expect(r.text).not.toContain("No line stoppage");
  });

  it("flags a stored duration that disagrees with its own timestamps", () => {
    const r = buildMaintenanceShiftReport(data({
      workOrders: [wo("w8")],
      events: [{ id: "e1", work_order_id: "w8", stopped_at: at("08:00"), resumed_at: at("09:00"), duration_minutes: 5 }],
    }));
    expect(r.problems[0]).toMatch(/WO-8/);
    expect(r.text).toContain("NOT VALIDATED");
  });

  it("does not invent a line or a description that was never recorded", () => {
    const r = buildMaintenanceShiftReport(data({
      workOrders: [wo("w9", { line_at_time: null, line_name: null, description: "", resolution_notes: null })],
      events: [{ id: "e1", work_order_id: "w9", stopped_at: at("08:00"), resumed_at: at("09:00"), duration_minutes: 60 }],
    }));
    expect(r.text).toContain("**Line not recorded:** No description recorded (WO-9)");
  });

  it("says which shift, date and source the numbers came from", () => {
    const r = buildMaintenanceShiftReport(data());
    expect(r.text).toContain("**Day Shift (06-18)** · 29/10/2026");
    expect(r.text).toMatch(/Source: downtime_events, 06:00–18:00 29\/10\/2026 \(Europe\/London\), read 14:30\. 0 stops on 0 orders/);
  });

  it("total minutes on each item equal the sum of the stops listed", () => {
    const r = buildMaintenanceShiftReport(data({
      workOrders: [wo("w10")],
      events: [
        { id: "a", work_order_id: "w10", stopped_at: at("08:00"), resumed_at: at("08:20"), duration_minutes: 20 },
        { id: "b", work_order_id: "w10", stopped_at: at("11:00"), resumed_at: at("11:45"), duration_minutes: 45 },
      ],
    }));
    const item = r.items[0];
    expect(item.totalMinutes).toBe(item.stops.reduce((s, x) => s + x.minutes, 0));
    expect(r.text).toContain("Downtime: 20m; 45m");
  });

  // Follow-up review against the rest of the app (useShiftDowntime, v_wo_downtime_total).

  it("flags a stop that ends before it starts instead of dropping it in silence (WO 918's shape)", () => {
    const r = buildMaintenanceShiftReport(data({
      workOrders: [wo("w11", { wo_number: 918 })],
      events: [{ id: "e1", work_order_id: "w11", stopped_at: at("14:42"), resumed_at: at("05:59"), duration_minutes: -523 }],
    }));
    expect(r.items).toHaveLength(0);
    expect(r.problems[0]).toMatch(/WO-918: ends .* before it starts/);
    expect(r.text).toContain("NOT VALIDATED");
  });

  it("leaves out a 'no planned shift' stop, as the Shift Breakdown does", () => {
    const r = buildMaintenanceShiftReport(data({
      workOrders: [wo("w12")],
      events: [{ id: "e1", work_order_id: "w12", stopped_at: at("07:00"), resumed_at: at("09:00"), duration_minutes: 120, stopped_reason: "No planned shift" }],
    }));
    expect(r.items).toHaveLength(0);
    expect(r.plannedStops).toBe(1);
  });

  it("leaves out warehouse service orders, which never stop a line", () => {
    const r = buildMaintenanceShiftReport(data({
      workOrders: [wo("w13", { wo_type: "warehouse_service" })],
      events: [{ id: "e1", work_order_id: "w13", stopped_at: at("07:00"), resumed_at: at("09:00"), duration_minutes: 120 }],
    }));
    expect(r.items).toHaveLength(0);
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
    expect(r.items.map((i) => i.wo.id)).toEqual(["w15"]);
  });

  it("counts only orders whose stops touched the shift", () => {
    const r = buildMaintenanceShiftReport(data({
      workOrders: [wo("w16"), wo("w17")],
      events: [
        { id: "e1", work_order_id: "w16", stopped_at: at("07:00"), resumed_at: at("07:30"), duration_minutes: 30 },
        { id: "e2", work_order_id: "w17", stopped_at: at("19:00"), resumed_at: at("19:30"), duration_minutes: 30 },
      ],
    }));
    expect(r.ordersRead).toBe(1);
  });
});
