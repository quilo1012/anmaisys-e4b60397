/**
 * What iTouching says a line is doing, right now.
 *
 * Separate from the pace in `linePerformance.ts` on purpose: the two disagree
 * deliberately. A line can be critical on the shift's accumulated output because
 * of a breakdown this morning and be running perfectly at this minute, and the
 * supervisor needs both readings side by side.
 *
 * WHAT DECIDES A GREEN PILL. Two things, and it used to be one. A stop code names
 * the stop exactly, and where the code is present the reason is verbatim. But the
 * ABSENCE of a code is not production: iTouching publishes a DowntimeCode only
 * while one is active on the panel, and today's `production_downtimes` show codes
 * opening and closing on the same line minute by minute, with blank between them.
 *
 * So the status decides whether a line with no code is running, and 1 and 2 are
 * the only values that mean it is — `intouch-poll`'s HEALTHY_STATUS and
 * `wallboard-lines`, which has always refused "a green light nobody earned". This
 * board was the one screen that gave it away for free: on 12/08 at 09:57 UTC six
 * of seven lines sat at status 4 or 6 with no code and all seven read RUNNING.
 * Line 5 had made nothing, had no order, and had spent the morning in Brushing
 * and Cleaning, Line Preparation and Alarm.
 *
 * WHAT THIS STILL DOES NOT KNOW: what 4 and 6 mean apart from each other. Both
 * are outside the healthy set, so both read as a stop nobody coded — which is
 * iTouching's own fourth state, not an invention — and the raw number is carried
 * through untouched for whoever settles the question with the vendor.
 */

export type LiveState =
  | "RUNNING"
  /** Standing still with no reason published. iTouching's "STOPPED-NO CODE". */
  | "STOPPED_NO_CODE"
  | "PLANNED_STOP"
  | "UNPLANNED_STOP"
  | "NO_SIGNAL"
  | "NOT_MAPPED";

/**
 * The statuses that mean the machine is making something. Same set as
 * `intouch-poll`'s HEALTHY_STATUS and `wallboard-lines`' — kept identical on
 * purpose: three screens disagreeing about what "running" is, is how a line came
 * to read green and stopped at the same time.
 */
export const ITOUCH_HEALTHY_STATUS = new Set<number>([1, 2]);

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
  /**
   * `intouch_machine_map.prod_dt_started_at` — when the poll FIRST SAW this stop.
   * Not when the stop began: the poll runs once a minute, and a stop already
   * running before tracking was fixed on 08/08 reads from the moment tracking
   * started. Null for maintenance stops, which carry a work order and are timed
   * by the order's own clock.
   */
  stopSince?: Date | null;
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
  /**
   * How long the line has been in this stop, in seconds, or null when there is
   * nothing to time. Counts up on the board's own clock so it moves every second
   * rather than every poll.
   */
  stoppedForSeconds: number | null;
}

export function classifyLive(reading: LiveReading | null | undefined, now: Date): LiveStatus {
  if (!reading) {
    return { state: "NOT_MAPPED", label: "No machine mapped", ageSeconds: null, rawStatus: null, uncatalogued: false, stoppedForSeconds: null };
  }

  const ageSeconds = reading.seenAt
    ? Math.max(0, Math.floor((now.getTime() - reading.seenAt.getTime()) / 1000))
    : null;

  const reason = (reason_ => (reason_ && reason_.trim() ? reason_.trim() : null))(reading.reason);
  const uncatalogued = !!reason && reading.planned === null;
  // Only a stop has a duration. A running line showing a counter would be timing
  // nothing, and iTouching's own board puts a clock beside a stop and not beside
  // "Running".
  const stoppedForSeconds = reason && reading.stopSince
    ? Math.max(0, Math.floor((now.getTime() - reading.stopSince.getTime()) / 1000))
    : null;

  // Stale first, and it keeps the reason visible. A line that went down and then
  // fell silent is still down as far as anyone knows; blanking the label would
  // throw away the last thing the floor was told.
  if (ageSeconds === null || ageSeconds > STALE_AFTER_SECONDS) {
    return {
      state: "NO_SIGNAL",
      // Ours, not iTouching's: this describes OUR link to it, not a state it
      // reports. The stop code keeps its own name inside the message.
      label: reason ? `NO SIGNAL · last: ${reason}` : "NO SIGNAL",
      ageSeconds,
      rawStatus: reading.status,
      uncatalogued,
      stoppedForSeconds,
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
      stoppedForSeconds,
    };
  }

  // No stop code, so the status is the only witness left.
  //
  // A reading with no status at all is not a state either way: nothing has been
  // said about this machine, which is what NO SIGNAL means, and it is honest about
  // that instead of picking one of the two answers it does not have.
  if (reading.status == null) {
    return { state: "NO_SIGNAL", label: "NO SIGNAL", ageSeconds, rawStatus: null, uncatalogued: false, stoppedForSeconds: null };
  }

  if (ITOUCH_HEALTHY_STATUS.has(reading.status)) {
    // RUNNING is iTouching's own word, from the legend the floor already reads:
    // RUNNING / STOPPED-NO CODE / UNPLANNED STOP / PLANNED STOP. The board must
    // not invent a vocabulary beside it.
    return { state: "RUNNING", label: "RUNNING", ageSeconds, rawStatus: reading.status, uncatalogued: false, stoppedForSeconds: null };
  }

  // Standing still, and iTouching has published no reason for it. The fourth state
  // in that legend, and the one this board did not have — so it called it RUNNING.
  // Nothing to time: with no code there is no `stop_since_at` to time it from.
  return {
    state: "STOPPED_NO_CODE",
    label: "STOPPED · NO CODE",
    ageSeconds,
    rawStatus: reading.status,
    uncatalogued: false,
    stoppedForSeconds: null,
  };
}

