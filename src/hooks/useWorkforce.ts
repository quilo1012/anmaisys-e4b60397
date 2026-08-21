import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { currentShift } from "@/lib/operationalShift";
import type { PatternDayOverride } from "@/lib/overtime";

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
  starts_at?: string | null;
  ends_at?: string | null;
  break_minutes?: number | null;
  /**
   * Weekdays whose hours differ from the rest of the rota. Empty for most patterns —
   * they work the same hours every day they cover.
   */
  dayOverrides?: PatternDayOverride[];
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
  /** Job title. Free text — the factory says "Line Leader", not a code. */
  position: string | null;
  /** Who they report to. Another employee, so the chain is one table. */
  manager_id: string | null;
  /** permanent | agency | contractor | temporary. */
  employment_type: string;
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

/**
 * A pay period.
 *
 * There were two tables of these — `overtime_periods` with two rows and
 * `workforce_payroll_periods` with twenty-nine — describing the same pay periods. The
 * Finance Close read one and the overtime register beside it read the other, so the
 * register could sit on June while the close above it read July, and what is keyed in
 * the register IS the close's Payroll OT column. `overtime_entries` was empty, so the
 * key was repointed at the payroll table and the duplicate dropped.
 *
 * `label`, `starts_on` and `ends_on` are kept as the names this app already uses,
 * mapped from the payroll table's own columns at the edge.
 */
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

/**
 * The rota in words, hours included, saying so when a day differs.
 *
 * `describeDays` answers which weekdays; this answers which hours, and it exists
 * because a rota whose Friday starts three hours later reads as an ordinary Tue–Fri
 * everywhere it is picked from. Somebody choosing it from a list has no way to know,
 * and the person put on the wrong hours is the one who finds out.
 */
export function describeSchedule(pattern: ShiftPattern): string {
  const days = describeDays(pattern.days);
  if (!pattern.starts_at || !pattern.ends_at) return days;
  const hm = (t: string) => t.slice(0, 5);
  const base = `${hm(pattern.starts_at)}–${hm(pattern.ends_at)}`;

  const overrides = (pattern.dayOverrides ?? []).filter((o) => pattern.days.includes(o.weekday));
  if (overrides.length === 0) return `${days} · ${base}`;

  const normal = pattern.days.filter((d) => !overrides.some((o) => o.weekday === d));
  const parts = normal.length > 0 ? [`${describeDays(normal)} ${base}`] : [];
  for (const o of [...overrides].sort((a, b) => a.weekday - b.weekday)) {
    parts.push(`${describeDays([o.weekday])} ${hm(o.starts_at)}–${hm(o.ends_at)}`);
  }
  return parts.join(" · ");
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
      // Two reads rather than an embed: the override table is small, almost always
      // empty, and joining it would reshape every existing caller of this hook.
      const [patterns, overrides] = await Promise.all([
        db.from("shift_patterns").select("*").order("name"),
        db.from("shift_pattern_days").select("pattern_id, weekday, starts_at, ends_at, break_minutes"),
      ]);
      if (patterns.error) throw patterns.error;
      if (overrides.error) throw overrides.error;

      const byPattern = new Map<string, PatternDayOverride[]>();
      for (const o of (overrides.data ?? []) as any[]) {
        const list = byPattern.get(o.pattern_id) ?? [];
        list.push({
          weekday: o.weekday, starts_at: o.starts_at,
          ends_at: o.ends_at, break_minutes: o.break_minutes,
        });
        byPattern.set(o.pattern_id, list);
      }
      return (patterns.data ?? []).map((p: any) => ({
        ...p, dayOverrides: byPattern.get(p.id) ?? [],
      }));
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
      const { data, error } = await db
        .from("workforce_payroll_periods")
        .select("id, name, start_date, end_date")
        .order("start_date", { ascending: false });
      if (error) throw error;
      return ((data ?? []) as any[]).map((p) => ({
        id: p.id, label: p.name, starts_on: p.start_date, ends_on: p.end_date,
      }));
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
      // Paged: a month of marks for the whole factory clears a thousand rows.
      return await fetchAllRows<Attendance>({
        range: (a, b) => db
          .from("employee_attendance")
          .select("*")
          .gte("on_date", fromDate)
          .lte("on_date", toDate)
          .order("on_date", { ascending: true }).order("employee_id", { ascending: true })
          .range(a, b),
      });
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
      employee, toLineId, fromLineName, toLineName, movedBy, onDate, keepStatus,
    }: {
      employee: Employee; toLineId: string | null; onDate: string;
      fromLineName: string | null; toLineName: string | null; movedBy?: string | null;
      /** Whatever the day already said, so placing somebody does not overwrite it. */
      keepStatus?: AttendanceStatus | null;
    }) => {
      // Present only when nothing had been said yet. Putting somebody on a line is
      // saying where they are, not that they turned up — and somebody already marked
      // Holiday who gets dragged onto a line should stay on holiday until a person
      // decides otherwise, rather than being quietly marked in.
      const { error } = await db
        .from("employee_attendance")
        .upsert(
          {
            employee_id: employee.id,
            on_date: onDate,
            headcount_area_id: toLineId,
            status: keepStatus ?? "present",
          },
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
 * this morning; the rota and the start date are things HR fills in later from a
 * record that exists, and asking for them here would either hold up the board or
 * invite somebody to type a plausible guess into a payroll field.
 */
export function useCreateEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      full_name: string;
      shift_group: string | null;
      department: string | null;
      headcount_area_id: string | null;
      started_on: string | null;
    }) => {
      // No employee_ref. The E-numbers came from the payroll list and belong to it;
      // a number typed here is a key invented to match another system, and a wrong
      // one is worse than none — it would look like a match and join to the wrong
      // person the first time TimeMoto is imported.
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
  const { user } = useAuth();
  return useQuery({
    // Same reason as the operator accounts: `lines` is RLS-protected, a request with
    // no session comes back empty rather than failing, and an empty list cached at
    // mount leaves the operator's line unresolvable until something invalidates it.
    queryKey: ["lines_min", user?.id ?? null],
    enabled: !!user,
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
  /** The department this area's work belongs to. Links the board to the headcount. */
  department: string | null;
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
        .select("id, name, kind, department, sort_order")
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
        .select("*, period:workforce_payroll_periods(id, name, start_date, end_date)")
        .eq("employee_id", employeeId);
      if (error) throw error;
      return ((data ?? []) as any[])
        .map((r) => ({
          ...r,
          period: r.period && {
            id: r.period.id, label: r.period.name,
            starts_on: r.period.start_date, ends_on: r.period.end_date,
          },
        }))
        .sort((a, b) => String(b.period?.starts_on ?? "").localeCompare(String(a.period?.starts_on ?? "")));
    },
  });
}

