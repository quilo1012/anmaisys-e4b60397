/**
 * My Attendance — one person's own days, read from the records that already exist.
 *
 * Nothing here is a new calculation. Days present and days away are `countDaysAway`
 * (the finance close's own count, clock first), overtime and hours short are
 * `buildClose` (the finance close's own settlement), the holiday balance is
 * `leaveBalance` (the Leave screen's), shifts due are `expectedShifts`. So the figure
 * a person sees for themselves is, by construction, the figure the office sees for them.
 *
 * What IS new is the day-by-day calendar, and it is held to one rule above all: a day
 * is only "absent" when a record says so. A rostered day with nothing on file is "no
 * record yet" — TimeMoto is imported by hand, the board is filled in by hand, and the
 * absence of a row is far more often an import that has not happened than a person
 * who did not turn up.
 */

import { absenceKind, splitAbsences } from "@/lib/absenceKind";
import { buildClose, countDaysAway, round2 } from "@/lib/financeClose";
import { eachDate, leaveBalance, type LeaveBalance } from "@/lib/leaveDays";
import { expectedShifts } from "@/lib/shiftBalance";
import { overtimeBoardFor } from "@/lib/overtimeRequests";
import { boardSlotOf } from "@/lib/boardOvertime";
import { windowMinutes } from "@/lib/overtimeShifts";

/* ---------------------------------------------------------------- the payload ---- */

export interface MyClockRow {
  on_date: string;
  start_time: string | null;
  end_time: string | null;
  worked_minutes: number | null;
  balance_minutes: number | null;
  scheduled_minutes: number | null;
  overtime_adj_minutes: number | null;
  absence_name: string | null;
}
export interface MyMark { on_date: string; status: string }
export interface MyBoardRow {
  on_date: string; shift: string; status: string; half_day: boolean | null;
  /**
   * The board column, by the name the board heads it with; null when the row has no
   * column. ABSENT (undefined) from a `my_attendance` older than 20261012200000 —
   * which is not the same as null, and the screen must not say "not yet assigned"
   * about a row whose column it simply was not told.
   */
  area?: string | null;
  area_kind?: string | null;
  is_leader?: boolean | null;
}
/** An overtime shift a supervisor accepted this person for: the ask's own hours. */
export interface MyOvertimeShift { on_date: string; starts_at: string; ends_at: string }
export interface MyLeaveRequest {
  kind: string; start_date: string; end_date: string; status: string; working_days: number | null;
}
export interface MyPeriod { id: string; name: string; start_date: string; end_date: string }

/** What `my_attendance(p_from, p_to)` returns. Null when the login is not linked yet. */
export interface MyAttendanceData {
  me: {
    id: string; full_name: string; employee_ref: string | null; department: string | null;
    position: string | null; shift_group: string | null; started_on: string | null;
  };
  pattern: {
    name: string; days: number[]; starts_at: string | null; ends_at: string | null;
    break_minutes: number; annual_leave_days: number | null;
  } | null;
  clocks: MyClockRow[];
  /** The last day the clock record reaches for this person, over all time. */
  clocked_to: string | null;
  clocks_imported_at: string | null;
  marks: MyMark[];
  /** Every holiday mark across the surrounding leave years, for the balance. */
  holiday_marks: string[];
  board: MyBoardRow[];
  /** Missing before 20261012200000. */
  overtime?: MyOvertimeShift[];
  requests: MyLeaveRequest[];
  payroll: { period_id: string; hours: number }[];
  periods: MyPeriod[];
}

/* ------------------------------------------------------------------ the days ---- */

export type DayStatus =
  | "present" | "holiday" | "sick" | "unpaid" | "absent" | "other"
  | "rest" | "scheduled" | "no_record";

export interface MyDay {
  date: string;
  status: DayStatus;
  /** What the record called it, for `other` and for absences: "Training", "Jury service". */
  label: string | null;
  /** The rota expects this person in on this weekday. */
  due: boolean;
  /** A present day with time over the contracted day. A mark ON the day, never a second day. */
  overtime: boolean;
  /** Clocked in and out on a day booked as leave — the hours count, the day stays leave. */
  workedOnLeave: boolean;
  /** A leave request covering the day is waiting for a decision. */
  pending: boolean;
  /** What the board planned, when it planned something other than what the record says. */
  boardSays: string | null;
  /** Where the status came from. */
  source: "clock" | "mark" | "rota" | null;
  clock: MyClockRow | null;
  mark: MyMark | null;
  board: MyBoardRow | null;
  requests: MyLeaveRequest[];
}

