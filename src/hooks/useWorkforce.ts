import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Workforce data: who works here, on which days, and the overtime they carry.
 *
 * These tables are newer than the generated Supabase types, so the client is cast
 * once here rather than at every call site.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tables not in the generated types yet
const db = supabase as any;

export interface ShiftPattern {
  id: string;
  name: string;
  /** ISO weekdays: 1 = Monday … 7 = Sunday. */
  days: number[];
  active: boolean;
}

export interface Employee {
  id: string;
  full_name: string;
  email: string | null;
  department: string | null;
  shift_pattern_id: string | null;
  employee_ref: string | null;
  active: boolean;
  /**
   * Day, Night, Weekend, Warehouse Day or Warehouse Weekend — the shift the factory
   * thinks in. Not the same as shift_pattern_id, which says which days of the week
   * somebody works. A person has both: Night, and Mon–Thu.
   */
  shift_group: string | null;
  /** Where the headcount board places them. See headcount_areas. */
  headcount_area_id: string | null;
  started_on: string | null;
  left_on: string | null;
  source: string;
  notes: string | null;
  current_line_id: string | null;
}

export type AttendanceStatus = "present" | "absent" | "sick" | "holiday" | "training" | "unpaid";

export interface Attendance {
  id: string;
  employee_id: string;
  on_date: string;
  status: AttendanceStatus;
  note: string | null;
  /**
   * Where they worked on this day. Null means nobody moved them, so they were where
   * `employees.headcount_area_id` says they usually are.
   */
  headcount_area_id: string | null;
}

export interface OvertimePeriod {
  id: string;
  label: string;
  starts_on: string;
  ends_on: string;
}

export interface OvertimeEntry {
  id: string;
  employee_id: string;
  period_id: string;
  hours: number;
  note: string | null;
  /** Where the figure came from, and when. It is not calculated here. */
  source_note?: string | null;
  imported_at?: string | null;
}

export const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** "Fri, Sat, Sun, Mon" — in rota order, starting at the first day of the run. */
export function describeDays(days: number[] | null | undefined): string {
  if (!days?.length) return "—";
  const sorted = [...days].sort((a, b) => a - b);
  // A pattern that wraps the weekend (Fri–Mon = 5,6,7,1) reads wrong in numeric
  // order. If it wraps, start at the day after the gap.
  const wraps = sorted.includes(1) && sorted.includes(7) && !sorted.includes(2);
  const ordered = wraps ? [...sorted.filter((d) => d >= 5), ...sorted.filter((d) => d < 5)] : sorted;
  return ordered.map((d) => WEEKDAY_LABELS[d - 1]).join(", ");
}

/** Whether the pattern covers a given date. */
export function worksOn(days: number[] | null | undefined, date: Date): boolean {
  if (!days?.length) return false;
  const iso = date.getDay() === 0 ? 7 : date.getDay(); // JS Sunday is 0
  return days.includes(iso);
}

