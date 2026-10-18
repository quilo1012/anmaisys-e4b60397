/**
 * Maintenance Problem Analysis — the arithmetic, kept apart from the screen.
 *
 * What the hours are. `work_orders` has no labour-hours column and no timesheet
 * table sits behind it. The one recorded figure for "how long was this order worked
 * on" is `v_wo_metrics.active_repair_sec`: started_at → finished_at, minus the
 * pauses. It is the same number MTTR is built from, so this screen and the
 * maintenance KPIs agree by construction. It is ONE clock per order — an order with
 * two collaborators is not doubled, because nothing records how long each of them
 * was there. Line downtime (`line_downtime_sec`) is a different fact — how long the
 * line stood — and is reported beside it, never added to it.
 *
 * Whose hours do not count:
 *   - an order with no started_at or no finished_at — nothing was recorded, and a
 *     0 there would drag the average down for orders nobody has timed;
 *   - a negative interval — a clock edited out of order is not a duration;
 *   - `force_closed`. force_close_work_order() writes finished_at = now(), so the
 *     "repair" of a force-closed order runs until the moment a manager filed it.
 *     useMaintenanceKpis excludes them from MTTR for the same reason.
 *
 * Every figure is keyed by work-order id. The metrics view is joined through a Map,
 * one row per id, so no order is counted twice whatever else it has attached.
 */

/** Statuses that mean "not started yet" — raised, accepted, engineer on the way. */
export const WAITING_STATUSES: readonly string[] = ["open", "received", "arrived"];
export const IN_PROGRESS_STATUSES: readonly string[] = ["in_progress"];
/** Same set as woStatusCounts.DONE_STATUSES — force_closed is not "completed". */
export const CLOSED_STATUSES: readonly string[] = ["completed", "closed", "finished"];
/** Everything still needing an engineer. */
export const ACTIVE_STATUSES: readonly string[] = [...WAITING_STATUSES, ...IN_PROGRESS_STATUSES];

export type StatusBucket = "open" | "in_progress" | "closed" | "force_closed" | "rejected" | "other";

export function statusBucket(status: string | null | undefined): StatusBucket {
  const s = status ?? "";
  if (WAITING_STATUSES.includes(s)) return "open";
  if (IN_PROGRESS_STATUSES.includes(s)) return "in_progress";
  if (CLOSED_STATUSES.includes(s)) return "closed";
  if (s === "force_closed") return "force_closed";
  if (s === "rejected") return "rejected";
  return "other";
}

export const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  received: "Accepted",
  arrived: "Engineer arrived",
  in_progress: "In progress",
  finished: "Finished",
  completed: "Completed",
  closed: "Closed",
  force_closed: "Force-closed",
  rejected: "Rejected",
};

/** The work-order fields this screen reads. `select("*")` returns all of them. */
export interface AnalysisWorkOrder {
  id: string;
  wo_number: number;
  description: string | null;
  machine: string | null;
  status: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  closed_at: string | null;
  completed_at?: string | null;
  engineer_name: string | null;
  collaborator_names?: string[] | null;
  line_at_time?: string | null;
  intouch_machine_id?: string | null;
  intouch_machine_name?: string | null;
  intouch_stop_reason?: string | null;
  wo_type?: string | null;
}

export interface AnalysisMetrics {
  id: string;
  active_repair_sec: number | null;
  line_downtime_sec: number | null;
}

export interface AnalysisRow extends AnalysisWorkOrder {
  bucket: StatusBucket;
  /** Recorded repair time in seconds, or null when there is no valid figure. */
  repairSec: number | null;
  /** Line downtime in seconds, or null. 0 for planned problems (the view says so). */
  downtimeSec: number | null;
  /** problem_descriptions.category of the order's problem, when it has one. */
  category: string | null;
}

