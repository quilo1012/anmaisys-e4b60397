/**
 * Team-activity downtime exclusions.
 *
 * When a line is stopped by a maintenance order, part of that stoppage can be
 * spent on team activities (break, filling blender, brushing & cleaning). Those
 * minutes must NOT count as downtime for the order.
 *
 * Exclusions are an OVERLAY: the raw `downtime_events` rows stay untouched for
 * audit. Every downtime calculation subtracts the overlap between a stop
 * interval and the work order's exclusion intervals.
 *
 * All helpers here are pure so they can be shared by pages, hooks and exports.
 */

import type { Interval, RawStop } from "@/lib/downtimeReconcile";

export const EXCLUSION_ACTIVITIES = ["break", "filling_blender", "brushing_cleaning"] as const;
export type ExclusionActivity = (typeof EXCLUSION_ACTIVITIES)[number];

export const ACTIVITY_LABELS: Record<string, string> = {
  break: "Break",
  filling_blender: "Filling blender",
  brushing_cleaning: "Brushing & cleaning",
};

export function activityLabel(activity: string | null | undefined): string {
  if (!activity) return "—";
  return ACTIVITY_LABELS[activity] ?? activity;
}

export interface RawExclusion {
  started_at: string | Date | null | undefined;
  ended_at?: string | Date | null;
}

/** Merge overlapping/touching intervals into a sorted, disjoint list. */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const valid = intervals.filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e > s);
  if (valid.length === 0) return [];
  const sorted = [...valid].sort((a, b) => a[0] - b[0]);
  const out: Interval[] = [];
  let [curS, curE] = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    const [s, e] = sorted[i];
    if (s > curE) {
      out.push([curS, curE]);
      curS = s;
      curE = e;
    } else if (e > curE) {
      curE = e;
    }
  }
  out.push([curS, curE]);
  return out;
}

/** Convert raw exclusion rows into merged intervals (open exclusion = until now). */
export function toExclusionIntervals(
  rows: RawExclusion[] | null | undefined,
  nowMs: number = Date.now(),
): Interval[] {
  const ivs: Interval[] = [];
  for (const r of rows ?? []) {
    if (!r?.started_at) continue;
    const s = new Date(r.started_at).getTime();
    const e = r.ended_at ? new Date(r.ended_at).getTime() : nowMs;
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) continue;
    ivs.push([s, e]);
  }
  return mergeIntervals(ivs);
}

/** Total overlap (ms) between a stop window and already-merged exclusions. */
export function exclusionOverlapMs(
  stopStart: number,
  stopEnd: number,
  merged: Interval[],
): number {
  if (!(stopEnd > stopStart) || merged.length === 0) return 0;
  let acc = 0;
  for (const [s, e] of merged) {
    const o = Math.min(stopEnd, e) - Math.max(stopStart, s);
    if (o > 0) acc += o;
  }
  return acc;
}

/**
 * Minutes of a stop window [stopStart, stopEnd] that are covered by team
 * activities. Accepts raw exclusion rows or pre-merged intervals.
 */
export function subtractExclusionMinutes(
  stopStart: string | Date | number | null | undefined,
  stopEnd: string | Date | number | null | undefined,
  exclusions: RawExclusion[] | Interval[] | null | undefined,
  nowMs: number = Date.now(),
): number {
  if (!stopStart) return 0;
  const s = typeof stopStart === "number" ? stopStart : new Date(stopStart).getTime();
  const e = stopEnd == null
    ? nowMs
    : typeof stopEnd === "number" ? stopEnd : new Date(stopEnd).getTime();
  const merged = isIntervalList(exclusions)
    ? mergeIntervals(exclusions)
    : toExclusionIntervals(exclusions as RawExclusion[], nowMs);
  return Math.round(exclusionOverlapMs(s, e, merged) / 60_000);
}

function isIntervalList(x: unknown): x is Interval[] {
  return Array.isArray(x) && (x.length === 0 || Array.isArray(x[0]));
}

/** Remove merged exclusion ranges from one interval, returning the remainder. */
export function subtractIntervals(iv: Interval, merged: Interval[]): Interval[] {
  let pieces: Interval[] = [iv];
  for (const [xs, xe] of merged) {
    const next: Interval[] = [];
    for (const [ps, pe] of pieces) {
      if (xe <= ps || xs >= pe) { next.push([ps, pe]); continue; }
      if (xs > ps) next.push([ps, xs]);
      if (xe < pe) next.push([xe, pe]);
    }
    pieces = next;
    if (pieces.length === 0) break;
  }
  return pieces;
}

/**
 * Expand a raw stop into the sub-stops that remain after removing the work
 * order's team-activity exclusions. Use this before unioning/reconciling so
 * excluded minutes never enter the wall-clock total.
 */
export function splitStopByExclusions<T extends RawStop>(
  stop: T,
  exclusions: RawExclusion[] | Interval[] | null | undefined,
  nowMs: number = Date.now(),
): T[] {
  if (!stop.start) return [stop];
  const merged = isIntervalList(exclusions)
    ? mergeIntervals(exclusions)
    : toExclusionIntervals(exclusions as RawExclusion[], nowMs);
  if (merged.length === 0) return [stop];

  const s = new Date(stop.start).getTime();
  const e = stop.end ? new Date(stop.end).getTime() : nowMs;
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return [stop];

  const remaining = subtractIntervals([s, e], merged);
  if (remaining.length === 0) return [];
  return remaining.map((piece, idx) => ({
    ...stop,
    start: new Date(piece[0]).toISOString(),
    // Keep the last piece "open" when the original stop was open and it runs to now.
    end: !stop.end && idx === remaining.length - 1 && piece[1] >= e
      ? null
      : new Date(piece[1]).toISOString(),
  })) as T[];
}

/** Convenience map lookup helper: merged exclusions for a work order id. */
export type ExclusionMap = Record<string, Interval[]>;

export function exclusionsFor(map: ExclusionMap | undefined, woId: string | null | undefined): Interval[] {
  if (!map || !woId) return [];
  return map[woId] ?? [];
}
