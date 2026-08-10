/**
 * Who closed a stoppage — a person, or a clock?
 *
 * A downtime row carries two very different kinds of end time. One is a human
 * pressing Resume when the line ran again. The other is the shift-close job
 * stamping 06:00 or 18:00 on every order still open, or iTouching going quiet
 * about a fault. The second kind measures when the record was tidied up, not
 * when the line came back, and the week of 03/08/2026 was 92% of the second kind:
 * 42h03m of 45h49m. The arithmetic on top of it was never wrong; it was answering
 * a question nobody had asked.
 *
 * These figures still belong on screen — they are the best evidence available
 * that a line was down. They just must not be handed to Auto Insights as if a
 * stopwatch had been run.
 */

import { formatMinutes } from "@/lib/formatDuration";

/** The shift boundaries, in Europe/London wall-clock hours. */
const SHIFT_BOUNDARY_HOURS = [6, 18];

/** How far past a boundary the closing job's `now()` may land and still count. */
const BOUNDARY_TOLERANCE_MS = 1_000;

/** The integration that reports faults but never reports repairs. */
const SILENT_REPORTER = "itouching";

export interface ClosableStop {
  /** Where the row came from. Manual rows carry a typed end time, not a Resume press. */
  source?: "manual" | "wo_event";
  /** When the stop ended; null or absent while it is still open. */
  ended_at?: string | Date | null;
  /** The user id that pressed Resume, if any. */
  resumed_by?: string | null;
  /** The display name recorded alongside it. */
  resumed_by_name?: string | null;
  /** The resume note — where the closing job leaves its marker. */
  notes?: string | null;
}

function londonHourMinuteSecond(at: Date): { hour: number; minute: number; second: number } {
  const dtf = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p = Object.fromEntries(
    dtf.formatToParts(at).filter((x) => x.type !== "literal").map((x) => [x.type, x.value]),
  ) as Record<string, string>;
  return { hour: +p.hour === 24 ? 0 : +p.hour, minute: +p.minute, second: +p.second };
}

/** True when the end time sits on a shift boundary, give or take the job's own latency. */
function landsOnShiftBoundary(at: Date): boolean {
  const { hour, minute, second } = londonHourMinuteSecond(at);
  if (!SHIFT_BOUNDARY_HOURS.includes(hour) || minute !== 0) return false;
  const msPastBoundary = second * 1000 + (at.getTime() % 1000);
  return msPastBoundary < BOUNDARY_TOLERANCE_MS;
}

/**
 * True when the stop's end time was written by the system rather than by a person
 * who watched the line start again.
 */
export function isSystemClosed(stop: ClosableStop): boolean {
  if (!stop.ended_at) return false; // still open — nobody has closed it either way

  if (/auto-closed/i.test(stop.notes ?? "")) return true;
  if ((stop.resumed_by_name ?? "").trim().toLowerCase() === SILENT_REPORTER) return true;

  // Orders closed before the job left a note: no resumer, and an end time landing
  // exactly on a shift boundary is not a coincidence a human produces. Only for
  // rows born of a Resume press — on a hand-entered record, 06:00 is just a round
  // number someone typed.
  if (stop.resumed_by || stop.source === "manual") return false;
  const at = new Date(stop.ended_at);
  return Number.isFinite(at.getTime()) && landsOnShiftBoundary(at);
}

/* ────────────────────────── Auto Insights ────────────────────────── */

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** A Pattern Matrix cell, with the share of it nobody actually resumed. */
export interface PatternCell {
  /** `${dayIndex}-${shift}`, day 0 = Monday. */
  key: string;
  minutes: number;
  systemMinutes: number;
}

export interface PatternInsight {
  line: string;
  text: string;
  /** False when the dominant cell is mostly system-closed time. */
  verified: boolean;
}

/** A line needs at least this much downtime before a pattern means anything. */
const MIN_TOTAL_MINUTES = 60;

/** …and one cell must hold at least this share of it. */
const CONCENTRATION = 0.35;

/** Above this share of unresumed time, the cell is not a measurement. */
const UNVERIFIED_SHARE = 0.5;

/**
 * True when most of a cell's minutes are time nobody resumed — the figure is
 * evidence the line was down, not a measurement of how long. The matrix marks
 * these, and buildPatternInsight refuses to build a PM window on one.
 */
export function isMostlyUnresumed(cell: { minutes: number; systemMinutes: number } | undefined | null): boolean {
  if (!cell || cell.minutes <= 0) return false;
  return cell.systemMinutes / cell.minutes > UNVERIFIED_SHARE;
}

/** The window before a shift, where preventive work fits. */
function pmWindow(dayIndex: number, shift: string): string {
  // A Day shift's PM goes on the night before it; a Night shift's on the day that
  // precedes it the same evening — Wednesday night is preceded by Wednesday day,
  // not by Tuesday.
  if (shift === "Night") return `${DAY_NAMES[dayIndex]} day`;
  return `${DAY_NAMES[(dayIndex + 6) % 7]} night`;
}

/**
 * The one insight a line's week supports, or null when it supports none.
 */
export function buildPatternInsight(
  line: string,
  totalMinutes: number,
  cells: PatternCell[],
): PatternInsight | null {
  if (totalMinutes < MIN_TOTAL_MINUTES) return null;

  let worst: PatternCell | null = null;
  for (const c of cells) {
    if (!worst || c.minutes > worst.minutes) worst = c;
  }
  if (!worst || worst.minutes / totalMinutes < CONCENTRATION) return null;

  const [dayPart, shift] = worst.key.split("-");
  const dayIndex = Number(dayPart);
  const dayName = DAY_NAMES[dayIndex];
  const share = Math.round((worst.minutes / totalMinutes) * 100);
  const duration = formatMinutes(worst.minutes);

  const systemShare = worst.minutes > 0 ? worst.systemMinutes / worst.minutes : 0;
  if (isMostlyUnresumed(worst)) {
    return {
      line,
      verified: false,
      text:
        `${dayName} ${shift} shift holds ${share}% of ${line}'s downtime (${duration}), but ` +
        `${Math.round(systemShare * 100)}% of it was auto-closed at a shift boundary rather than ` +
        `resumed by anyone. Confirm the real restart times before treating this as a PM window.`,
    };
  }

  return {
    line,
    verified: true,
    text:
      `${dayName} ${shift} shift concentrates ${share}% of ${line}'s downtime (${duration}). ` +
      `Consider scheduling PM on ${pmWindow(dayIndex, shift)}.`,
  };
}