/**
 * Edit somebody's record — and, when the edit moves their position, say so where the
 * rules can hear it.
 *
 * `employees.shift_group` and `employees.shift_pattern_id` are what every screen
 * shows. `employee_shift_history` is what every *date-aware* read asks, including the
 * one that decides whether a day is an ordinary shift or overtime — see
 * `resolveShiftOn` and the board's `recordPosition`.
 *
 * This panel wrote only the columns. So a rota corrected here reached every screen and
 * none of the rules: the board went on judging the person against the rota the history
 * still held, and a Tue–Fri person's Friday was saved as `overtime` while this very
 * panel showed Tue–Fri back to whoever had just set it. The board's two controls were
 * fixed on 08/08; this third writer was missed, and it is the one the office uses.
 *
 * Effective from the operational date, not from `new Date()`: at half past midnight
 * the calendar has turned over and the night crew has not, and a rota that starts
 * "today" has to mean the day the factory is working.
 *
 * Only a patch that touches the position writes a row. A department, a manager or a
 * leaving date is not a position, and a row per edit would fill the history with dates
 * on which nothing moved.
 */
export function useUpdateEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Employee> }) => {
      const movesPosition = "shift_group" in patch || "shift_pattern_id" in patch;

      // The half not being changed, read before the write. A history row holds both,
      // and writing one while leaving the other null would move the person to no crew
      // at all on that date — the same reason the board reads it first.
      let held: { shift_group: string | null; shift_pattern_id: string | null } | null = null;
      if (movesPosition) {
        const { data, error: readErr } = await db
          .from("employees")
          .select("shift_group, shift_pattern_id")
          .eq("id", id)
          .single();
        if (readErr) throw readErr;
        held = data as { shift_group: string | null; shift_pattern_id: string | null };
      }

      const { error } = await db.from("employees").update(patch).eq("id", id);
      if (error) throw error;

      if (movesPosition) {
        const { error: histErr } = await db.from("employee_shift_history").upsert(
          {
            employee_id: id,
            shift_group: "shift_group" in patch ? patch.shift_group ?? null : held?.shift_group ?? null,
            shift_pattern_id:
              "shift_pattern_id" in patch ? patch.shift_pattern_id ?? null : held?.shift_pattern_id ?? null,
            effective_from: currentShift().operationalDate,
            note: "Position changed on the employee panel",
          },
          { onConflict: "employee_id,effective_from" },
        );
        if (histErr) throw histErr;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employees"] });
      // The rules read these two, and a rota that has changed has to reach them or the
      // board keeps deciding overtime against the old one until a reload.
      qc.invalidateQueries({ queryKey: ["employee_shift_history"] });
      qc.invalidateQueries({ queryKey: ["headcount-roster-all"] });
    },
  });
}

export interface Department {
  id: string;
  name: string;
  /** Headcount the department is funded for. 0 means nobody has set one. */
  budget: number;
  active: boolean;
}

/**
 * Departments and the headcount each is funded for.
 *
 * Kept in its own table rather than derived from `employees.department`, because a
 * budget is a fact about the department whether or not anybody currently fills it —
 * a department with four vacancies and no staff still has a budget, and deriving the
 * list from the people in it would make that department disappear.
 */
export function useDepartments() {
  return useQuery({
    queryKey: ["departments"],
    queryFn: async (): Promise<Department[]> => {
      const { data, error } = await db
        .from("departments").select("id, name, budget, active")
        .eq("active", true).order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useSetDepartmentBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, budget }: { id: string; budget: number }) => {
      const { error } = await db.from("departments").update({ budget }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["departments"] }),
  });
}

/**
 * Everyone placed on the board for a day, with the department their area belongs to.
 *
 * This is the other half of the headcount. `employees.department` says where somebody
 * is on the books; this says where they actually worked that day — and the two are
 * different questions, because a Production operative sent to Hygiene for a shift is
 * still a Production employee.
 */
export function useAllocatedByDepartment(onDate: string) {
  return useQuery({
    queryKey: ["allocated-by-department", onDate],
    queryFn: async (): Promise<Record<string, number>> => {
      const { data, error } = await db
        .from("daily_allocations")
        .select("status, area:headcount_areas(department)")
        .eq("on_date", onDate)
        .in("status", ["assigned", "overtime"]);
      if (error) throw error;
      const out: Record<string, number> = {};
      for (const row of (data ?? []) as Array<{ area: { department: string | null } | null }>) {
        const dep = row.area?.department;
        if (dep) out[dep] = (out[dep] ?? 0) + 1;
      }
      return out;
    },
  });
}