/** ISO weekday 1–7 from Monday, from the date itself — the same as `expectedShifts`. */
function isoWeekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
}

function kindStatus(name: string): DayStatus {
  const k = absenceKind(name);
  return k === "other" ? "other" : k;
}

/** A hand mark on `employee_attendance`, as a day status. */
function markStatus(status: string): DayStatus {
  if (status === "present") return "present";
  if (status === "absent" || status === "awol") return "absent";
  return kindStatus(status);
}

/** What a board row says the person would be doing. */
function boardStatus(status: string): DayStatus {
  if (status === "assigned" || status === "overtime") return "present";
  if (status === "training") return "other";
  return kindStatus(status);
}

const BOARD_WORDS: Record<string, string> = {
  assigned: "Working", overtime: "Overtime", holiday: "Holiday", sick: "Sick",
  unpaid: "Unpaid leave", training: "Training",
};

/** Statuses that come from a record, and so can be compared with the board's plan. */
const RECORDED: ReadonlySet<DayStatus> = new Set(["present", "holiday", "sick", "unpaid", "absent", "other"]);

export function buildMyDays(data: MyAttendanceData, from: string, to: string, today: string): MyDay[] {
  const clockOf = new Map(data.clocks.map((c) => [c.on_date, c]));
  const markOf = new Map(data.marks.map((m) => [m.on_date, m]));
  const boardOf = new Map(data.board.map((b) => [b.on_date, b]));
  const days = new Set(data.pattern?.days ?? []);

  return eachDate(from, to).map((date): MyDay => {
    const clock = clockOf.get(date) ?? null;
    const mark = markOf.get(date) ?? null;
    const board = boardOf.get(date) ?? null;
    const requests = data.requests.filter((r) => r.start_date <= date && r.end_date >= date);
    const due = days.has(isoWeekday(date));
    const base = {
      date, due, clock, mark, board, requests,
      pending: requests.some((r) => r.status === "pending"),
      // OT means an overtime shift on record — the board's `overtime` row, which an
      // accepted ask writes (20261012190000) or a planner places by hand. Never the
      // clock: a day with minutes over schedule is not overtime (the period settles
      // that, deficit first), and calling it "OT" put the label on ordinary rota days.
      overtime: board?.status === "overtime", workedOnLeave: false, label: null as string | null,
    };

    let status: DayStatus;
    let source: MyDay["source"];
    // The order is `countDaysAway`'s: the clock answers for a day it recorded, the hand
    // mark for a day it did not. A calendar that ranked them differently would show a
    // day as present that the finance close counts as holiday.
    if (clock) {
      source = "clock";
      const worked = clock.worked_minutes ?? 0;
      if (clock.absence_name) {
        status = kindStatus(clock.absence_name);
        base.label = clock.absence_name;
        base.workedOnLeave = worked > 0;
      } else if (worked > 0) {
        status = "present";
      } else if ((clock.scheduled_minutes ?? 0) > 0) {
        // TimeMoto itself expected a day and recorded none worked: that is a record of
        // absence, not a missing one.
        status = "absent";
      } else {
        status = due ? "no_record" : "rest";
      }
    } else if (mark) {
      source = "mark";
      status = markStatus(mark.status);
      if (status === "other" || status === "absent") base.label = mark.status;
    } else {
      // A board row for a day not yet worked is a plan too: an accepted overtime shift
      // on a rest day is somewhere the person is due, not a day off.
      const planned = due || board?.status === "assigned" || board?.status === "overtime";
      source = planned || date > today ? "rota" : null;
      if (date > today || date === today) status = planned ? "scheduled" : "rest";
      else status = due ? "no_record" : "rest";
    }

    // The board is the plan and the clock is the record; neither corrects the other
    // (AGENTS.md). Where they disagree the person sees both. Only a recorded day can
    // disagree — a day with no record yet has nothing to be compared against.
    let boardSays: string | null = null;
    if (board && RECORDED.has(status) && boardStatus(board.status) !== status) {
      boardSays = BOARD_WORDS[board.status] ?? board.status;
    }

    return { ...base, status, source, boardSays };
  });
}

