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
 * So the status decides whether a line with no code is running — and this board
 * cannot read the status. That is the finding, and it cost two wrong answers in
 * one day to reach.
 *
 * FIRST WRONG ANSWER: absence of a code read as RUNNING. On 12/08 at 09:57 UTC
 * six of seven lines sat at status 4 or 6 with no code and all seven read green.
 * Line 5 had made nothing, had no order, and had spent the morning in Brushing
 * and Cleaning, Line Preparation and Alarm.
 *
 * SECOND WRONG ANSWER: everything outside {1, 2} read as a stop nobody coded.
 * {1, 2} came from `intouch-poll`'s HEALTHY_STATUS and `wallboard-lines`', and no
 * evidence from this installation was ever offered for it. On 12/08 at 21:38 UTC
 * the two screens sat side by side: Filler Line 1 at status 4 and Filler Line 2
 * at status 6, both with no code, both reading "Running" on the iTouching board
 * at 12,1 and 21,8 fills per minute. Four cards claimed a stop on four lines that
 * were filling bottles. Meanwhile no line in this factory has ever reported 1 or
 * 2, and the one recorded sighting of status 1 on a real line — Filler Line 4,
 * 12/08 at 10:45 UTC — carried an active Deep Clean, which is a line STOPPED. The
 * set is not merely incomplete; it may be inverted.
 *
 * WHAT THIS BOARD DOES NOW. It answers the question it can answer and declines
 * the one it cannot. A stop code is a stop and names itself. A status this file
 * has been TOLD the meaning of decides between running and stopped. Anything else
 * is printed as the number it is — "STATUS 4 · UNKNOWN" — in the same grey as NO
 * SIGNAL, because an untranslated reading is not a state, and a supervisor
 * reading it can quote the number straight back to the vendor.
 *
 * HOW THE REMAINING NUMBERS GET SETTLED, AND HOW 4 WAS. Not from the database:
 * `getmachineStatuses` returns `{MachineID, Status, DowntimeCode}` and nothing
 * else, no endpoint in this integration returns a state in words, and
 * `live_job_state` — proposed here as the answer — turned out to read "next" on
 * every machine at once, running and stopped alike. It is the SCHEDULE's word for
 * the job, not the machine's word for itself, and it settles nothing.
 *
 * What settled 4 was a pair read off both screens at the same minute: the column
 * on one side, the vendor's own green on the other. That is the method, it costs
 * ten seconds on the floor, and each value gets one line in the table below with
 * its pair written beside it.
 */

export type LiveState =
  | "RUNNING"
  /** Standing still with no reason published. iTouching's "STOPPED-NO CODE". */
  | "STOPPED_NO_CODE"
  | "PLANNED_STOP"
  | "UNPLANNED_STOP"
  /** iTouching sent a number this board has no translation for. */
  | "UNKNOWN_STATUS"
  | "NO_SIGNAL"
  | "NOT_MAPPED";

