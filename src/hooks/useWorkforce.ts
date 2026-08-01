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
  left_on: string | null;
  source: string;
  notes: string | null;
  current_line_id: string | null;
}

export type AttendanceStatus = "present" | "absent" | "sick" | "holiday" | "training";

export interface Attendance {
  id: string;
  employee_id: string;
  on_date: string;
  status: AttendanceStatus;
  note: string | null;
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
 * Move someone to a line, and say so on the record.
 *
 * The column holds where they are now; the movement row holds that they were moved,
 * by whom and from where. Writing only the column would make the board unanswerable
 * a week later.
 */
export function useMoveEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      employee, toLineId, fromLineName, toLineName, movedBy,
    }: {
      employee: Employee; toLineId: string | null;
      fromLineName: string | null; toLineName: string | null; movedBy?: string | null;
    }) => {
      const { error } = await db.from("employees").update({ current_line_id: toLineId }).eq("id", employee.id);
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