/* --------------------------------------------------------------- the summary ---- */

export interface MySummary {
  /** Hours on the clock, worked. Recorded, not approved. */
  workedHours: number;
  /** Hours TimeMoto expected on the days it recorded — each person's own schedule. */
  scheduledHours: number;
  /** Shifts the rota calls for in the range. Null when no rota is on file. */
  shiftsDue: number | null;
  daysPresent: number;
  holidayDays: number;
  sickDays: number;
  unpaidDays: number;
  /** Absences that are none of the three, under the source's own names. */
  otherAbsenceDays: number;
  /** Rostered days that have no record at all yet. Not absences. */
  noRecordDays: number;
  /** Signed hours over the range: worked less contracted. Not overtime. */
  balanceHours: number | null;
  /**
   * The settlement, from `buildClose` — present only when the range is exactly one
   * pay period, because only a whole period settles.
   *
   * `overtimeHours` and `owedHours` include `attendedHours`: shifts the supervisor marked
   * attended on days the clock has no hours for yet (`summariseOvertimeShifts`). They go
   * into the period's balance, so a shortfall elsewhere still nets against them.
   * `clockOvertimeHours` is the clock alone — what the office's finance close shows.
   */
  settled: {
    period: MyPeriod;
    overtimeHours: number | null;
    owedHours: number | null;
    clockOvertimeHours: number | null;
    attendedHours: number;
  } | null;
  /** Hours payroll has recorded for that period. The figure that is paid. */
  payrollHours: number | null;
  leave: LeaveBalance;
}

export function periodMatching(periods: MyPeriod[], from: string, to: string): MyPeriod | null {
  return periods.find((p) => p.start_date === from && p.end_date === to) ?? null;
}

export function summarise(
  data: MyAttendanceData, days: MyDay[], from: string, to: string, today: string,
  /** Attended overtime on days the clock has no hours for (`notOnClockMinutes`). */
  attendedNotOnClockMin = 0,
): MySummary {
  const id = data.me.id;
  const counted = countDaysAway(
    data.clocks.map((c) => ({ employee_id: id, on_date: c.on_date, worked_minutes: c.worked_minutes, absence_name: c.absence_name })),
    data.marks.map((m) => ({ employee_id: id, on_date: m.on_date, status: m.status })),
  ).get(id) ?? { daysPresent: 0, absences: {} };
  const split = splitAbsences(counted.absences);

  const minutes = (pick: (c: MyClockRow) => number | null) =>
    data.clocks.reduce((s, c) => s + (pick(c) ?? 0), 0);
  const balanceMin = data.clocks.some((c) => c.balance_minutes != null)
    ? minutes((c) => c.balance_minutes) : null;

  const period = periodMatching(data.periods, from, to);
  let settled: MySummary["settled"] = null;
  let payrollHours: number | null = null;
  if (period) {
    const mine = data.payroll.filter((p) => p.period_id === period.id);
    payrollHours = mine.length ? round2(mine.reduce((s, p) => s + Number(p.hours), 0)) : null;
    const close = (clockedBalanceMin: number | null) => buildClose([{
      employeeId: id, name: data.me.full_name, department: data.me.department, shift: null,
      openingBalanceMin: null, clockedBalanceMin, payrollOtHours: payrollHours,
      absences: counted.absences, daysPresent: counted.daysPresent, partDayHours: 0,
      patternName: data.pattern?.name ?? null, patternDays: data.pattern?.days ?? null,
      shiftsWorked: 0, shiftsHoliday: 0, plannedDates: null,
    }], from, to)[0];
    const clockOnly = close(balanceMin);
    const added = Math.max(0, attendedNotOnClockMin);
    const row = added > 0 ? close((balanceMin ?? 0) + added) : clockOnly;
    settled = {
      period, overtimeHours: row.overtimeHours, owedHours: row.owedHours,
      clockOvertimeHours: clockOnly.overtimeHours, attendedHours: round2(added / 60),
    };
  }

  return {
    workedHours: round2(minutes((c) => c.worked_minutes) / 60),
    scheduledHours: round2(minutes((c) => c.scheduled_minutes) / 60),
    shiftsDue: expectedShifts(data.pattern?.days ?? null, from, to),
    daysPresent: counted.daysPresent,
    holidayDays: split.holiday,
    sickDays: split.sick,
    unpaidDays: split.unpaid,
    otherAbsenceDays: split.other,
    noRecordDays: days.filter((d) => d.status === "no_record").length,
    balanceHours: balanceMin == null ? null : round2(balanceMin / 60),
    settled,
    payrollHours,
    leave: leaveBalance(data.holiday_marks.map((date) => ({ date })), data.pattern?.annual_leave_days ?? null, today),
  };
}