export function useShiftPatterns() {
  return useQuery({
    queryKey: ["shift_patterns"],
    queryFn: async (): Promise<ShiftPattern[]> => {
      const { data, error } = await db.from("shift_patterns").select("*").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useEmployees() {
  return useQuery({
    queryKey: ["employees"],
    queryFn: async (): Promise<Employee[]> => {
      const { data, error } = await db.from("employees").select("*").order("full_name");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useOvertimePeriods() {
  return useQuery({
    queryKey: ["overtime_periods"],
    queryFn: async (): Promise<OvertimePeriod[]> => {
      const { data, error } = await db.from("overtime_periods").select("*").order("starts_on", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useOvertimeEntries(periodId: string | null) {
  return useQuery({
    queryKey: ["overtime_entries", periodId],
    enabled: !!periodId,
    queryFn: async (): Promise<OvertimeEntry[]> => {
      const { data, error } = await db.from("overtime_entries").select("*").eq("period_id", periodId);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useAttendance(onDate: string) {
  return useQuery({
    queryKey: ["employee_attendance", onDate],
    queryFn: async (): Promise<Attendance[]> => {
      const { data, error } = await db.from("employee_attendance").select("*").eq("on_date", onDate);
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * Attendance over a closed date range, for the monthly summary.
 *
 * A month is a real question to ask of this table — it carries one row per person
 * per day. Overtime cannot be asked the same way: its rows are one total per person
 * per period, so they are read by period and never sliced into months.
 */
export function useAttendanceRange(fromDate: string, toDate: string) {
  return useQuery({
    queryKey: ["employee_attendance_range", fromDate, toDate],
    queryFn: async (): Promise<Attendance[]> => {
      const { data, error } = await db
        .from("employee_attendance")
        .select("*")
        .gte("on_date", fromDate)
        .lte("on_date", toDate);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useSetAttendance(onDate: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ employeeId, status }: { employeeId: string; status: AttendanceStatus }) => {
      const { error } = await db
        .from("employee_attendance")
        .upsert({ employee_id: employeeId, on_date: onDate, status }, { onConflict: "employee_id,on_date" });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["employee_attendance", onDate] }),
  });
}

/**
 * Move someone to an area, on one day, and say so on the record.
 *
 * The day's attendance row holds where they worked that day; the movement row holds
 * that somebody moved them, from where and by whom. Nobody works the same line every
 * day, so writing this onto the employee would rewrite every day they have already
 * worked — the default on `employees` only ever seeds a day nobody has touched.
 */
export function useMoveEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      employee, toLineId, fromLineName, toLineName, movedBy, onDate,
    }: {
      employee: Employee; toLineId: string | null; onDate: string;
      fromLineName: string | null; toLineName: string | null; movedBy?: string | null;
    }) => {
      const { error } = await db
        .from("employee_attendance")
        .upsert(
          { employee_id: employee.id, on_date: onDate, headcount_area_id: toLineId, status: "present" },
          { onConflict: "employee_id,on_date" },
        );
      if (error) throw error;
      const { error: histError } = await db.from("employee_movements").insert({
        employee_id: employee.id,
        from_line: fromLineName,
        to_line: toLineName,
        from_department: employee.department,
        to_department: employee.department,
        moved_by: movedBy ?? null,
      });
      // The move itself succeeded. A failed history write is worth knowing about but
      // must not roll the board back under the user.
      if (histError) console.error("[workforce] movement not recorded:", histError);
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["employee_attendance", vars.onDate] });
      qc.invalidateQueries({ queryKey: ["employee_movements", vars.employee.id] });
    },
  });
}

export interface ShiftPosition {
  employee_id: string;
  shift_group: string | null;
  shift_pattern_id: string | null;
  effective_from: string;
  note: string | null;
}

/**
 * Every shift position anybody has held, newest first.
 *
 * Small enough to fetch whole — one row per change, not per day — and resolving in
 * memory keeps the board from issuing a query every time somebody steps a day.
 */
export function useShiftHistory() {
  return useQuery({
    queryKey: ["employee_shift_history"],
    queryFn: async (): Promise<ShiftPosition[]> => {
      const { data, error } = await db
        .from("employee_shift_history")
        .select("employee_id, shift_group, shift_pattern_id, effective_from, note")
        .order("effective_from", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * Which shift somebody was on, on a given day.
 *
 * The latest position that had already started. A day before anybody's first record
 * falls back to the employee's current shift — which is a guess, but the honest
 * alternative is showing an empty factory for every date before 01/08/2026.
 */
export function resolveShiftOn(
  history: ShiftPosition[] | undefined,
  employee: Pick<Employee, "id" | "shift_group" | "shift_pattern_id">,
  onDate: string,
): { shift_group: string | null; shift_pattern_id: string | null } {
  const found = (history ?? []).find(
    (h) => h.employee_id === employee.id && h.effective_from <= onDate,
  );
  return found
    ? { shift_group: found.shift_group, shift_pattern_id: found.shift_pattern_id }
    : { shift_group: employee.shift_group, shift_pattern_id: employee.shift_pattern_id };
}

/**
 * Move somebody to another shift from a date.
 *
 * Writes the history row and the current columns together. The history is what any
 * past day is read through; the columns are what the rest of the app shows when it is
 * not asking about a date, and letting them drift apart is how the two disagree.
 */
export function useChangeShift() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      employeeId: string;
      shiftGroup: string | null;
      shiftPatternId: string | null;
      effectiveFrom: string;
      changedBy?: string | null;
    }) => {
      const { error } = await db.from("employee_shift_history").upsert(
        {
          employee_id: input.employeeId,
          shift_group: input.shiftGroup,
          shift_pattern_id: input.shiftPatternId,
          effective_from: input.effectiveFrom,
          changed_by: input.changedBy ?? null,
        },
        { onConflict: "employee_id,effective_from" },
      );
      if (error) throw error;
      const { error: curErr } = await db
        .from("employees")
        .update({ shift_group: input.shiftGroup, shift_pattern_id: input.shiftPatternId })
        .eq("id", input.employeeId);
      if (curErr) throw curErr;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.invalidateQueries({ queryKey: ["employee_shift_history"] });
    },
  });
}

/**
 * Add somebody to the list.
 *
 * Deliberately few fields. A name and a shift is enough to put a person on the board
 * this morning; the payroll number, the rota and the start date are things HR fills
 * in later from a record that exists, and asking for them here would either hold up
 * the board or invite somebody to type a plausible guess into a payroll field.
 */
export function useCreateEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      full_name: string;
      shift_group: string | null;
      department: string | null;
      headcount_area_id: string | null;
      employee_ref: string | null;
      started_on: string | null;
    }) => {
      const { data, error } = await db
        .from("employees")
        .insert({ ...input, active: true, source: "manual" })
        .select("id")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["employees"] }),
  });
}

export function useMovements(employeeId: string | null) {
  return useQuery({
    queryKey: ["employee_movements", employeeId],
    enabled: !!employeeId,
    queryFn: async () => {
      const { data, error } = await db
        .from("employee_movements").select("*")
        .eq("employee_id", employeeId).order("moved_at", { ascending: false }).limit(20);
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; from_line: string | null; to_line: string | null; moved_at: string; reason: string | null }>;
    },
  });
}

export function useLines() {
  return useQuery({
    queryKey: ["lines_min"],
    queryFn: async (): Promise<Array<{ id: string; name: string }>> => {
      const { data, error } = await db.from("lines").select("id, name").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export interface HeadcountArea {
  id: string;
  name: string;
  kind: "production" | "support";
  sort_order: number;
}

/**
 * The columns of the headcount board.
 *
 * Ten production areas mirroring `lines`, plus the sectors the spreadsheet has and
 * `lines` deliberately does not: Office, WH Team, Hygiene, Quality, Lab and the rest.
 * Kept out of `lines` so that "Office" never becomes offerable as the location of a
 * machine breakdown.
 */
export function useHeadcountAreas() {
  return useQuery({
    queryKey: ["headcount_areas"],
    queryFn: async (): Promise<HeadcountArea[]> => {
      const { data, error } = await db
        .from("headcount_areas")
        .select("id, name, kind, sort_order")
        .eq("active", true)
        .order("sort_order")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Every period this person has a balance for, newest first. */
export function useEmployeeOvertime(employeeId: string | null) {
  return useQuery({
    queryKey: ["employee_overtime", employeeId],
    enabled: !!employeeId,
    queryFn: async (): Promise<Array<OvertimeEntry & { period: OvertimePeriod }>> => {
      const { data, error } = await db
        .from("overtime_entries")
        .select("*, period:overtime_periods(*)")
        .eq("employee_id", employeeId);
      if (error) throw error;
      return (data ?? []).sort(
        (a: any, b: any) => String(b.period?.starts_on ?? "").localeCompare(String(a.period?.starts_on ?? "")),
      );
    },
  });
}

export function useUpdateEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Employee> }) => {
      const { error } = await db.from("employees").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["employees"] }),
  });
}
