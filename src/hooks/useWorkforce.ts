import { useQuery } from "@tanstack/react-query";
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
