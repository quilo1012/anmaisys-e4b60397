import { describe, it, expect } from "vitest";
import {
  buildMaintenanceShiftReport,
  quickShift,
  reportFileName,
  shiftWindowFor,
  validateShiftSelection,
  HANDOVER_MAX_PENDING,
  type PendingOrder,
  type ShiftReportData,
} from "@/lib/maintenanceShiftReport";

const iso = (d: Date) => d.toISOString();

describe("shiftWindowFor — any shift, by the date it started", () => {
  it("Day: 06:00–18:00 London on that date", () => {
    const w = shiftWindowFor("2026-10-29", "day");
    expect([iso(w.start), iso(w.end)]).toEqual(["2026-10-29T06:00:00.000Z", "2026-10-29T18:00:00.000Z"]);
  });

  it("Night 30/10: 18:00 on the 30th to 06:00 on the 31st, and keeps the 30th", () => {
    const w = shiftWindowFor("2026-10-30", "night");
    expect([iso(w.start), iso(w.end), w.sessionDate]).toEqual(["2026-10-30T18:00:00.000Z", "2026-10-31T06:00:00.000Z", "2026-10-30"]);
  });

  it("summer time: Day on 15/07 is 05:00–17:00 UTC", () => {
    const w = shiftWindowFor("2026-07-15", "day");
    expect([iso(w.start), iso(w.end)]).toEqual(["2026-07-15T05:00:00.000Z", "2026-07-15T17:00:00.000Z"]);
  });

  it("the night the clocks go back (24→25/10/2026) is 13 hours long", () => {
    const w = shiftWindowFor("2026-10-24", "night");
    expect(iso(w.start)).toBe("2026-10-24T17:00:00.000Z"); // 18:00 BST
    expect(iso(w.end)).toBe("2026-10-25T06:00:00.000Z");   // 06:00 GMT
    expect((w.end.getTime() - w.start.getTime()) / 3_600_000).toBe(13);
  });

  it("the night the clocks go forward (27→28/03/2027) is 11 hours long", () => {
    const w = shiftWindowFor("2027-03-27", "night");
    expect(iso(w.start)).toBe("2027-03-27T18:00:00.000Z"); // 18:00 GMT
    expect(iso(w.end)).toBe("2027-03-28T05:00:00.000Z");   // 06:00 BST
    expect((w.end.getTime() - w.start.getTime()) / 3_600_000).toBe(11);
  });

  it("refuses a date that does not exist", () => {
    expect(() => shiftWindowFor("2026-02-31", "day")).toThrow();
    expect(() => shiftWindowFor("30/10/2026", "day")).toThrow();
  });
});

describe("quickShift", () => {
  const at = (s: string) => new Date(s);
  it("at 14:30 on 30/10: current is that Day, previous the night of the 29th", () => {
    const now = at("2026-10-30T14:30:00Z");
    expect(quickShift("current", now)).toEqual({ sessionDate: "2026-10-30", shift: "day" });
    expect(quickShift("previous", now)).toEqual({ sessionDate: "2026-10-29", shift: "night" });
    expect(quickShift("yesterday-day", now)).toEqual({ sessionDate: "2026-10-29", shift: "day" });
    expect(quickShift("yesterday-night", now)).toEqual({ sessionDate: "2026-10-29", shift: "night" });
  });

  it("at 02:00 on 31/10 the running shift is the night of the 30th", () => {
    const now = at("2026-10-31T02:00:00Z");
    expect(quickShift("current", now)).toEqual({ sessionDate: "2026-10-30", shift: "night" });
    expect(quickShift("previous", now)).toEqual({ sessionDate: "2026-10-30", shift: "day" });
    expect(quickShift("yesterday-night", now)).toEqual({ sessionDate: "2026-10-29", shift: "night" });
  });
});

describe("validateShiftSelection", () => {
  const now = new Date("2026-10-30T14:30:00Z");
  it("accepts the running shift and any earlier one", () => {
    expect(validateShiftSelection("2026-10-30", "day", now).ok).toBe(true);
    expect(validateShiftSelection("2026-10-28", "night", now).ok).toBe(true);
  });
  it("refuses a shift that has not started", () => {
    const r = validateShiftSelection("2026-10-30", "night", now);
    expect(r).toEqual({ ok: false, error: "That shift has not started yet." });
  });
  it("refuses an impossible date", () => {
    expect(validateShiftSelection("2026-02-30", "day", now).ok).toBe(false);
  });
});

