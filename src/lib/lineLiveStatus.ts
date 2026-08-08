/**
 * What iTouching says a line is doing, right now.
 *
 * Separate from the pace in `linePerformance.ts` on purpose: the two disagree
 * deliberately. A line can be critical on the shift's accumulated output because
 * of a breakdown this morning and be running perfectly at this minute, and the
 * supervisor needs both readings side by side.
 *
 * WHAT THIS DOES NOT KNOW. `intouch_machine_map.last_status` holds 4, 6 and 7 in
 * this installation — never the 1 and 2 that `intouch-poll`'s HEALTHY_STATUS
 * expects — and nobody has confirmed what the numbers mean. So the state is
 * decided by the presence of a STOP CODE, which is unambiguous, and the raw
 * number is carried through untouched for whoever settles that question.
 *
 * One consequence worth knowing before reading a green pill: a machine on Breaks
 * has been observed reporting as running with no stop code (measured on Filler
 * Line 2 and 4, see migration 20260731230000). Where the code IS present — which
 * is the case for every machine mapped today — the reason is exact.
 */

export type LiveState =
  | "RUNNING"
  | "PLANNED_STOP"
  | "UNPLANNED_STOP"
  | "NO_SIGNAL"
  | "NOT_MAPPED";

/** A reading older than this is not a state, it is a memory. */
export const STALE_AFTER_SECONDS = 90;

export interface LiveReading {
  /** `intouch_machine_map.last_status`. 4, 6 and 7 in production. */
  status: number | null;
  /** Stop code label, already resolved from the GUID. Null when no stop is active. */
  reason: string | null;
  /**
   * `intouch_stop_code_catalog.planned`. Null when the label has no catalogue
   * match — 7 of 48 mapped codes, "Electrical Stop" among them.
   */
  planned: boolean | null;
  /** `intouch_machine_map.last_seen_at`. */
  seenAt: Date | null;
}

export interface LiveStatus {
  state: LiveState;
  /** What the pill says. Never a UUID, never empty. */
  label: string;
  /** Seconds since the reading, or null when there has never been one. */
  ageSeconds: number | null;
  /** Carried through unread so the vendor's answer can refine this later. */
  rawStatus: number | null;
  /**
   * True when the stop code is not in the catalogue, so planned/unplanned is a
   * guess. The label is still shown — wrong and visible beats absent.
   */
  uncatalogued: boolean;
}

export function classifyLive(reading: LiveReading | null | undefined, now: Date): LiveStatus {
  if (!reading) {
    return { state: "NOT_MAPPED", label: "No machine mapped", ageSeconds: null, rawStatus: null, uncatalogued: false };
  }

  const ageSeconds = reading.seenAt
    ? Math.max(0, Math.floor((now.getTime() - reading.seenAt.getTime()) / 1000))
    : null;

  const reason = (reason_ => (reason_ && reason_.trim() ? reason_.trim() : null))(reading.reason);
  const uncatalogued = !!reason && reading.planned === null;

  // Stale first, and it keeps the reason visible. A line that went down and then
  // fell silent is still down as far as anyone knows; blanking the label would
  // throw away the last thing the floor was told.
  if (ageSeconds === null || ageSeconds > STALE_AFTER_SECONDS) {
    return {
      state: "NO_SIGNAL",
      label: reason ? `No signal · last: ${reason}` : "No signal",
      ageSeconds,
      rawStatus: reading.status,
      uncatalogued,
    };
  }

  if (reason) {
    return {
      // An uncatalogued code is treated as unplanned. A stop nobody classified is
      // more likely a fault than a scheduled clean, and the pill names it either
      // way — the operator reads "Electrical Stop", not a shrug.
      state: reading.planned === true ? "PLANNED_STOP" : "UNPLANNED_STOP",
      label: reason,
      ageSeconds,
      rawStatus: reading.status,
      uncatalogued,
    };
  }

  // No stop code. Not proof of production — see the Breaks note above — but it is
  // exactly what iTouching is saying, and it is what the floor reads as running.
  return { state: "RUNNING", label: "Running", ageSeconds, rawStatus: reading.status, uncatalogued: false };
}

/**
 * Tailwind classes per state, using the app's semantic tokens rather than raw
 * colours so both themes and the AA-contrast work already done carry over.
 */
export const LIVE_TONE: Record<LiveState, string> = {
  RUNNING: "bg-success/10 text-success-strong border-success/30",
  // Planned stops are deliberately quiet. The line is down on purpose, and
  // painting a deep clean the same red as a breakdown is how a board teaches
  // people to ignore red.
  PLANNED_STOP: "bg-muted text-muted-foreground border-border",
  UNPLANNED_STOP: "bg-destructive/10 text-destructive-strong border-destructive/30",
  NO_SIGNAL: "bg-muted text-muted-foreground border-border",
  NOT_MAPPED: "bg-muted text-muted-foreground border-border",
};
