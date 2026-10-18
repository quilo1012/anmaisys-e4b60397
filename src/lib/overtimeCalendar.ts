/**
 * The overtime asks laid out on a calendar — month, week and day.
 *
 * Pure functions only, like `overtimeShifts`. The calendar reads the same rows the
 * list reads and adds two things the list never needed: where on a grid of days an
 * ask falls, and a status that knows about the clock. An ask the database still calls
 * `open` is "In progress" while its hours are running and "Completed" once they are
 * over — the list leaves that to the date; a month grid has to say it.
 *
 * There is no "Draft": `overtime_requests` has no such status, and an ask is
 * published the moment it is saved. Nothing here pretends otherwise.
 */
import { countResponses, type OvertimeRequest, type OvertimeResponse } from "@/lib/overtimeRequests";

export type CalendarView = "month" | "week" | "day";

export type CalendarStatus =
  | "needs" | "partial" | "full" | "in_progress" | "completed" | "closed" | "cancelled";

export const CALENDAR_STATUS_LABEL: Record<CalendarStatus, string> = {
  needs: "Needs staffing",
  partial: "Partially filled",
  full: "Fully booked",
  in_progress: "In progress",
  completed: "Completed",
  closed: "Closed",
  cancelled: "Cancelled",
};

/** The StatusBadge variant for each — one restrained colour, always beside the label. */
export const CALENDAR_STATUS_BADGE: Record<CalendarStatus, string> = {
  needs: "warning",
  partial: "warning",
  full: "success",
  in_progress: "info",
  completed: "default",
  closed: "default",
  cancelled: "cancelled",
};

/** The ask's start and end as local instants. An end at or before the start is the next day. */
export function askWindow(r: Pick<OvertimeRequest, "on_date" | "starts_at" | "ends_at">): { start: Date; end: Date } {
  const [y, m, d] = r.on_date.split("-").map(Number);
  const hm = (t: string) => [Number(t.slice(0, 2)), Number(t.slice(3, 5))] as const;
  const [sh, sm] = hm(r.starts_at);
  const [eh, em] = hm(r.ends_at);
  const start = new Date(y, m - 1, d, sh, sm);
  const end = new Date(y, m - 1, d, eh, em);
  if (end <= start) end.setDate(end.getDate() + 1);
  return { start, end };
}

/**
 * Where an ask stands, by the database's status, its answers and the clock.
 *
 * Cancelled wins over everything. Then time: an ask whose hours have passed is
 * completed whether or not anybody closed it, and one whose hours are running is in
 * progress. Only an ask still ahead is read by how full it is.
 */
export function calendarStatus(
  request: Pick<OvertimeRequest, "on_date" | "starts_at" | "ends_at" | "status" | "headcount">,
  responses: Pick<OvertimeResponse, "answer" | "decision">[],
  now: Date = new Date(),
): CalendarStatus {
  if (request.status === "cancelled") return "cancelled";
  const { start, end } = askWindow(request);
  if (now >= end) return "completed";
  if (now >= start) return "in_progress";
  if (request.status === "closed") return "closed";
  const c = countResponses(request, responses);
  if (c.short === 0) return "full";
  return c.accepted > 0 ? "partial" : "needs";
}

/* ------------------------------------------------------------------ dates */

export const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const parse = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};

export function addDaysIso(iso: string, n: number): string {
  const d = parse(iso);
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

/** The Monday on or before the date. The factory's week starts on Monday. */
export function mondayOf(iso: string): string {
  const d = parse(iso);
  const back = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - back);
  return isoDate(d);
}

export interface GridDay {
  iso: string;
  day: number;
  /** False for the leading and trailing days of the neighbouring months. */
  inMonth: boolean;
}

/** Whole weeks, Monday first, covering the anchor's month — five or six rows. */
export function monthGrid(anchor: string): GridDay[][] {
  const a = parse(anchor);
  const first = isoDate(new Date(a.getFullYear(), a.getMonth(), 1));
  const last = isoDate(new Date(a.getFullYear(), a.getMonth() + 1, 0));
  const weeks: GridDay[][] = [];
  let cursor = mondayOf(first);
  while (cursor <= last) {
    const week: GridDay[] = [];
    for (let i = 0; i < 7; i++) {
      const d = parse(cursor);
      week.push({ iso: cursor, day: d.getDate(), inMonth: d.getMonth() === a.getMonth() });
      cursor = addDaysIso(cursor, 1);
    }
    weeks.push(week);
  }
  return weeks;
}

export function weekDays(anchor: string): string[] {
  const mon = mondayOf(anchor);
  return Array.from({ length: 7 }, (_, i) => addDaysIso(mon, i));
}

/** The first and last date the view shows — what the query has to fetch. */
export function viewRange(view: CalendarView, anchor: string): { from: string; to: string } {
  if (view === "day") return { from: anchor, to: anchor };
  if (view === "week") {
    const mon = mondayOf(anchor);
    return { from: mon, to: addDaysIso(mon, 6) };
  }
  const grid = monthGrid(anchor);
  return { from: grid[0][0].iso, to: grid[grid.length - 1][6].iso };
}

/** Previous / next: a month, a week or a day, kept on the same day-of-month where it exists. */
export function stepAnchor(view: CalendarView, anchor: string, dir: 1 | -1): string {
  if (view === "day") return addDaysIso(anchor, dir);
  if (view === "week") return addDaysIso(anchor, 7 * dir);
  const a = parse(anchor);
  const target = new Date(a.getFullYear(), a.getMonth() + dir, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(a.getDate(), lastDay));
  return isoDate(target);
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];
const SHORT_MONTHS = MONTHS.map((m) => m.slice(0, 3));
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "October 2026", "12–18 Oct 2026", "Tuesday 13 Oct 2026". */
export function viewTitle(view: CalendarView, anchor: string): string {
  const a = parse(anchor);
  if (view === "month") return `${MONTHS[a.getMonth()]} ${a.getFullYear()}`;
  if (view === "day") return `${WEEKDAY_NAMES[a.getDay()]} ${a.getDate()} ${SHORT_MONTHS[a.getMonth()]} ${a.getFullYear()}`;
  const days = weekDays(anchor).map(parse);
  const [s, e] = [days[0], days[6]];
  return s.getMonth() === e.getMonth()
    ? `${s.getDate()}–${e.getDate()} ${SHORT_MONTHS[e.getMonth()]} ${e.getFullYear()}`
    : `${s.getDate()} ${SHORT_MONTHS[s.getMonth()]} – ${e.getDate()} ${SHORT_MONTHS[e.getMonth()]} ${e.getFullYear()}`;
}

/* ------------------------------------------------------------- bulk asks */

export interface AskDraft {
  on_date: string;
  starts_at: string;
  ends_at: string;
  department: string | null;
}

/**
 * An ask already there for the same date, hours and department — the duplicate a
 * repeated publication would make. Cancelled asks do not count: re-asking after a
 * cancellation is the normal way to fix one.
 */
export function duplicateOf(
  draft: AskDraft,
  existing: Pick<OvertimeRequest, "id" | "on_date" | "starts_at" | "ends_at" | "department" | "status">[],
): string | null {
  const hm = (t: string) => t.slice(0, 5);
  const hit = existing.find((r) =>
    r.status !== "cancelled"
    && r.on_date === draft.on_date
    && hm(r.starts_at) === hm(draft.starts_at)
    && hm(r.ends_at) === hm(draft.ends_at)
    && (r.department ?? null) === (draft.department ?? null));
  return hit?.id ?? null;
}