/** Normalised key for a problem: case and surrounding/inner whitespace ignored. */
export function problemKey(description: string | null | undefined): string {
  return (description ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function validSeconds(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return null;
  return v;
}

/**
 * One row per work order, with its metrics attached by id.
 *
 * Duplicate work-order rows (a page boundary repeating one, say) collapse to one,
 * and a metrics row only ever attaches to the order it names.
 */
export function buildRows(
  workOrders: readonly AnalysisWorkOrder[],
  metrics: readonly AnalysisMetrics[],
  categoryByProblem: ReadonlyMap<string, string | null> = new Map(),
): AnalysisRow[] {
  const metricsById = new Map<string, AnalysisMetrics>();
  for (const m of metrics) if (m?.id) metricsById.set(m.id, m);

  const seen = new Set<string>();
  const out: AnalysisRow[] = [];
  for (const wo of workOrders) {
    if (!wo?.id || seen.has(wo.id)) continue;
    seen.add(wo.id);
    const m = metricsById.get(wo.id);
    const bucket = statusBucket(wo.status);
    const hasClock = !!wo.started_at && !!wo.finished_at;
    const repairSec = bucket === "force_closed" || !hasClock ? null : validSeconds(m?.active_repair_sec);
    out.push({
      ...wo,
      bucket,
      repairSec,
      downtimeSec: validSeconds(m?.line_downtime_sec),
      category: categoryByProblem.get(problemKey(wo.description)) ?? null,
    });
  }
  return out;
}

/**
 * Does the order match the search text?
 *
 * Every word must appear somewhere (AND), each as a case-insensitive substring, so
 * "seal jaw" finds "Sealing jaw temperature". Searched: problem description, category, machine,
 * iTouching machine name and id, iTouching stop reason, line, and the order number
 * (either the bare number or the WO-YYYY-NNNNNN form).
 */
export function matchesSearch(row: AnalysisRow, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const year = new Date(row.created_at).getFullYear();
  const haystack = [
    row.description,
    row.category,
    row.machine,
    row.intouch_machine_name,
    row.intouch_machine_id,
    row.intouch_stop_reason,
    row.line_at_time,
    String(row.wo_number ?? ""),
    `wo-${year}-${String(row.wo_number ?? "").padStart(6, "0")}`,
  ]
    .filter((s): s is string => typeof s === "string" && s.length > 0)
    .join("\n")
    .toLowerCase();
  return words.every((w) => haystack.includes(w));
}

export interface AnalysisKpis {
  totalOrders: number;
  /** Sum of valid recorded repair seconds. */
  totalRepairSec: number;
  /** How many orders contributed to totalRepairSec. */
  ordersWithHours: number;
  /** totalRepairSec / ordersWithHours, or null when no order has hours. */
  avgRepairSec: number | null;
  open: number;
  inProgress: number;
  /** open + inProgress. */
  active: number;
  closed: number;
  forceClosed: number;
  rejected: number;
  totalDowntimeSec: number;
  ordersWithDowntime: number;
}

export function computeKpis(rows: readonly AnalysisRow[]): AnalysisKpis {
  const k: AnalysisKpis = {
    totalOrders: 0, totalRepairSec: 0, ordersWithHours: 0, avgRepairSec: null,
    open: 0, inProgress: 0, active: 0, closed: 0, forceClosed: 0, rejected: 0,
    totalDowntimeSec: 0, ordersWithDowntime: 0,
  };
  const ids = new Set<string>();
  for (const r of rows) {
    if (ids.has(r.id)) continue;
    ids.add(r.id);
    k.totalOrders += 1;
    if (r.repairSec != null) { k.totalRepairSec += r.repairSec; k.ordersWithHours += 1; }
    if (r.downtimeSec != null && r.downtimeSec > 0) { k.totalDowntimeSec += r.downtimeSec; k.ordersWithDowntime += 1; }
    switch (r.bucket) {
      case "open": k.open += 1; break;
      case "in_progress": k.inProgress += 1; break;
      case "closed": k.closed += 1; break;
      case "force_closed": k.forceClosed += 1; break;
      case "rejected": k.rejected += 1; break;
    }
  }
  k.active = k.open + k.inProgress;
  k.avgRepairSec = k.ordersWithHours ? k.totalRepairSec / k.ordersWithHours : null;
  return k;
}

export interface ProblemGroup {
  key: string;
  /** The spelling of the most recent order in the group. */
  problem: string;
  category: string | null;
  /** Machines, most frequent first. */
  machines: string[];
  kpis: AnalysisKpis;
  lastOccurrence: string;
  /** Status of the most recent order. */
  latestStatus: string;
  rows: AnalysisRow[];
}

/** Group by problem description (case/whitespace-insensitive). Rows newest first. */
export function groupByProblem(rows: readonly AnalysisRow[]): ProblemGroup[] {
  const byKey = new Map<string, AnalysisRow[]>();
  for (const r of rows) {
    const key = problemKey(r.description) || "(no description)";
    const list = byKey.get(key);
    if (list) list.push(r); else byKey.set(key, [r]);
  }
  const groups: ProblemGroup[] = [];
  for (const [key, list] of byKey) {
    const sorted = [...list].sort((a, b) => b.created_at.localeCompare(a.created_at));
    const latest = sorted[0];
    const machineCount = new Map<string, number>();
    for (const r of sorted) {
      const m = (r.machine ?? "").trim();
      if (m) machineCount.set(m, (machineCount.get(m) ?? 0) + 1);
    }
    const machines = [...machineCount.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([m]) => m);
    groups.push({
      key,
      problem: (latest.description ?? "").trim() || "(no description)",
      category: sorted.find((r) => r.category)?.category ?? null,
      machines,
      kpis: computeKpis(sorted),
      lastOccurrence: latest.created_at,
      latestStatus: latest.status,
      rows: sorted,
    });
  }
  return groups;
}

export type GroupSortKey = "hours" | "orders" | "open" | "recent";

export function sortGroups(groups: readonly ProblemGroup[], key: GroupSortKey, dir: "asc" | "desc" = "desc"): ProblemGroup[] {
  const value = (g: ProblemGroup): number => {
    switch (key) {
      case "hours": return g.kpis.totalRepairSec;
      case "orders": return g.kpis.totalOrders;
      case "open": return g.kpis.active;
      case "recent": return new Date(g.lastOccurrence).getTime();
    }
  };
  const sign = dir === "desc" ? -1 : 1;
  return [...groups].sort((a, b) => sign * (value(a) - value(b)) || a.problem.localeCompare(b.problem));
}

/** Seconds → hours, one decimal, for display. */
export function formatHours(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return "—";
  return `${(sec / 3600).toFixed(1)} h`;
}
