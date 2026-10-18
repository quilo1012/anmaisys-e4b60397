/**
 * The Maintenance dashboard's groupings over work orders.
 *
 * Status buckets, hours and problem ranking already live in
 * `maintenanceProblemAnalysis` and are reused as they are; this file only adds the
 * cuts nothing else made: by priority, by engineer, by line, corrective against
 * preventive, and the two "needs looking at" counts the orders list already defines.
 */

export interface DashboardWo {
  status: string;
  priority?: string | null;
  engineer_name?: string | null;
  line_at_time?: string | null;
  wo_type?: string | null;
  started_at?: string | null;
}

export interface Slice { label: string; count: number }

/** Highest first; anything else typed into the free-text column goes last, as it is. */
export const PRIORITY_ORDER = ["critical", "high", "medium", "low"] as const;

export function byPriority(rows: readonly DashboardWo[]): Slice[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const p = (r.priority ?? "").trim().toLowerCase() || "medium"; // the column's default
    counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  const known = PRIORITY_ORDER.filter((p) => counts.has(p)).map((p) => ({ label: p, count: counts.get(p)! }));
  const rest = [...counts].filter(([p]) => !(PRIORITY_ORDER as readonly string[]).includes(p))
    .map(([label, count]) => ({ label, count }));
  return [...known, ...rest];
}

export function isHighPriority(r: DashboardWo): boolean {
  const p = (r.priority ?? "").trim().toLowerCase();
  return p === "critical" || p === "high";
}

/** Count by a label, biggest first, ties by name. */
export function countBy<T>(rows: readonly T[], label: (r: T) => string): Slice[] {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(label(r), (counts.get(label(r)) ?? 0) + 1);
  return [...counts].map(([l, count]) => ({ label: l, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export const NOT_ASSIGNED = "Not assigned";
export const NO_LINE = "No line recorded";

export function byEngineer(rows: readonly DashboardWo[]): Slice[] {
  return countBy(rows, (r) => r.engineer_name?.trim() || NOT_ASSIGNED);
}

export function byLine(rows: readonly DashboardWo[]): Slice[] {
  return countBy(rows, (r) => r.line_at_time?.trim() || NO_LINE);
}

/**
 * Corrective against preventive. `production` is the corrective type — what the orders
 * list's "Corrective" filter means; warehouse orders are not maintenance and are not
 * loaded here at all.
 */
export function typeSplit(rows: readonly DashboardWo[]): { corrective: number; preventive: number } {
  let corrective = 0, preventive = 0;
  for (const r of rows) {
    if (r.wo_type === "preventive") preventive += 1;
    else if ((r.wo_type ?? "production") === "production") corrective += 1;
  }
  return { corrective, preventive };
}

/** Not accepted yet: still `open`, nobody has taken it. */
export function notAccepted(rows: readonly DashboardWo[]): number {
  return rows.filter((r) => r.status === "open").length;
}

/**
 * In progress for more than 72 hours — the orders list's "Stale" filter, same rule.
 * There is no due date on a work order, so this is the only "overdue" the data can say.
 */
export const STALE_MINUTES = 72 * 60;
export function stale(rows: readonly DashboardWo[], now: Date = new Date()): number {
  return rows.filter((r) => r.status === "in_progress" && r.started_at
    && (now.getTime() - new Date(r.started_at).getTime()) / 60_000 > STALE_MINUTES).length;
}
