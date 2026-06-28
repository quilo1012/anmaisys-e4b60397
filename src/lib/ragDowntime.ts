/**
 * Shared mapping helpers for RAG Weekly downtime so the calculation
 * stays in lock-step with the Work Orders list.
 *
 * Rules (must match RAGWeeklyPage / Work Orders):
 *  - A Work Order only contributes downtime when `line_stopped_at` is set.
 *  - The end timestamp is `line_resumed_at`, falling back to `finished_at`,
 *    then `closed_at`. For terminal statuses with no end timestamps at all,
 *    fall back to `line_stopped_at` (zero-length) so they aren't treated as
 *    "ongoing" and don't inflate later shifts.
 *  - Non-terminal WOs with no resume keep `end = null` (ongoing).
 */

import { reconcileMinutes, type RawStop } from "@/lib/downtimeReconcile";

export const TERMINAL_WO_STATUSES = new Set([
  "finished",
  "cancelled",
  "canceled",
  "force_closed",
  "closed",
]);

export interface WoRowForDowntime {
  status?: string | null;
  line_at_time?: string | null;
  line_stopped_at?: string | null;
  line_resumed_at?: string | null;
  finished_at?: string | null;
  closed_at?: string | null;
}

export interface MappedStop extends RawStop {
  line: string | null;
}

export function mapWoToStop(r: WoRowForDowntime): MappedStop | null {
  if (!r.line_stopped_at) return null;
  const isTerminal = TERMINAL_WO_STATUSES.has(String(r.status ?? "").toLowerCase());
  const end =
    r.line_resumed_at ??
    r.finished_at ??
    r.closed_at ??
    (isTerminal ? r.line_stopped_at : null);
  return {
    line: r.line_at_time ?? null,
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
): number {
  const stops = rows
    .map(mapWoToStop)
    .filter((s): s is MappedStop => !!s && s.line === line);
  return reconcileMinutes(stops, windowStart, windowEnd, nowMs);
}

