/**
 * Whether a shift ran, and for how long the line was open (decided 07/11, Q77–Q79).
 *
 * - Not run: two hours after the start, no shift opened on the tablet and nothing logged.
 *   On 07/11 Lines 2, 4 and 5 had a Smart Target for the night and no night shift at all.
 * - Finished early: once the shift is over, a line whose machine last ran an hour or more
 *   before the end, while the log was still hearing from the factory near the end, closed
 *   at its last run. Line 2 last ran at 12:40 on 07/11. A log that went silent proves
 *   nothing, so then the line is taken as open to the end.
 */
import { shiftWindow, type ShiftType } from "@/lib/smartTargetEngine";

export const NOT_RUN_AFTER_MINUTES = 120;
/** Idle this long before the end means the line had closed, not paused. */
export const CLOSED_BEFORE_END_MINUTES = 60;
/** The log must have spoken this close to the end for its silence about a line to count. */
export const LOG_ALIVE_NEAR_END_MINUTES = 45;

export interface ShiftRun {
  lastRunAt: string | null;
  heardUntil: string | null;
}

export type ShiftOutcome =
  | { kind: "upcoming" }
  | { kind: "not_run" }
  | { kind: "ran"; finishedAt: string | null; openMinutes: number; grossMinutes: number };

export function shiftOutcome(input: {
  date: string;
  shift: ShiftType;
  hasSession: boolean;
  logged: number;
  run: ShiftRun | undefined;
  nowMs: number;
}): ShiftOutcome {
  const w = shiftWindow(input.date, input.shift);
  if (!w) return { kind: "ran", finishedAt: null, openMinutes: 720, grossMinutes: 720 };
  const full: ShiftOutcome = { kind: "ran", finishedAt: null, openMinutes: w.grossMinutes, grossMinutes: w.grossMinutes };
  const worked = input.hasSession || input.logged > 0;
  if (!worked) {
    if (input.nowMs < w.startMs + NOT_RUN_AFTER_MINUTES * 60_000) return { kind: "upcoming" };
    return { kind: "not_run" };
  }
  if (input.nowMs < w.endMs) return full;
  const last = input.run?.lastRunAt ? Date.parse(input.run.lastRunAt) : NaN;
  const heard = input.run?.heardUntil ? Date.parse(input.run.heardUntil) : NaN;
  const closed =
    Number.isFinite(last) &&
    Number.isFinite(heard) &&
    last <= w.endMs - CLOSED_BEFORE_END_MINUTES * 60_000 &&
    heard >= w.endMs - LOG_ALIVE_NEAR_END_MINUTES * 60_000;
  if (!closed) return full;
  const at = Math.max(last, w.startMs);
  return { kind: "ran", finishedAt: new Date(at).toISOString(), openMinutes: Math.round((at - w.startMs) / 60_000), grossMinutes: w.grossMinutes };
}

/** The target for the hours the line was open. */
export function targetForHoursOpen(expected: number, o: ShiftOutcome): number {
  return o.kind === "ran" && o.finishedAt ? Math.round((expected * o.openMinutes) / o.grossMinutes) : expected;
}

/** Ended before half the shift: kept out of the engine's measurement (Q79). */
export function endedBeforeHalfway(o: ShiftOutcome): boolean {
  return o.kind === "ran" && !!o.finishedAt && o.openMinutes < o.grossMinutes / 2;
}
