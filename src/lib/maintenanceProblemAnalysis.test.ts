import { describe, it, expect } from "vitest";
import {
  buildRows, computeKpis, groupByProblem, matchesSearch, sortGroups, formatHours,
  type AnalysisWorkOrder, type AnalysisMetrics,
} from "@/lib/maintenanceProblemAnalysis";

function wo(id: string, over: Partial<AnalysisWorkOrder> = {}): AnalysisWorkOrder {
  return {
    id, wo_number: Number(id.replace(/\D/g, "")) || 1,
    description: "Sealing jaw jammed", machine: "Line 4", status: "closed",
    created_at: "2026-10-10T08:00:00Z", started_at: "2026-10-10T08:10:00Z",
    finished_at: "2026-10-10T09:10:00Z", closed_at: "2026-10-10T09:30:00Z",
    engineer_name: "Eng A", ...over,
  };
}
const m = (id: string, repair: number | null, downtime: number | null = null): AnalysisMetrics =>
  ({ id, active_repair_sec: repair, line_downtime_sec: downtime });

describe("buildRows", () => {
  it("attaches metrics by id and counts a repeated work-order row once", () => {
    const rows = buildRows([wo("a1"), wo("a1"), wo("a2")], [m("a1", 3600), m("a2", 1800)]);
    expect(rows.map((r) => r.id)).toEqual(["a1", "a2"]);
    expect(computeKpis(rows).totalRepairSec).toBe(5400);
  });

  it("gives no hours to an order without start/finish, a negative interval, or a force close", () => {
    const rows = buildRows(
      [
        wo("b1", { started_at: null, finished_at: null, status: "open" }),
        wo("b2"),
        wo("b3", { status: "force_closed" }),
        wo("b4"),
      ],
      [m("b1", 999), m("b2", -60), m("b3", 50_000), m("b4", 7200)],
    );
    const k = computeKpis(rows);
    expect(rows.map((r) => r.repairSec)).toEqual([null, null, null, 7200]);
    expect(k.totalRepairSec).toBe(7200);
    expect(k.ordersWithHours).toBe(1);
    // Average is over orders WITH hours, not over every order.
    expect(k.avgRepairSec).toBe(7200);
    expect(k.totalOrders).toBe(4);
  });

  it("returns a null average rather than 0 when nothing was timed", () => {
    const k = computeKpis(buildRows([wo("c1", { started_at: null })], []));
    expect(k.avgRepairSec).toBeNull();
    expect(formatHours(k.avgRepairSec)).toBe("—");
  });
});

describe("computeKpis status buckets", () => {
  it("open = waiting + in progress; closed excludes force-closed and rejected", () => {
    const rows = buildRows(
      ["open", "received", "arrived", "in_progress", "finished", "closed", "completed", "force_closed", "rejected"]
        .map((s, i) => wo(`s${i}`, { status: s })),
      [],
    );
    const k = computeKpis(rows);
    expect(k).toMatchObject({ open: 3, inProgress: 1, active: 4, closed: 3, forceClosed: 1, rejected: 1, totalOrders: 9 });
  });

  it("keeps line downtime apart from repair hours", () => {
    const k = computeKpis(buildRows([wo("d1")], [m("d1", 3600, 5400)]));
    expect(k.totalRepairSec).toBe(3600);
    expect(k.totalDowntimeSec).toBe(5400);
  });
});

describe("matchesSearch", () => {
  const cats = new Map([["sealing jaw jammed", "Mechanical"]]);
  const [row] = buildRows(
    [wo("e7", { wo_number: 1027, intouch_machine_id: "M-0042", line_at_time: "Line 4", intouch_stop_reason: "Jaw fault" })],
    [], cats,
  );
  it.each([
    ["partial word", "seal"],
    ["case-insensitive", "JAMMED"],
    ["several words in any order", "jammed sealing"],
    ["category", "mechan"],
    ["machine id", "m-0042"],
    ["stop reason", "jaw fault"],
    ["order number", "1027"],
    ["formatted order number", "WO-2026-001027"],
  ])("finds by %s", (_label, q) => expect(matchesSearch(row, q)).toBe(true));

  it("needs every word", () => expect(matchesSearch(row, "seal conveyor")).toBe(false));
  it("matches everything on an empty search", () => expect(matchesSearch(row, "   ")).toBe(true));
});

describe("groupByProblem / sortGroups", () => {
  const rows = buildRows(
    [
      wo("g1", { description: "Sealing jaw jammed", created_at: "2026-10-01T08:00:00Z", machine: "Line 4" }),
      wo("g2", { description: "  sealing  JAW jammed ", created_at: "2026-10-05T08:00:00Z", machine: "Line 5A", status: "open", started_at: null, finished_at: null }),
      wo("g3", { description: "Label printer", created_at: "2026-10-03T08:00:00Z" }),
    ],
    [m("g1", 3600), m("g3", 600)],
  );

  it("groups case- and whitespace-insensitively, newest order first", () => {
    const groups = groupByProblem(rows);
    expect(groups).toHaveLength(2);
    const jaw = groups.find((g) => g.key === "sealing jaw jammed")!;
    expect(jaw.rows.map((r) => r.id)).toEqual(["g2", "g1"]);
    expect(jaw.kpis).toMatchObject({ totalOrders: 2, totalRepairSec: 3600, open: 1, closed: 1 });
    expect(jaw.lastOccurrence).toBe("2026-10-05T08:00:00Z");
    expect(jaw.latestStatus).toBe("open");
    expect(jaw.machines.sort()).toEqual(["Line 4", "Line 5A"]);
  });

  it("group totals add up to the overall totals", () => {
    const groups = groupByProblem(rows);
    const sum = groups.reduce((a, g) => a + g.kpis.totalRepairSec, 0);
    expect(sum).toBe(computeKpis(rows).totalRepairSec);
    expect(groups.reduce((a, g) => a + g.kpis.totalOrders, 0)).toBe(rows.length);
  });

  it("sorts by hours, orders, open and recency", () => {
    const g = groupByProblem(rows);
    expect(sortGroups(g, "hours")[0].key).toBe("sealing jaw jammed");
    expect(sortGroups(g, "hours", "asc")[0].key).toBe("label printer");
    expect(sortGroups(g, "orders")[0].key).toBe("sealing jaw jammed");
    expect(sortGroups(g, "open")[0].key).toBe("sealing jaw jammed");
    expect(sortGroups(g, "recent")[0].key).toBe("sealing jaw jammed");
  });
});
