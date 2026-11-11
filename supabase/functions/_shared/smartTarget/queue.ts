/**
 * Order quantities from iTouch's queue, for plan rows that have none (decided 05/11, Q26b).
 *
 * The plan rows Smart Target reads (production_items) get their quantity only once
 * production is logged. iTouch knows each queued works order's quantity and how much of
 * it is already made. The page reads the queue once per shift through the function the
 * Planner already uses (intouch-list-scheduled-jobs), keeps it in
 * smart_target_queue_snapshots, and fills the missing quantities from it.
 *
 * What is filled is what was LEFT to make when the queue was read: order − made. A queue
 * read mid-shift therefore shows less than one read at 06:00, and the card says when it
 * was read. A plan row never takes a quantity from a different product. Each queued
 * order fills at most one plan row, matched by SKU in queue order.
 *
 * The queue is live: iTouch says what is queued NOW, not what was queued on a past date.
 * So it is only read for the shift that is running, never for another one.
 */

import { normaliseSku, parseLineNo, type LineNo, type PlannedJob, type ShiftType } from "./engine.ts";
import { getCurrentFactoryShift } from "../production/shifts.ts";

/** One queued job as the scheduled-jobs function returns it, inside `sections[].items`. */
export interface ScheduledJobItem {
  sku_code: string;
  qty: number | null;
  actual?: number | null;
  status?: string | null;
  seq?: number | null;
  /** The product's name: the catalogue's, else iTouch's own description. */
  description?: string | null;
}

export interface QueueRow {
  line: string;
  seq: number;
  sku: string;
  order_qty: number | null;
  done_qty: number | null;
  status: string | null;
  /** iTouch's name for the product, when it gave one. Kept in memory only, never saved. */
  description?: string | null;
}

/**
 * The product of a queued works order. iTouch's queue holds one order per batch, with the
 * batch in the part code ("CRE500 - B15", "BEEFXPCA -B1"), so without this no queued order
 * matches a plan row, a cycle or a rate.
 */
export function queuedProduct(sku: string | null | undefined): string | null {
  return normaliseSku(String(sku ?? "").replace(/\s*-\s*B\d+\s*$/i, ""));
}

/** The function's sections into the rows save_smart_target_queue() stores. */
export function queueRowsFromSections(sections: { line: string; items: ScheduledJobItem[] }[]): QueueRow[] {
  const out: QueueRow[] = [];
  for (const s of sections ?? []) {
    (s.items ?? []).forEach((it, i) => {
      const sku = String(it.sku_code ?? "").trim();
      if (!sku || !String(s.line ?? "").trim()) return;
      const n = (v: unknown) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
      out.push({
        line: s.line.trim(),
        seq: n(it.seq) ?? i + 1,
        sku,
        order_qty: n(it.qty),
        done_qty: n(it.actual),
        status: it.status ?? null,
        ...(it.description && String(it.description).trim() ? { description: String(it.description).trim() } : {}),
      });
    });
  }
  return out;
}

/** True only for the shift running at `now`: the queue cannot describe any other. */
export function isCurrentShift(date: string, shift: ShiftType, now: Date = new Date()): boolean {
  const cur = getCurrentFactoryShift(now);
  return cur.sessionDate === date && (cur.shiftCode === "day" ? "DAY" : "NIGHT") === shift;
}

/**
 * Fills each plan job that has no order quantity from the first unused queued order of
 * the same SKU on that line. Returns the jobs and how many were filled.
 */
export function fillFromQueue(line: LineNo, jobs: PlannedJob[], queue: QueueRow[]): { jobs: PlannedJob[]; filled: number } {
  // Batches of one product in a row are one order for the plan row that makes them.
  const pool: (QueueRow & { key: string | null; used: boolean })[] = [];
  for (const q of queue.filter((x) => parseLineNo(x.line) === line).sort((a, b) => a.seq - b.seq)) {
    const key = queuedProduct(q.sku);
    const last = pool[pool.length - 1];
    const isBatch = key !== normaliseSku(q.sku);
    if (isBatch && last && last.key === key && last.order_qty !== null && q.order_qty !== null) {
      last.order_qty += q.order_qty;
      last.done_qty = (last.done_qty ?? 0) + (q.done_qty ?? 0);
    } else {
      pool.push({ ...q, key, used: false });
    }
  }
  let filled = 0;
  const out = jobs.map((j) => {
    if (j.orderQty && j.orderQty > 0) return j;
    const key = normaliseSku(j.sku);
    if (!key) return j;
    const match = pool.find((q) => !q.used && q.key === key);
    if (!match || match.order_qty === null || match.order_qty <= 0) return j;
    match.used = true;
    const left = match.order_qty - Math.max(0, match.done_qty ?? 0);
    // An order iTouch counts as already made gives this job nothing to make: leave it
    // unquantified rather than call it 0.
    if (left <= 0) return j;
    filled++;
    return { ...j, orderQty: left };
  });
  return { jobs: out, filled };
}