describe("reportFileName", () => {
  it("is Maintenance_Report_<Shift>_Shift_<date>", () => {
    expect(reportFileName({ sessionDate: "2026-10-30", shift: "night" }, "pdf")).toBe("Maintenance_Report_Night_Shift_2026-10-30.pdf");
    expect(reportFileName({ sessionDate: "2026-10-29", shift: "day" }, "xlsx")).toBe("Maintenance_Report_Day_Shift_2026-10-29.xlsx");
  });
});

// ── A historical night and a recent one ─────────────────────────────────

const NIGHT_28 = shiftWindowFor("2026-10-28", "night"); // 28/10 18:00 → 29/10 06:00 GMT
const t = (s: string) => `2026-10-${s}:00.000Z`;
const wo = (id: string, n: number, extra: Record<string, unknown> = {}) => ({
  id, wo_number: n, line_at_time: "Line 4", line_name: null, description: "Capper jam",
  resolution_notes: "Replaced belt", status: "closed", ...extra,
});
const pending = (n: number, extra: Partial<PendingOrder> = {}): PendingOrder => ({
  id: `p${n}`, wo_number: n, line_at_time: "Line 7", line_name: null, description: "Filler leak",
  status: "in_progress", engineer_name: "Eng A", paused_at: null, pause_reason: null,
  created_at: t("29T05:00"), stopped_since: null, ...extra,
});
const base = (over: Partial<ShiftReportData> = {}): ShiftReportData => ({
  window: NIGHT_28,
  generatedAt: new Date(t("29T06:10")),
  workOrders: [],
  events: [],
  exclusions: [],
  plannedProblems: [],
  ...over,
});

describe("a report for a night that has ended", () => {
  it("counts only that night: a stop across 18:00 counts from 18:00, one after 06:00 not at all", () => {
    const r = buildMaintenanceShiftReport(base({
      workOrders: [wo("a", 1), wo("b", 2)],
      events: [
        { id: "e1", work_order_id: "a", stopped_at: t("28T17:30"), resumed_at: t("28T18:40"), duration_minutes: 70 },
        { id: "e2", work_order_id: "b", stopped_at: t("29T06:05"), resumed_at: t("29T06:09"), duration_minutes: 4 },
      ],
    }));
    expect(r.items.map((i) => [i.wo.wo_number, i.stops[0].minutes, i.stops[0].carriedOver])).toEqual([[1, 40, true]]);
    expect(r.stopsRead).toBe(1);
    expect(r.text).toContain("Period: 28/10/2026 18:00 → 29/10/2026 06:00 (Europe/London)");
    expect(r.text).not.toContain("still running");
  });

  it("a stop still open now counts to the end of that night, not to now", () => {
    const r = buildMaintenanceShiftReport(base({
      generatedAt: new Date(t("30T12:00")),
      workOrders: [wo("a", 1, { status: "in_progress" })],
      events: [{ id: "e1", work_order_id: "a", stopped_at: t("29T05:00"), resumed_at: null, duration_minutes: null }],
    }));
    expect(r.items[0].stops[0].minutes).toBe(60);
    expect(r.openItems).toBe(1);
  });

  it("carries no hand-over once it is more than 12 hours old, and says why", () => {
    const r = buildMaintenanceShiftReport(base({ generatedAt: new Date(t("30T12:00")), pending: [pending(9)] }));
    expect(r.handover).toBeNull();
    expect(r.text).toContain("**Handover:** not included");
    expect(r.text).not.toContain("WO-9");
  });

  it("says 'no stoppage' for an empty night only because the reads succeeded and found none", () => {
    const r = buildMaintenanceShiftReport(base());
    expect(r.text).toContain("- No line stoppage over 15 minutes recorded this shift.");
    expect(r.problems).toEqual([]);
  });
});