/* ------------------------------------------------------------------- ranges ---- */

export interface RangeChoice { key: string; label: string; from: string; to: string }

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};

/**
 * The ranges the selector offers. Pay periods first — they are the unit that settles —
 * then calendar weeks and months, which show a running balance and never an overtime.
 */
export function rangeChoices(periods: MyPeriod[], today: string): RangeChoice[] {
  const out: RangeChoice[] = [];
  const past = periods.filter((p) => p.start_date <= today).slice(-6).reverse();
  for (const p of past) {
    const current = p.start_date <= today && p.end_date >= today;
    out.push({ key: `period:${p.id}`, label: current ? `${p.name} (This Pay Period)` : p.name, from: p.start_date, to: p.end_date });
  }
  const monday = addDays(today, 1 - isoWeekday(today));
  out.push({ key: "week:this", label: "This week", from: monday, to: addDays(monday, 6) });
  out.push({ key: "week:last", label: "Last week", from: addDays(monday, -7), to: addDays(monday, -1) });
  const first = `${today.slice(0, 7)}-01`;
  const nextFirst = (() => { const d = new Date(`${first}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1); return iso(d); })();
  const prevFirst = (() => { const d = new Date(`${first}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return iso(d); })();
  out.push({ key: "month:this", label: "This month", from: first, to: addDays(nextFirst, -1) });
  out.push({ key: "month:last", label: "Last month", from: prevFirst, to: addDays(first, -1) });
  return out;
}

/**
 * The pay period a range sits in, and its neighbours, for the title above the calendar.
 *
 * `index` is the period whose dates the range is exactly, or else the one holding its first
 * day; null when no period does (a custom range before the first period, say). `prev` and
 * `next` are the periods either side, null at the ends of the list — the list itself is the
 * payroll calendar as configured, never extended or guessed here.
 */
export function periodAround(
  periods: MyPeriod[],
  range: { from: string; to: string },
  today: string,
): { period: MyPeriod | null; exact: boolean; current: boolean; prev: MyPeriod | null; next: MyPeriod | null } {
  const sorted = [...periods].sort((a, b) => a.start_date.localeCompare(b.start_date));
  let i = sorted.findIndex((p) => p.start_date === range.from && p.end_date === range.to);
  const exact = i >= 0;
  if (!exact) i = sorted.findIndex((p) => p.start_date <= range.from && p.end_date >= range.from);
  const period = i >= 0 ? sorted[i] : null;
  // Off every period: step to whichever period starts after / ended before the range.
  const prev = i >= 0 ? sorted[i - 1] ?? null : [...sorted].reverse().find((p) => p.end_date < range.from) ?? null;
  const next = i >= 0 ? sorted[i + 1] ?? null : sorted.find((p) => p.start_date > range.from) ?? null;
  return {
    period,
    exact,
    current: !!period && period.start_date <= today && period.end_date >= today,
    prev: exact || i < 0 ? prev : period,
    next,
  };
}

/** The range the page opens on: the pay period running today, else this month. */
export function defaultRange(periods: MyPeriod[], today: string): { from: string; to: string } {
  const current = periods.find((p) => p.start_date <= today && p.end_date >= today);
  if (current) return { from: current.start_date, to: current.end_date };
  const first = `${today.slice(0, 7)}-01`;
  const d = new Date(`${first}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return { from: first, to: addDays(iso(d), -1) };
}

/* ------------------------------------------------------------ where I'm working ---- */

export interface MyShift {
  date: string;
  /** The board the day is on: "Day" / "Night". */
  shift: string;
  /** "06:00–18:00", or null when neither the rota nor the ask says. */
  hours: string | null;
  kind: "scheduled" | "overtime" | "training" | "holiday" | "sick" | "unpaid" | "other";
  /**
   * The column on the board. `null` = nobody has placed this person yet; `undefined`
   * = the database did not say (a `my_attendance` from before 20261012200000).
   */
  area: string | null | undefined;
  leader: boolean;
}

const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : null);
const span = (a: string | null | undefined, b: string | null | undefined) =>
  hhmm(a) && hhmm(b) ? `${hhmm(a)}–${hhmm(b)}` : null;

/**
 * Where the person is working, day by day: the Headcount Board's own rows.
 *
 * The board is the source. A row on it gives the shift and the column; nothing is
 * read from the person's usual department, because "Production" is not a line. A
 * rota day the board has no row for yet is still shown — it is a day they are due —
 * with the area null, which the screen says as "Work area not yet assigned". Accepted
 * overtime the board does not hold (yet) is shown from the ask, on the board its
 * hours belong to, also unassigned. A day can hold two rows — a Day shift and a Night
 * overtime — and both are listed.
 */
export function myShifts(data: MyAttendanceData, from: string, to: string): MyShift[] {
  const days = new Set(data.pattern?.days ?? []);
  const rotaHours = span(data.pattern?.starts_at, data.pattern?.ends_at);
  // The board's own rule (`boardShiftFor`): the Night crew is on the Night board,
  // every other crew on the Day board — weekends and warehouse included.
  const rotaShift = data.me.shift_group === "Night" ? "Night" : "Day";
  const out: MyShift[] = [];
  for (const date of eachDate(from, to)) {
    const rows = data.board.filter((b) => b.on_date === date);
    const asks = (data.overtime ?? []).filter((o) => o.on_date === date);
    for (const b of rows) {
      const ask = b.status === "overtime" ? asks.find((o) => overtimeBoardFor(o.starts_at) === b.shift) : undefined;
      const kind: MyShift["kind"] =
        b.status === "assigned" ? "scheduled"
        : b.status === "overtime" || b.status === "training" || b.status === "holiday" || b.status === "sick" || b.status === "unpaid" ? b.status
        : "other";
      const away = kind === "holiday" || kind === "sick" || kind === "unpaid" || kind === "other";
      out.push({
        date, shift: b.shift,
        hours: away ? null : ask ? span(ask.starts_at, ask.ends_at) : b.shift === rotaShift ? rotaHours : null,
        kind,
        area: away ? null : "area" in b ? b.area ?? null : undefined,
        leader: !!b.is_leader,
      });
    }
    for (const o of asks) {
      const shift = overtimeBoardFor(o.starts_at);
      if (rows.some((b) => b.shift === shift)) continue;
      out.push({ date, shift, hours: span(o.starts_at, o.ends_at), kind: "overtime", area: null, leader: false });
    }
    if (!rows.length && !asks.length && days.has(isoWeekday(date))) {
      out.push({ date, shift: rotaShift, hours: rotaHours, kind: "scheduled", area: null, leader: false });
    }
  }
  return out;
}

/* ------------------------------------------------- overtime placed on the board ---- */

/**
 * Overtime the Headcount Board holds for this person with no ask behind it: the office
 * put their name in a column as `overtime` by hand, and nobody answered anything.
 *
 * Found 30/10/2026: Ailton Junior (E003) was placed on Line 2 as overtime for Sat 31/10.
 * Where I'm working showed it, from this board row. My Overtime read only answers to
 * asks, so it said "0 Accepted" — and the database hid that Saturday's asks from him as
 * "already down for overtime" (`overtime_schedule_clash`). The booking was on no list
 * of his at all.
 *
 * A board row is the bridge's (`overtime_board_apply`) when an ask this person is
 * booked on lands on the same board — same date and shift, by `boardSlotOf`, the
 * bridge's own split. Those are already cards on My Overtime, so they are left out
 * here and nothing is counted twice. Nothing is written: the board row is the record.
 */
export function overtimeOnTheBoardOnly(data: MyAttendanceData, from: string, to: string): MyShift[] {
  const asks = data.overtime ?? [];
  const rotaHours = span(data.pattern?.starts_at, data.pattern?.ends_at);
  const rotaShift = data.me.shift_group === "Night" ? "Night" : "Day";
  return data.board
    .filter((b) => b.status === "overtime" && b.on_date >= from && b.on_date <= to)
    .filter((b) => !asks.some((o) => {
      const slot = boardSlotOf(o.on_date, o.starts_at);
      return slot.date === b.on_date && slot.shift === b.shift;
    }))
    .map((b): MyShift => ({
      date: b.on_date,
      shift: b.shift,
      // The rota's hours on the person's own board, as Where I'm working says them;
      // otherwise the board's own twelve hours.
      hours: (b.shift === rotaShift ? rotaHours : null) ?? (b.shift === "Night" ? "18:00–06:00" : "06:00–18:00"),
      kind: "overtime",
      area: "area" in b ? b.area ?? null : undefined,
      leader: !!b.is_leader,
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.shift.localeCompare(b.shift));
}

/* ------------------------------------------- overtime shifts, the supervisor's record ---- */

/** One booked overtime shift and what the supervisor recorded about it, if anything. */
export interface MyOvertimeShiftRecord {
  on_date: string;
  starts_at: string;
  ends_at: string;
  /** `overtime_outcomes.outcome`, or null when nothing has been recorded yet. */
  outcome: string | null;
}

export interface MyOvertimeShiftLine { date: string; hours: string; minutes: number }

export interface MyOvertimeShiftSummary {
  /** Marked `attended` by the supervisor. */
  worked: MyOvertimeShiftLine[];
  workedMinutes: number;
  /** Still to come (today or later), nothing recorded yet. */
  booked: MyOvertimeShiftLine[];
  /** Over, booked, and the supervisor has not marked it yet. */
  unmarked: MyOvertimeShiftLine[];
  /** Attended shifts on dates the clock has no worked minutes for. */
  notOnClock: MyOvertimeShiftLine[];
  notOnClockMinutes: number;
}

/**
 * The overtime shifts in a range, as the supervisor recorded them.
 *
 * "Overtime for <period>" started as the finance close's figure, which reads the clock
 * alone. TimeMoto is imported by hand, so a shift worked after the last import was not
 * in it: on 30/10 Ailton Junior's clock stopped at 20/10, and his two attended weekend
 * shifts (24/10, 12 h; 25/10, 8 h) left that figure at 0 h — ten people, thirteen shifts
 * and 136 h in October alone. The owner asked for the figure to count them (30/10).
 *
 * So a shift the supervisor marked `attended` is counted on the person's own screen
 * when the clock has no worked minutes on its date (`notOnClock`). A day the clock has
 * hours for is the clock's, so nothing is counted twice; once the import reaches the
 * day, the clock takes over by itself. The office's finance close still reads the clock
 * alone, and the screen says which part came from where.
 *
 * Hours are the ask's own window. A no-show, a sick call and a cancellation are not
 * overtime, so they are left out.
 */
export function summariseOvertimeShifts(
  records: MyOvertimeShiftRecord[],
  clocks: ReadonlyArray<Pick<MyClockRow, "on_date" | "worked_minutes">>,
  today: string,
): MyOvertimeShiftSummary {
  const clockedDays = new Set(clocks.filter((c) => (c.worked_minutes ?? 0) > 0).map((c) => c.on_date));
  const line = (r: MyOvertimeShiftRecord): MyOvertimeShiftLine => ({
    date: r.on_date,
    hours: span(r.starts_at, r.ends_at) ?? "",
    minutes: windowMinutes(r.starts_at, r.ends_at),
  });
  const sorted = [...records].sort((a, b) => a.on_date.localeCompare(b.on_date) || a.starts_at.localeCompare(b.starts_at));
  const worked = sorted.filter((r) => r.outcome === "attended").map(line);
  const open = sorted.filter((r) => r.outcome == null);
  const booked = open.filter((r) => r.on_date >= today).map(line);
  const unmarked = open.filter((r) => r.on_date < today).map(line);
  // Any other outcome (no-show, sick, cancelled) is not overtime worked, and falls out here.
  const notOnClock = worked.filter((w) => !clockedDays.has(w.date));
  const sum = (xs: MyOvertimeShiftLine[]) => xs.reduce((n, x) => n + x.minutes, 0);
  return {
    worked, workedMinutes: sum(worked), booked, unmarked,
    notOnClock, notOnClockMinutes: sum(notOnClock),
  };
}
