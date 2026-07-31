/**
 * Shared mapping helpers for RAG Weekly downtime so the calculation
 * stays in lock-step with the Maintenance Orders list.
 *
 * Rules (must match RAGWeeklyPage / Maintenance Orders):
 *  - A Maintenance Order only contributes downtime when `line_stopped_at` is set.
 *  - The end timestamp is `line_resumed_at`, falling back to `finished_at`,
 *    then `closed_at`. For terminal statuses with no end timestamps at all,
 *    fall back to `line_stopped_at` (zero-length) so they aren't treated as
 *    "ongoing" and don't inflate later shifts.
 *  - Non-terminal WOs with no resume keep `end = null` (ongoing).
 */

import { reconcileMinutes, type RawStop } from "@/lib/downtimeReconcile";
import { exclusionsFor, splitRangeByExclusions, type ExclusionMap } from "@/lib/downtimeExclusions";

export const TERMINAL_WO_STATUSES = new Set([
  "finished",
  "cancelled",
  "canceled",
  "force_closed",
  "closed",
]);

export interface WoRowForDowntime {
  id?: string | null;
  status?: string | null;
  wo_type?: string | null;
  line_at_time?: string | null;
  line_stopped_at?: string | null;
  line_resumed_at?: string | null;
  finished_at?: string | null;
  closed_at?: string | null;
}

export interface MappedStop extends RawStop {
  line: string | null;
  workOrderId?: string | null;
}

export function mapWoToStop(r: WoRowForDowntime): MappedStop | null {
  // Defense-in-depth: warehouse service WOs never count as line downtime.
  if (r.wo_type === "warehouse_service") return null;
  if (!r.line_stopped_at) return null;
  const isTerminal = TERMINAL_WO_STATUSES.has(String(r.status ?? "").toLowerCase());
  const end =
    r.line_resumed_at ??
    r.finished_at ??
    r.closed_at ??
    (isTerminal ? r.line_stopped_at : null);
  return {
    line: r.line_at_time ?? null,
    workOrderId: r.id ?? null,
    start: r.line_stopped_at,
    end,
  };
}

export function shiftMinutesForLine(
  rows: WoRowForDowntime[],
  line: string,
  windowStart: number,
  windowEnd: number,
  nowMs?: number,
  /** Team-activity exclusions per work order — those minutes never count. */
  exclusions?: ExclusionMap,
): number {
  const stops = rows
    .map(mapWoToStop)
    .filter((s): s is MappedStop => !!s && s.line === line)
    .flatMap((s) => applyExclusionsToStop(s, exclusions, nowMs));
  return reconcileMinutes(stops, windowStart, windowEnd, nowMs);
}

/** Carve team-activity time out of a mapped stop before it is counted. */
export function applyExclusionsToStop(
  stop: MappedStop,
  exclusions?: ExclusionMap,
  nowMs?: number,
): MappedStop[] {
  const merged = exclusionsFor(exclusions, stop.workOrderId);
  if (merged.length === 0) return [stop];
  return splitRangeByExclusions(stop.start, stop.end ?? null, merged, nowMs)
    .map((piece) => ({ ...stop, start: piece.start, end: piece.end }));
}

