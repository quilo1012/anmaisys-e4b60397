/**
 * The next overtime shift a person is booked on, and how long until it starts.
 *
 * Asked for on 30/10/2026: a booked overtime should sit on My Overtime as a proper
 * reminder — the day, the hours, the line, and the time left before it starts — rather
 * than one card among the asks. Pure functions; the page passes `now`, which it already
 * moves on every thirty seconds.
 *
 * Times are the device's own clock, the same clock `askHasStarted` reads, so the
 * countdown reaches zero at the moment the ask stops taking answers.
 */
import { windowMinutes } from "@/lib/overtimeShifts";

/** One booked shift: an ask the person is confirmed on, or a Headcount placement. */
export interface BookedShift {
  key: string;
  /** yyyy-mm-dd, the day the shift starts. */
  date: string;
  /** HH:MM[:SS] */
  startsAt: string;
  endsAt: string;
  /** The board it lands on: "Day" / "Night". */
  shift: string;
  /** The column on the board, when somebody placed them; null when not yet. */
  area?: string | null;
  /** Where the booking came from, for the line under the card. */
  source: "ask" | "headcount";
}

export interface NextShift extends BookedShift {
  start: Date;
  end: Date;
  /** Started and not yet ended. */
  onNow: boolean;
}

export function shiftDates(b: Pick<BookedShift, "date" | "startsAt" | "endsAt">): { start: Date; end: Date } {
  const start = new Date(`${b.date}T${b.startsAt.slice(0, 5)}:00`);
  return { start, end: new Date(start.getTime() + windowMinutes(b.startsAt, b.endsAt) * 60_000) };
}

/**
 * The shift on now, or else the next to start, and how many more are booked after it.
 * Ended shifts are gone. Two bookings for the same start (an ask and its own board row
 * would be one, but two asks can overlap) count once, by the earliest end.
 */
export function nextBookedShift(items: BookedShift[], now: Date): { next: NextShift | null; more: number } {
  const live = items
    .map((b) => ({ ...b, ...shiftDates(b) }))
    .filter((b) => b.end.getTime() > now.getTime())
    .sort((a, b) => a.start.getTime() - b.start.getTime() || a.end.getTime() - b.end.getTime());
  const seen = new Set<string>();
  const unique = live.filter((b) => {
    const k = `${b.start.getTime()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (unique.length === 0) return { next: null, more: 0 };
  const first = unique[0];
  return { next: { ...first, onNow: first.start.getTime() <= now.getTime() }, more: unique.length - 1 };
}

/** The time left, in the words a phone has room for: "2 d 5 h", "7 h 42 min", "42 min". */
export function countdownLabel(ms: number): string {
  if (ms < 60_000) return "less than a minute";
  const totalMin = Math.floor(ms / 60_000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return h > 0 ? `${d} d ${h} h` : `${d} d`;
  if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`;
  return `${m} min`;
}

/** "Today", "Tomorrow", or the weekday and date, for "Starts tomorrow at 06:00". */
export function dayWord(date: string, now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const iso = (d: Date) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (date === iso(now)) return "today";
  if (date === iso(tomorrow)) return "tomorrow";
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" });
}
