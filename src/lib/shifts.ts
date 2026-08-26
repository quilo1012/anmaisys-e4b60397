// Sound system fully removed. Only Web Notifications remain.
// Stub functions kept for backward compatibility with existing imports.

export type ShiftCode = "day" | "night";

function londonParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: Number(get("hour")),
  };
}

function londonDateString(date: Date) {
  const p = londonParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Day shift: 06:00–17:59 London time. Night shift: 18:00–05:59 London time. */
export function getShift(date: Date | string): ShiftCode {
  const d = typeof date === "string" ? new Date(date) : date;
  const h = londonParts(d).hour;
  return h >= 6 && h < 18 ? "day" : "night";
}

export function getCurrentFactoryShift(date = new Date()): { sessionDate: string; shiftCode: ShiftCode } {
  const h = londonParts(date).hour;
  if (h >= 6 && h < 18) return { sessionDate: londonDateString(date), shiftCode: "day" };
  if (h >= 18) return { sessionDate: londonDateString(date), shiftCode: "night" };
  const previous = new Date(date);
  previous.setUTCDate(previous.getUTCDate() - 1);
  return { sessionDate: londonDateString(previous), shiftCode: "night" };
}

/**
 * The day a record belongs to the factory, which is not always the day the clock
 * said when it was written.
 *
 * A night that starts on the 28th and ends at 06:00 on the 29th is the 28th's night
 * all the way through — the leader who worked it calls everything in it "the 28th",
 * and production sessions already store it that way in `session_date`. Anything
 * written between midnight and 06:00 therefore belongs to the day before.
 *
 * The shift is taken from the record rather than inferred from the hour, because the
 * two can disagree: rows imported in bulk carry a synthetic midday timestamp and a
 * real shift, and reading the hour would file a night under the day that never
 * worked it. Where they disagree the recorded shift wins and the calendar date
 * stands, which leaves imported history exactly where it was found.
 */
export function shiftSessionDate(recordedAt: string | Date, shift: string | null): string {
  const d = typeof recordedAt === "string" ? new Date(recordedAt) : recordedAt;
  const isNight = (shift ?? "").toUpperCase() === "NIGHT";
  if (isNight && londonParts(d).hour < 6) {
    const previous = new Date(d.getTime() - 24 * 60 * 60 * 1000);
    return londonDateString(previous);
  }
  return londonDateString(d);
}

/**
 * Whether a row that carries its own shift column belongs to the selected shift.
 *
 * For rows that RECORD a shift — a quality action, a production session — as opposed
 * to rows that only have a timestamp, where {@link getShift} is the right question.
 * The distinction is not academic: a night action written up at 07:00 answers DAY by
 * the clock and NIGHT by its column, and the column is the one a person filled in.
 *
 * Blank is neither shift, matching `actionsInPeriod`, which the leader scorecard has
 * always used. Counting a blank in both would make DAY plus NIGHT exceed the total,
 * and a screen whose halves outrun its whole is a screen nobody can reconcile.
 */
export function rowMatchesShift(
  rowShift: string | null | undefined,
  selected: "ALL" | "DAY" | "NIGHT",
): boolean {
  if (selected === "ALL") return true;
  return String(rowShift ?? "").trim().toUpperCase() === selected;
}

/**
 * The window of timestamps that can hold a session date in [from, to].
 *
 * A night filed under `to` is still being written at 05:59 the following morning, so
 * the fetch has to reach a day past the range and let {@link shiftSessionDate} throw
 * back what does not belong. Narrowing this to the range itself is what made a
 * leader's last night disappear from their own day.
 */
export function shiftDateFetchRange(from: string, to: string): { gte: string; lte: string } {
  const end = new Date(`${to}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  return { gte: `${from}T00:00:00.000Z`, lte: `${end.toISOString().slice(0, 10)}T06:59:59.999Z` };
}

/** How far Europe/London local is ahead of UTC (ms) at the given instant. */
function londonOffsetMs(atUtcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(atUtcMs));
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  let hh = g("hour"); if (hh === 24) hh = 0;
  const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), hh, g("minute"), g("second"));
  return asUtc - atUtcMs;
}

/** UTC instant for a Europe/London wall-clock time (offset resolved at the boundary). */
export function londonWallToUtc(y: number, mo: number, d: number, h: number): number {
  const naive = Date.UTC(y, mo - 1, d, h, 0, 0);
  return naive - londonOffsetMs(naive);
}

/**
 * How long a shift stays writable after it ends.
 *
 * Production is written up at the end of a run, not while the machine is filling, so
 * an operator who finishes at 17:55 is still typing at 18:05. Thirty minutes is the
 * whole reason {@link loggingShiftOptions} exists; anything that reads a deadline
 * must derive it from here rather than restate the number.
 */
export const SHIFT_GRACE_MINUTES = 30;

/**
 * When production logging closes for a shift: 18:30 for DAY, 06:30 the next
 * morning for NIGHT, Europe/London — {@link SHIFT_GRACE_MINUTES} after the shift ends.
 *
 * Mirrors session_write_deadline() in the database, which is the authority. This
 * exists so the UI can warn before the door shuts instead of letting an operator
 * discover it by having a save refused.
 */
export function shiftLoggingDeadline(sessionDate: string, shift: "DAY" | "NIGHT"): Date {
  const [y, mo, d] = sessionDate.split("-").map(Number);
  const at = (day: number, h: number) =>
    new Date(londonWallToUtc(y, mo, day, h) + SHIFT_GRACE_MINUTES * 60_000);
  return shift === "NIGHT" ? at(d + 1, 6) : at(d, 18);
}

/** A shift as the production tables file it: the day it belongs to, and which half. */
export interface LoggableShift {
  sessionDate: string;
  shiftCode: ShiftCode;
}

/**
 * The shifts an operator may write to right now.
 *
 * {@link getCurrentFactoryShift} answers "what is running", and flips at 18:00 on the
 * dot — which is right for the header, the line displays and the andon board, and
 * wrong for the screen someone is typing into. Between 18:00 and 18:30 both answers
 * are true at once: the day crew is writing up the run that just ended while the night
 * crew is already logging in. Until now the logging screen asked the first question and
 * got the wrong shift, so a quantity typed at 18:05 was silently filed under the night.
 *
 * So this returns both, and the caller asks the operator which one they mean. Outside
 * the window `outgoing` is null and there is nothing to ask.
 *
 * The window closes exactly when {@link shiftLoggingDeadline} does. Offering a shift
 * the database would refuse is how the Line 4 night operator met this problem the
 * first time — seven refusals in five minutes, and a shift's output never recorded.
 */
export function loggingShiftOptions(now: Date = new Date()): {
  incoming: LoggableShift;
  outgoing: LoggableShift | null;
  graceEndsAt: Date | null;
} {
  const incoming = getCurrentFactoryShift(now);
  const startedAt = getCurrentShiftStart(now);
  const graceEndsAt = new Date(startedAt.getTime() + SHIFT_GRACE_MINUTES * 60_000);

  if (now.getTime() >= graceEndsAt.getTime()) return { incoming, outgoing: null, graceEndsAt: null };

  // The shift before this one. A night is filed under the evening it began, so the day
  // that hands over to it shares its date; the night that hands over to a day does not.
  const [y, mo, d] = incoming.sessionDate.split("-").map(Number);
  const outgoing: LoggableShift = incoming.shiftCode === "night"
    ? { sessionDate: incoming.sessionDate, shiftCode: "day" }
    : { sessionDate: new Date(Date.UTC(y, mo - 1, d - 1)).toISOString().slice(0, 10), shiftCode: "night" };

  return { incoming, outgoing, graceEndsAt };
}

/**
 * Start instant of the current factory shift (Day 06:00, Night 18:00 Europe/London).
 * Built from the actual boundary instant so it stays correct across the BST/GMT
 * DST switches (the old version assumed 1 wall-clock hour == 3600 real seconds).
 */
export function getCurrentShiftStart(now: Date = new Date()): Date {
  const { sessionDate, shiftCode } = getCurrentFactoryShift(now);
  const [y, mo, d] = sessionDate.split("-").map(Number);
  return new Date(londonWallToUtc(y, mo, d, shiftCode === "day" ? 6 : 18));
}

/** End instant of the current factory shift (Day 18:00, Night 06:00 next day, Europe/London). */
export function getCurrentShiftEnd(now: Date = new Date()): Date {
  const { sessionDate, shiftCode } = getCurrentFactoryShift(now);
  const [y, mo, d] = sessionDate.split("-").map(Number);
  if (shiftCode === "day") return new Date(londonWallToUtc(y, mo, d, 18));
  const next = new Date(Date.UTC(y, mo - 1, d + 1));
  return new Date(londonWallToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 6));
}

/**
 * A time on the factory's clock, "HH:mm".
 *
 * The deadline is a London wall-clock time, and a tablet set to another zone would
 * otherwise print an hour that nobody on the floor can act on. Every screen that shows
 * an operator when their window shuts reads it from here rather than hard-coding the
 * digits, so moving the deadline moves the message with it.
 */
export function londonHM(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d);
}

export const SHIFT_LABEL: Record<ShiftCode, string> = {
  day: "Day Shift (06:00–18:00)",
  night: "Night Shift (18:00–06:00)",
};


export function warmUpAudio() { /* no-op */ }
export function playAlertSound() { /* no-op */ }
export function stopAlertSound() { /* no-op */ }
export function playNotificationChime() { /* no-op */ }

export async function requestNotificationPermission() {
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted" || Notification.permission === "denied") return;
  try {
    await Notification.requestPermission();
  } catch (e) {
    console.warn("[Notify] Permission request failed", e);
  }
}

export function sendWebNotification(title: string, body: string) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, icon: "/favicon.ico" });
  } catch (e) {
    console.warn("[Notify] Failed to send notification", e);
  }
}
