/**
 * Pure KPI arithmetic for the department dashboards. Kept apart from the pages so
 * every number on screen can be tested against plain rows.
 */

export type WoRow = { status: string; priority: string | null; created_at: string; completed_at?: string | null; finished_at?: string | null; closed_at?: string | null; line_stopped?: boolean | null; line_resumed_at?: string | null; machine?: string | null };

const OPEN = new Set(["open", "received", "arrived"]);
const DONE = new Set(["completed", "finished", "closed", "force_closed"]);
/** Same 72h threshold as the "stale" badge on the work order list. */
export const STALE_HOURS = 72;

export function woKpis(rows: WoRow[], now: Date, weekStart: Date, dayStart: Date) {
  let open = 0, inProgress = 0, stale = 0, doneToday = 0, doneWeek = 0, lineDown = 0, highOpen = 0;
  const byPriority: Record<string, number> = {};
  for (const r of rows) {
    const active = OPEN.has(r.status) || r.status === "in_progress";
    if (OPEN.has(r.status)) open++;
    if (r.status === "in_progress") inProgress++;
    if (active) {
      const p = (r.priority ?? "medium").toLowerCase();
      byPriority[p] = (byPriority[p] ?? 0) + 1;
      if (p === "high" || p === "critical") highOpen++;
      if ((now.getTime() - new Date(r.created_at).getTime()) / 3.6e6 > STALE_HOURS) stale++;
      if (r.line_stopped && !r.line_resumed_at) lineDown++;
    }
    if (DONE.has(r.status) && r.status !== "force_closed") {
      const at = r.closed_at ?? r.finished_at ?? r.completed_at;
      if (at) {
        const d = new Date(at);
        if (d >= dayStart) doneToday++;
        if (d >= weekStart) doneWeek++;
      }
    }
  }
  return { total: rows.length, open, inProgress, stale, doneToday, doneWeek, lineDown, highOpen, byPriority };
}

export function pmDueSoon(rows: { next_due_at: string | null; active: boolean | null }[], now: Date, days = 7) {
  let overdue = 0, soon = 0;
  const limit = now.getTime() + days * 864e5;
  for (const r of rows) {
    if (!r.active || !r.next_due_at) continue;
    const t = new Date(r.next_due_at).getTime();
    if (t < now.getTime()) overdue++;
    else if (t <= limit) soon++;
  }
  return { overdue, soon };
}

export type AllocRow = { employee_id: string; status: string; area_id: string | null };
const AWAY = new Set(["sick", "holiday", "unpaid"]);

/** One count per person: a person working anywhere that shift counts as working. */
export function staffingKpis(rows: AllocRow[]) {
  const status = new Map<string, string>();
  for (const r of rows) {
    const prev = status.get(r.employee_id);
    const working = !AWAY.has(r.status);
    if (!prev || (working && AWAY.has(prev))) status.set(r.employee_id, r.status);
  }
  const absence: Record<string, number> = { sick: 0, holiday: 0, unpaid: 0 };
  let working = 0, overtime = 0, training = 0;
  for (const s of status.values()) {
    if (AWAY.has(s)) absence[s]++;
    else {
      working++;
      if (s === "overtime") overtime++;
      if (s === "training") training++;
    }
  }
  const byArea: Record<string, number> = {};
  const seen = new Set<string>();
  for (const r of rows) {
    if (AWAY.has(r.status) || !r.area_id) continue;
    const k = `${r.employee_id}|${r.area_id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    byArea[r.area_id] = (byArea[r.area_id] ?? 0) + 1;
  }
  return { planned: status.size, working, overtime, training, absence, absent: absence.sick + absence.holiday + absence.unpaid, byArea };
}

export function productionTotals(items: { target_qty: number | null; actual_qty: number | null }[]) {
  let target = 0, actual = 0;
  for (const i of items) { target += i.target_qty ?? 0; actual += i.actual_qty ?? 0; }
  return { target, actual, pct: target > 0 ? Math.round((actual / target) * 100) : null };
}
