/**
 * Shared downtime reconciliation utilities.
 *
 * Single source of truth for the calculations used by:
 *  - Shift Breakdown (ShiftBreakdownCard)
 *  - Total Downtime KPI (DowntimePage)
 *  - Machine Problem History (DowntimePage)
 *
 * Guarantees:
 *  1. Wall-clock totals are computed as a UNION of intervals — parallel
 *     stoppages are counted ONCE.
 *  2. All intervals are clamped to the given [windowStart, windowEnd].
 *  3. WO-based stops and manual downtime records share the same shape
 *     via `toInterval`, so divergences between views are impossible by
 *     construction.
 */

export type Interval = [number, number]; // [startMs, endMs)

export interface RawStop {
  start: string | Date | null | undefined;
  end?: string | Date | null;
}

/** Convert a raw stop into a clamped interval, or null when outside the window. */
export function toInterval(
  stop: RawStop,
  windowStart: number,
  windowEnd: number,
  nowMs: number = Date.now(),
): Interval | null {
  if (!stop.start) return null;
  const s = new Date(stop.start).getTime();
  const e = stop.end ? new Date(stop.end).getTime() : nowMs;
  if (!Number.isFinite(s) || !Number.isFinite(e)) return null;
  const cs = Math.max(s, windowStart);
  const ce = Math.min(e, windowEnd);
  return ce > cs ? [cs, ce] : null;
}

/** Merge overlapping intervals and return total wall-clock milliseconds. */
export function unionMs(intervals: Interval[]): number {
  if (intervals.length === 0) return 0;
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  let acc = 0;
  let curS = sorted[0][0];
  let curE = sorted[0][1];
  for (let i = 1; i < sorted.length; i++) {
    const [s, e] = sorted[i];
    if (s > curE) {
      acc += curE - curS;
      curS = s;
      curE = e;
    } else if (e > curE) {
      curE = e;
    }
  }
  acc += curE - curS;
  return acc;
}

/** Convenience: union of raw stops, clamped, returned in minutes (rounded). */
export function reconcileMinutes(
  stops: RawStop[],
  windowStart: number,
  windowEnd: number,
  nowMs: number = Date.now(),
): number {
  const ivs: Interval[] = [];
  for (const s of stops) {
    const iv = toInterval(s, windowStart, windowEnd, nowMs);
    if (iv) ivs.push(iv);
  }
  return Math.round(unionMs(ivs) / 60_000);
}

/**
 * Group stops by an arbitrary key (machine name, line, etc.) and return the
 * union-minutes per group plus an `ongoing` flag. Use this for breakdown
 * tables so per-row totals never exceed the wall-clock window total.
 */
export function reconcileByKey<T extends RawStop>(
  stops: T[],
  keyFn: (s: T) => string,
  windowStart: number,
  windowEnd: number,
  nowMs: number = Date.now(),
): Array<{ key: string; minutes: number; ongoing: boolean; count: number }> {
  const buckets = new Map<string, { ivs: Interval[]; ongoing: boolean; count: number }>();
  for (const s of stops) {
    const iv = toInterval(s, windowStart, windowEnd, nowMs);
    if (!iv) continue;
    const k = keyFn(s) || "—";
    const b = buckets.get(k) ?? { ivs: [], ongoing: false, count: 0 };
    b.ivs.push(iv);
    b.count += 1;
    if (!s.end) b.ongoing = true;
    buckets.set(k, b);
  }
  return Array.from(buckets.entries())
    .map(([key, b]) => ({
      key,
      minutes: Math.round(unionMs(b.ivs) / 60_000),
      ongoing: b.ongoing,
      count: b.count,
    }))
    .sort((a, b) => b.minutes - a.minutes);
}
