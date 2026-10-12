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
export interface MyBoardRow { on_date: string; shift: string; status: string; half_day: boolean | null }
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
      overtime: false, workedOnLeave: false, label: null as string | null,
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
        base.overtime = (clock.balance_minutes ?? 0) > 0;
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
      source = due || date > today ? "rota" : null;
      if (date > today || date === today) status = due ? "scheduled" : "rest";
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
   */
  settled: { period: MyPeriod; overtimeHours: number | null; owedHours: number | null } | null;
  /** Hours payroll has recorded for that period. The figure that is paid. */
  payrollHours: number | null;
  leave: LeaveBalance;
}

export function periodMatching(periods: MyPeriod[], from: string, to: string): MyPeriod | null {
  return periods.find((p) => p.start_date === from && p.end_date === to) ?? null;
}

export function summarise(
  data: MyAttendanceData, days: MyDay[], from: string, to: string, today: string,
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
    const [row] = buildClose([{
      employeeId: id, name: data.me.full_name, department: data.me.department, shift: null,
      openingBalanceMin: null, clockedBalanceMin: balanceMin, payrollOtHours: payrollHours,
      absences: counted.absences, daysPresent: counted.daysPresent, partDayHours: 0,
      patternName: data.pattern?.name ?? null, patternDays: data.pattern?.days ?? null,
      shiftsWorked: 0, shiftsHoliday: 0, plannedDates: null,
    }], from, to);
    settled = { period, overtimeHours: row.overtimeHours, owedHours: row.owedHours };
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
    out.push({ key: `period:${p.id}`, label: current ? `${p.name} (this pay period)` : p.name, from: p.start_date, to: p.end_date });
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

/** The range the page opens on: the pay period running today, else this month. */
export function defaultRange(periods: MyPeriod[], today: string): { from: string; to: string } {
  const current = periods.find((p) => p.start_date <= today && p.end_date >= today);
  if (current) return { from: current.start_date, to: current.end_date };
  const first = `${today.slice(0, 7)}-01`;
  const d = new Date(`${first}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return { from: first, to: addDays(iso(d), -1) };
}
