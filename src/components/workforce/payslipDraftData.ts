/**
 * What the payslip drafts read, and how it is split per person.
 *
 * `fetchPayslipRaw` is the only part that talks to the database: one read of each table
 * for the whole period, paged (a pay period holds more than a thousand rows of each and
 * PostgREST stops at a thousand without a word). `assemblePayslipDrafts` is pure: it
 * hands each Finance Close row its own days and builds the sheet.
 *
 * Here, beside the Finance Close's other pieces, because it reads `employees`: the
 * roster is read only behind an HR-gated screen (theRosterFollowsItsScreen.test.ts).
 */
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAllRows";
import type { ClosePerson } from "@/lib/financeClose";
import type { MyClockRow, MyMark, MyOvertimeShiftRecord } from "@/lib/myAttendance";
import { buildPayslipDraft, type PayslipBoardRow, type PayslipDraft, type PayslipPattern } from "@/lib/payslipDraft";

export interface PayslipRaw {
  patterns: { employee_id: string; pattern: PayslipPattern | null }[];
  clocks: (MyClockRow & { employee_id: string })[];
  marks: (MyMark & { employee_id: string })[];
  board: (PayslipBoardRow & { employee_id: string })[];
  overtime: (MyOvertimeShiftRecord & { employee_id: string })[];
  /** Holiday marks from the start of today's leave year on, as `my_attendance` reads them. */
  holidays?: { employee_id: string; on_date: string }[];
}

const groupBy = <T extends { employee_id: string }>(xs: T[]) => {
  const out = new Map<string, T[]>();
  for (const x of xs) {
    const list = out.get(x.employee_id) ?? [];
    list.push(x);
    out.set(x.employee_id, list);
  }
  return out;
};

export function assemblePayslipDrafts(
  people: ReadonlyArray<ClosePerson & { lineName?: string | null }>,
  raw: PayslipRaw,
  ctx: { period: { name: string; start_date: string; end_date: string }; to: string; today: string; now: Date },
): PayslipDraft[] {
  const pattern = new Map(raw.patterns.map((p) => [p.employee_id, p.pattern]));
  const clocks = groupBy(raw.clocks);
  const marks = groupBy(raw.marks);
  const board = groupBy(raw.board);
  const overtime = groupBy(raw.overtime);
  const holidays = raw.holidays ? groupBy(raw.holidays) : null;
  return people.map((person) => buildPayslipDraft({
    person, ...ctx,
    pattern: pattern.get(person.employeeId) ?? null,
    clocks: clocks.get(person.employeeId) ?? [],
    marks: marks.get(person.employeeId) ?? [],
    board: board.get(person.employeeId) ?? [],
    overtime: overtime.get(person.employeeId) ?? [],
    holidayMarks: holidays ? (holidays.get(person.employeeId) ?? []).map((h) => h.on_date) : undefined,
  }));
}

// The embedded selects are not in the generated types' shape.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const paged = <T>(build: (a: number, b: number) => unknown) =>
  fetchAllRows<T>({ range: build as never });

/**
 * Everything the drafts need for `from`..`to`, for everybody. Reads only.
 * `leaveYearFrom` (the start of today's leave year) adds the holiday balance.
 */
export async function fetchPayslipRaw(from: string, to: string, leaveYearFrom?: string): Promise<PayslipRaw> {
  const [emp, clocks, marks, board, answers, holidays] = await Promise.all([
    db.from("employees")
      .select("id, shift_patterns(name, days, starts_at, ends_at, break_minutes, annual_leave_days)")
      .eq("active", true),
    paged<MyClockRow & { employee_id: string }>((a, b) => db.from("attendance_days")
      .select("employee_id, on_date, start_time, end_time, worked_minutes, balance_minutes, scheduled_minutes, overtime_adj_minutes, absence_name")
      .gte("on_date", from).lte("on_date", to)
      .order("on_date", { ascending: true }).order("employee_id", { ascending: true })
      .range(a, b)),
    paged<MyMark & { employee_id: string }>((a, b) => db.from("employee_attendance")
      .select("employee_id, on_date, status")
      .gte("on_date", from).lte("on_date", to)
      .order("on_date", { ascending: true }).order("employee_id", { ascending: true })
      .range(a, b)),
    paged<PayslipBoardRow & { employee_id: string }>((a, b) => db.from("daily_allocations")
      .select("employee_id, on_date, shift, status, half_day, left_early_at, arrived_late_at, overtime_request_id")
      .gte("on_date", from).lte("on_date", to)
      .order("on_date", { ascending: true }).order("employee_id", { ascending: true })
      .range(a, b)),
    // Accepted answers, as My Attendance reads them; a cancelled ask is left out and an
    // outcome (no-show, sick, cancelled) is carried so the count can drop it. A night
    // ask after midnight belongs to the board of the day before, so one day either side.
    paged<{
      employee_id: string; request_id: string;
      overtime_requests: { on_date: string; starts_at: string; ends_at: string } | null;
      overtime_outcomes: { outcome: string }[] | { outcome: string } | null;
    }>((a, b) => db.from("overtime_responses")
      .select("employee_id, request_id, overtime_requests!inner(on_date, starts_at, ends_at, status), overtime_outcomes(outcome)")
      .eq("decision", "accepted")
      .gte("overtime_requests.on_date", from)
      .lte("overtime_requests.on_date", to)
      .neq("overtime_requests.status", "cancelled")
      .order("request_id", { ascending: true }).order("employee_id", { ascending: true })
      .range(a, b)),
    // The same rows `my_attendance` counts the balance from: holiday marks, from the
    // start of the leave year, for three years (bookings run ahead).
    leaveYearFrom
      ? paged<{ employee_id: string; on_date: string }>((a, b) => db.from("employee_attendance")
        .select("employee_id, on_date")
        .eq("status", "holiday")
        .gte("on_date", leaveYearFrom)
        .lte("on_date", `${Number(leaveYearFrom.slice(0, 4)) + 3}${leaveYearFrom.slice(4)}`)
        .order("on_date", { ascending: true }).order("employee_id", { ascending: true })
        .range(a, b))
      : Promise.resolve(undefined),
  ]);
  if (emp.error) throw emp.error;

  return {
    patterns: ((emp.data ?? []) as { id: string; shift_patterns: PayslipPattern | null }[])
      .map((e) => ({ employee_id: e.id, pattern: e.shift_patterns ?? null })),
    clocks, marks, board, holidays,
    overtime: answers
      .filter((r) => r.overtime_requests)
      .map((r) => {
        const outs = Array.isArray(r.overtime_outcomes) ? r.overtime_outcomes : r.overtime_outcomes ? [r.overtime_outcomes] : [];
        return {
          employee_id: r.employee_id, request_id: r.request_id,
          on_date: r.overtime_requests!.on_date, starts_at: r.overtime_requests!.starts_at, ends_at: r.overtime_requests!.ends_at,
          outcome: outs[0]?.outcome ?? null,
        };
      }),
  };
}
