import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The read itself. A fake PostgREST that answers by table, so the test can say what
 * "the database" holds and check the downloaded text against exactly that.
 */
const tables: Record<string, { data?: unknown[]; error?: { message: string } }> = {};
const calls: Array<{ table: string; ops: string[] }> = [];

function builder(table: string) {
  const call = { table, ops: [] as string[] };
  calls.push(call);
  const b: any = {};
  for (const op of ["select", "lt", "or", "order", "in", "eq", "neq", "is"]) {
    b[op] = (...args: unknown[]) => { call.ops.push(`${op}(${args.map((a) => JSON.stringify(a)).join(",")})`); return b; };
  }
  b.range = (from: number, to: number) => {
    const t = tables[table] ?? { data: [] };
    if (t.error) return Promise.resolve({ data: null, error: t.error });
    return Promise.resolve({ data: (t.data ?? []).slice(from, to + 1), error: null });
  };
  return b;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (t: string) => builder(t) },
}));

import { boldText, fetchMaintenanceShiftReport, shiftWindowFor } from "@/lib/maintenanceShiftReport";

const NOW = new Date("2026-10-29T14:30:00Z");

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  calls.length = 0;
});

describe("fetchMaintenanceShiftReport", () => {
  it("throws when the stoppages cannot be read — no empty report from a failed read", async () => {
    tables.downtime_events = { error: { message: "network down" } };
    await expect(fetchMaintenanceShiftReport(NOW)).rejects.toThrow(/Could not read the line stoppages: network down/);
  });

  it("throws when the orders behind the stops cannot be read", async () => {
    tables.downtime_events = { data: [{ id: "e1", work_order_id: "w1", stopped_at: "2026-10-29T08:00:00Z", resumed_at: "2026-10-29T09:00:00Z", duration_minutes: 60 }] };
    tables.work_orders = { error: { message: "permission denied" } };
    await expect(fetchMaintenanceShiftReport(NOW)).rejects.toThrow(/work orders: permission denied/);
  });

  it("asks the database for the shift running at the click, in London time", async () => {
    await fetchMaintenanceShiftReport(NOW);
    const ev = calls.find((c) => c.table === "downtime_events")!;
    expect(ev.ops).toContain('lt("stopped_at","2026-10-29T18:00:00.000Z")');
    expect(ev.ops).toContain('or("resumed_at.is.null,resumed_at.gt.2026-10-29T06:00:00.000Z,stopped_at.gte.2026-10-29T06:00:00.000Z")');
  });

  it("reads the completed orders by their completion time inside the shift, finished status only", async () => {
    await fetchMaintenanceShiftReport(NOW);
    const done = calls.find((c) => c.table === "work_orders" && c.ops.some((o) => o.startsWith("or(")))!;
    expect(done.ops.join(" ")).toContain("finished_at.gte.2026-10-29T06:00:00.000Z");
    expect(done.ops.join(" ")).toContain("finished_at.lt.2026-10-29T18:00:00.000Z");
    expect(done.ops.join(" ")).toContain("status.in.(finished,closed,completed,force_closed)");
    expect(done.ops).toContain('neq("wo_type","warehouse_service")');
  });

  it("prints exactly the completed orders, the open orders and the counted downtime the source holds", async () => {
    tables.downtime_events = { data: [
      { id: "e1", work_order_id: "w1", stopped_at: "2026-10-29T08:00:00Z", resumed_at: "2026-10-29T08:47:00Z", duration_minutes: 47 },
      { id: "e2", work_order_id: "w2", stopped_at: "2026-10-29T13:00:00Z", resumed_at: null, duration_minutes: null },
      { id: "e3", work_order_id: "w3", stopped_at: "2026-10-29T10:00:00Z", resumed_at: "2026-10-29T10:05:00Z", duration_minutes: 5 },
    ] };
    // The fake answers every work_orders read with the same rows; the builder filters
    // by status and completion time itself, exactly as PostgREST would.
    tables.work_orders = { data: [
      { id: "w1", wo_number: 101, line_at_time: "Line 2", description: "Labeller fault", resolution_notes: "Reset sensor", status: "closed", engineer_name: "Eng A", machine: "Labeller", finished_at: "2026-10-29T09:00:00Z", completed_at: null, closed_at: null, line: { name: "Line 2" } },
      { id: "w2", wo_number: 102, line_at_time: null, description: "Filler leak", resolution_notes: null, status: "in_progress", engineer_name: null, machine: null, finished_at: null, completed_at: null, closed_at: null, line: { name: "Line 7" } },
      { id: "w3", wo_number: 103, line_at_time: "Line 3", description: "Jam", resolution_notes: "Cleared", status: "finished", engineer_name: "Eng B", machine: null, finished_at: "2026-10-29T11:00:00Z", completed_at: null, closed_at: null, line: null },
    ] };
    const r = await fetchMaintenanceShiftReport(NOW);
    expect(r.problems).toEqual([]);
    expect(r.stopsRead).toBe(3);
    expect(r.downtimeEvents).toBe(3);
    expect(r.totalCountedMinutes).toBe(47 + 90 + 5);
    expect(r.completed.map((c) => c.wo.wo_number)).toEqual([103, 101]);
    expect(r.open.map((p) => p.wo_number)).toEqual([102]);
    const t = r.text;
    expect(t).toContain("Completed work orders: 2");
    expect(t).toContain("Downtime events: 3");
    expect(t).toContain(`Total counted downtime: ${boldText("2h 22m")}`);
    expect(t).toContain(boldText("Line 3 – WO-103"));
    expect(t).toContain(boldText("Line 2 – WO-101"));
    expect(t).toContain("Machine: Labeller");
    expect(t).toContain("Problem: Labeller fault");
    expect(t).toContain("Work carried out: Reset sensor");
    expect(t).toContain("Engineer: Eng A");
    expect(t).toContain(`Downtime: ${boldText("0h 47m")}`);
    expect(t).toContain("WO-102 · Line 7 · Filler leak · Not assigned · Open");
    expect(t).not.toContain(boldText("Line 7 – WO-102"));
  });

  it("reads the chosen night, 18:00 to 06:00 the next day, not the shift running now", async () => {
    await fetchMaintenanceShiftReport(NOW, { window: shiftWindowFor("2026-10-27", "night") });
    const ev = calls.find((c) => c.table === "downtime_events")!;
    expect(ev.ops).toContain('lt("stopped_at","2026-10-28T06:00:00.000Z")');
    expect(ev.ops).toContain('or("resumed_at.is.null,resumed_at.gt.2026-10-27T18:00:00.000Z,stopped_at.gte.2026-10-27T18:00:00.000Z")');
  });

  it("reads the open orders for any shift, and refuses the whole report if that read fails", async () => {
    tables.work_orders = { data: [] };
    await fetchMaintenanceShiftReport(NOW, { window: shiftWindowFor("2026-10-27", "night") });
    const openReads = calls.filter((c) => c.table === "work_orders" && c.ops.some((o) => o.startsWith("in(")));
    expect(openReads).toHaveLength(1);
    tables.work_orders = { error: { message: "timeout" } };
    await expect(fetchMaintenanceShiftReport(NOW)).rejects.toThrow(/Could not read/);
  });
});