/**
 * What each iTouching status is KNOWN to mean, and nothing else.
 *
 * A table rather than a set of "healthy" values, because the two answers are not
 * one answer and its negation: not-running and stopped are different claims, and
 * the gap between them is where four running lines were painted as stopped.
 *
 * 1 and 2 are here because `intouch-poll` and `wallboard-lines` have always said
 * so and nothing has been observed to contradict it — no machine here reports
 * either. They are the inherited claim, not a verified one, and the moment
 * `live_job_state` can settle it they should be re-checked with everything else.
 *
 * 4 IS RUNNING, and it is the only one of this installation's four values that
 * has been settled. Two independent readings of the vendor's own screen, taken
 * beside the column at the same minute:
 *
 *   13/08 07:33 UTC — Filler Lines 2, 3 and 6 and the Tablet Line at status 4
 *   with `last_downtime_code` empty; the supervisor read all four GREEN,
 *   "Running", on the iTouching board at that minute.
 *
 *   12/08 21:38 UTC — Filler Line 1 at status 4, no code, "Running" at 12,1
 *   fills per minute.
 *
 * And the other side of it, from the same snapshot: 7 has never once appeared
 * WITHOUT a code. At 07:33 the five machines that were down — Lines 1, 4, 5, the
 * GEL Line and Capsules MC 2 — were all at 7 with a reason active, and Line 5
 * moved 6 → 7 in the minute somebody selected "Brushing and Cleaning". So 7 is
 * the stop, and the code branch above answers it before the status is ever read.
 *
 * 8 IS RUNNING, on the same kind of pair, 13/08: the Tablet Line on OMEGA 3 -
 * 100 SOFT GELS, green and "Running" on the vendor's screen at 16,4 fills per
 * minute against a 14,3 standard, while this card read STATUS 8 · UNKNOWN. The
 * same line, on the same job, was back at 4 minutes later.
 *
 * Which is the more useful finding: 4 and 8 are not two states, they are one
 * machine running, and the number moves with the PACE — 8 while it was beating
 * standard, 4 while it was not. This board does not need that distinction; it
 * needs both to be green, and the pace has its own rail on the card.
 *
 * 5 and 6 stay ABSENT, and 6 is the one that matters: it has been seen twice and
 * the two point opposite ways — Filler Line 2 reading "Running" on 12/08, Filler
 * Line 5 acquiring a stop code two minutes later on 13/08. Writing either one
 * here would give a guess the same appearance as the lines above it, which now
 * carry evidence. It stays "STATUS 6 · UNKNOWN" until a pair is observed.
 *
 * AND THE THING THIS TABLE CANNOT DO, WHICH SOMEBODY SHOULD FIX ABOVE IT. Every
 * value arrives the same way: a number nobody has seen shows up grey, and stays
 * grey until a human standing between the two screens reports it. 8 had never
 * appeared in three days of looking. The honest generalisation is NOT "no code
 * means running" — that was the first wrong answer, and it is still wrong: on
 * 12/08 at 09:57 Filler Line 5 sat with no code for the fifteen minutes between
 * `Line Preparation` ending at 09:50 and `Brushing and Cleaning` starting at
 * 10:05, which `production_downtimes` confirms to the minute. What ends this
 * properly is a second witness — the vendor's own live count, so a rising
 * counter says running whatever the number is — or a log of (status, code) taken
 * every minute, which settles the whole legend in a day of ordinary production.
 * Until one of those exists, each value costs one report from the floor.
 */
export const ITOUCH_STATUS_MEANING = new Map<number, "RUNNING" | "STOPPED_NO_CODE">([
  [1, "RUNNING"],
  [2, "RUNNING"],
  [4, "RUNNING"],
  [8, "RUNNING"],
]);

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

  const meaning = ITOUCH_STATUS_MEANING.get(reading.status);

  if (meaning === "RUNNING") {
    // RUNNING is iTouching's own word, from the legend the floor already reads:
    // RUNNING / STOPPED-NO CODE / UNPLANNED STOP / PLANNED STOP. The board must
    // not invent a vocabulary beside it.
    return { state: "RUNNING", label: "RUNNING", ageSeconds, rawStatus: reading.status, uncatalogued: false, stoppedForSeconds: null };
  }

  if (meaning === "STOPPED_NO_CODE") {
    // Standing still, and iTouching has published no reason for it. The fourth
    // state in that legend. Nothing to time: with no code there is no
    // `stop_since_at` to time it from.
    return {
      state: "STOPPED_NO_CODE",
      label: "STOPPED · NO CODE",
      ageSeconds,
      rawStatus: reading.status,
      uncatalogued: false,
      stoppedForSeconds: null,
    };
  }

  // A number with no translation. Both answers this board could give here would be
  // assertions about a machine it cannot read, and one of them has already been
  // wrong on this exact value — so it gives neither, and shows the number instead.
  return {
    state: "UNKNOWN_STATUS",
    label: `STATUS ${reading.status} · UNKNOWN`,
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
  // The same grey as NO SIGNAL, and for the same reason: both say "this board
  // cannot tell you", and neither may borrow a colour that means something.
  UNKNOWN_STATUS: "bg-muted text-muted-foreground border-border",
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