/**
 * Tailwind classes per state, using the app's semantic tokens rather than raw
 * colours so both themes and the AA-contrast work already done carry over.
 */
export const LIVE_TONE: Record<LiveState, string> = {
  RUNNING: "bg-success/10 text-success-strong border-success/30",
  // Neither green nor a fault. A line standing still with nobody saying why is
  // something to go and ask about, which is what the warning tone is for — and it
  // must not borrow the red that a named breakdown owns.
  STOPPED_NO_CODE: "bg-warning/10 text-warning-strong border-warning/30",
  // Planned stops are deliberately quiet. The line is down on purpose, and
  // painting a deep clean the same red as a breakdown is how a board teaches
  // people to ignore red.
  PLANNED_STOP: "bg-muted text-muted-foreground border-border",
  UNPLANNED_STOP: "bg-destructive/10 text-destructive-strong border-destructive/30",
  NO_SIGNAL: "bg-muted text-muted-foreground border-border",
  NOT_MAPPED: "bg-muted text-muted-foreground border-border",
};

/**
 * The one number the card writes beside the stop reason — and WHICH number it is.
 *
 * There is a single slot to the right of the reason, and it used to carry two
 * different quantities without ever saying which: the stop's duration when one
 * was being tracked, and the READING'S AGE when it was not. Both are seconds,
 * both in the same figure style, in the same place. Line 1 sat in "Filling
 * Blender/ Blending" and the card read "78s" — the age of the last poll, on a
 * stop that had been running far longer. In the slot where a stop's duration
 * goes, that is not an approximation, it is a different fact wearing its clothes.
 *
 * So the kind is returned with the text and the card styles the two apart. When
 * a stop has no clock the card says so — an empty slot reads as "just stopped",
 * and "we are not timing this one" is a different thing to say.
 */
export type StopClockKind = "STOP" | "UNTIMED" | "AGE";

export interface StopClock {
  kind: StopClockKind;
  text: string;
}

export function stopClock(live: LiveStatus): StopClock | null {
  const stopped = live.state === "PLANNED_STOP" || live.state === "UNPLANNED_STOP"
    // A stop that has gone quiet is still a stop, and its clock is the one worth
    // reading — the label already carries "NO SIGNAL · last: …".
    || (live.state === "NO_SIGNAL" && live.stoppedForSeconds != null);

  if (stopped) {
    const timed = formatStopDuration(live.stoppedForSeconds);
    return timed ? { kind: "STOP", text: timed } : { kind: "UNTIMED", text: "—" };
  }

  if (live.ageSeconds == null) return null;
  return {
    kind: "AGE",
    text: live.ageSeconds < 90 ? `${live.ageSeconds}s` : `${Math.floor(live.ageSeconds / 60)}m`,
  };
}

/**
 * H:MM:SS, the way the iTouching board writes a stop's duration, so the two
 * screens can be compared at a glance without anyone converting anything.
 */
export function formatStopDuration(seconds: number | null): string | null {
  if (seconds == null || seconds < 0) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
