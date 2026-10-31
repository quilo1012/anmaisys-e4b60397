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

import { fetchMaintenanceShiftReport, shiftWindowFor } from "@/lib/maintenanceShiftReport";

const NOW = new Date("2026-10-29T14:30:00Z");

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  calls.length = 0;
});

describe("fetchMaintenanceShiftReport", () => {
  it("throws when the stoppages cannot be read — no 'No issues' file from a failed read", async () => {
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

  it("prints exactly the stops and orders the source holds", async () => {
    tables.downtime_events = { data: [
      { id: "e1", work_order_id: "w1", stopped_at: "2026-10-29T08:00:00Z", resumed_at: "2026-10-29T08:47:00Z", duration_minutes: 47 },
      { id: "e2", work_order_id: "w2", stopped_at: "2026-10-29T13:00:00Z", resumed_at: null, duration_minutes: null },
      { id: "e3", work_order_id: "w3", stopped_at: "2026-10-29T10:00:00Z", resumed_at: "2026-10-29T10:05:00Z", duration_minutes: 5 },
    ] };
    tables.work_orders = { data: [
      { id: "w1", wo_number: 101, line_at_time: "Line 2", description: "Labeller fault", resolution_notes: "Reset sensor", status: "closed", line: { name: "Line 2" } },
      { id: "w2", wo_number: 102, line_at_time: null, description: "Filler leak", resolution_notes: null, status: "in_progress", line: { name: "Line 7" } },
      { id: "w3", wo_number: 103, line_at_time: "Line 3", description: "Jam", resolution_notes: "Cleared", status: "finished", line: null },
    ] };
    const r = await fetchMaintenanceShiftReport(NOW);
    expect(r.problems).toEqual([]);
    expect(r.stopsRead).toBe(3);
    expect(r.ordersRead).toBe(3);
    const t = r.text;
    const body = t.slice(t.indexOf("**Stops over 15 minutes**")).split("\n").slice(0, 5);
    expect(body).toEqual([
      "**Stops over 15 minutes**",
      "**Line 2:** Reset sensor (WO-101)",
      "Downtime: 47m",
      "**Line 7:** Filler leak (in progress) (WO-102)",
      "Downtime: 90m so far (still stopped)",
    ]);
    expect(t).not.toContain("WO-103");
    expect(t).toContain("- Stops recorded: 3 stops on 3 work orders");
    expect(t).toContain("- Stops over 15 min: 2 (137 min)");
  });

  it("reads the chosen night, 18:00 to 06:00 the next day, not the shift running now", async () => {
    await fetchMaintenanceShiftReport(NOW, { window: shiftWindowFor("2026-10-27", "night") });
    const ev = calls.find((c) => c.table === "downtime_events")!;
    expect(ev.ops).toContain('lt("stopped_at","2026-10-28T06:00:00.000Z")');
    expect(ev.ops).toContain('or("resumed_at.is.null,resumed_at.gt.2026-10-27T18:00:00.000Z,stopped_at.gte.2026-10-27T18:00:00.000Z")');
  });

  it("does not read today's pending orders for a shift too old for a hand-over", async () => {
    await fetchMaintenanceShiftReport(NOW, { window: shiftWindowFor("2026-10-27", "night") });
    expect(calls.filter((c) => c.table === "work_orders" && c.ops.some((o) => o.startsWith("neq(")))).toHaveLength(0);
  });

  it("reads them for the running shift, and refuses the whole report if that read fails", async () => {
    let n = 0;
    tables.work_orders = { data: [] };
    await fetchMaintenanceShiftReport(NOW);
    n = calls.filter((c) => c.table === "work_orders" && c.ops.some((o) => o.startsWith("neq("))).length;
    expect(n).toBe(1);
    tables.work_orders = { error: { message: "timeout" } };
    await expect(fetchMaintenanceShiftReport(NOW)).rejects.toThrow(/Could not read/);
  });
});