describe("summary and audit trail", () => {
  const r = buildMaintenanceShiftReport(base({
    workOrders: [wo("a", 1), wo("b", 2, { status: "in_progress" }), wo("c", 3, { description: "Planned stop" }), wo("d", 4)],
    events: [
      { id: "e1", work_order_id: "a", stopped_at: t("28T20:00"), resumed_at: t("28T20:50"), duration_minutes: 50 },
      { id: "e2", work_order_id: "b", stopped_at: t("29T01:00"), resumed_at: t("29T02:00"), duration_minutes: 60 },
      { id: "e3", work_order_id: "c", stopped_at: t("28T22:00"), resumed_at: t("28T23:00"), duration_minutes: 60 },
      { id: "e4", work_order_id: "d", stopped_at: t("29T03:00"), resumed_at: t("29T03:30"), duration_minutes: 30 },
      { id: "e5", work_order_id: "missing", stopped_at: t("29T04:00"), resumed_at: t("29T04:30"), duration_minutes: 30 },
    ],
    exclusions: [{ work_order_id: "d", started_at: t("29T03:00"), ended_at: t("29T03:20") }],
    plannedProblems: ["planned stop"],
  }));

  it("gives every stop that touched the shift a verdict", () => {
    expect(r.rows.map((x) => [x.woNumber, x.verdict, x.minutes, x.excludedMinutes])).toEqual([
      [1, "listed", 50, 0],
      [3, "planned", null, 0],
      [2, "listed", 60, 0],
      [4, "under 15 min", 10, 20],
      [null, "order not read", null, 0],
    ]);
  });

  it("totals agree with the rows", () => {
    expect(r.stopsRead).toBe(5);
    expect(r.ordersRead).toBe(4);
    expect(r.plannedStops).toBe(1);
    expect(r.excludedMinutes).toBe(20);
    expect(r.openItems).toBe(1);
    expect(r.resolvedItems).toBe(1);
    expect(r.text).toContain("- Stops over 15 min: 2 (110 min)");
    expect(r.text).toContain("- Team-activity time excluded: 20 min");
    expect(r.text).toContain("- Still open: 1 · Resolved: 1");
    expect(r.text).toContain("- Records not validated: 1");
    expect(r.text).toContain("NOT VALIDATED");
  });
});

describe("hand-over for a recent shift", () => {
  it("lists the lines still stopped, the pending orders as recorded, and the notes typed", () => {
    const r = buildMaintenanceShiftReport(base({
      generatedBy: "Eng B",
      pending: [
        pending(10, { stopped_since: t("29T05:30") }),
        pending(11, { paused_at: t("29T04:00"), pause_reason: "Waiting for parts", line_at_time: "Line 2", engineer_name: null }),
        pending(12, { status: "finished" }), // not pending: filtered out
      ],
      handoverNotes: "  Check Line 7 seal at 08:00  ",
    }));
    expect(r.handover?.stillStopped.map((p) => p.wo_number)).toEqual([10]);
    expect(r.handover?.pending.map((p) => p.wo_number)).toEqual([10, 11]);
    expect(r.text).toContain("**Handover** (order status at 29/10/2026 06:10)");
    expect(r.text).toContain("- Line 7 · WO-10 Filler leak · stopped since 05:30 (40m) · engineer: Eng A");
    expect(r.text).toContain("- WO-11 · Line 2 · Filler leak · in_progress · paused: Waiting for parts · engineer: not assigned");
    expect(r.text).toContain("Handover notes (Eng B): Check Line 7 seal at 08:00");
    expect(r.text).toContain("Generated: 29/10/2026 06:10 by Eng B");
  });

  it("writes out the first twenty pending orders and counts the rest", () => {
    const many = Array.from({ length: HANDOVER_MAX_PENDING + 3 }, (_, i) => pending(100 + i));
    const r = buildMaintenanceShiftReport(base({ pending: many }));
    expect(r.text).toContain(`Pending work orders: ${HANDOVER_MAX_PENDING + 3}`);
    expect(r.text).toContain("- …and 3 more (see Work Orders).");
    expect(r.text).not.toContain(`WO-${100 + HANDOVER_MAX_PENDING} `);
  });
});
