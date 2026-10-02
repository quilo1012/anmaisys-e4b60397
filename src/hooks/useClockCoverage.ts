import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * How far behind the TimeMoto clock is, and how much of the factory it covers.
 *
 * The screens that read `attendance_days` have no way of telling "nobody clocked" from
 * "nobody has imported this yet". Attendance says "Nothing clocked in this period" over
 * a period nobody has loaded, and the sentence is indistinguishable from a quiet month.
 * On 02/10/2026 the last clocked day was 06/09 — twenty-six days back — and 99 of 211
 * active people had ever appeared in it at all.
 *
 * So every screen that leans on the clock says where the clock is first. One hook, so
 * three screens cannot disagree about a date that is a fact about the import.
 */

export interface ClockCoverage {
  /** Most recent day with any clock row, or null when the table is empty. */
  lastOnDate: string | null;
  firstOnDate: string | null;
  /** Active people who have ever appeared in the clock. */
  employeesCovered: number;
  activeEmployees: number;
  rowsTotal: number;
  /**
   * Days between the last clocked day and the operational date the caller is on.
   *
   * Null when nothing has ever been clocked — "infinitely behind" is not a number, and
   * printing a huge one would read as a bug rather than as an empty table.
   */
  daysBehind: number | null;
  /** Past a week behind, the gap is the story rather than a footnote. */
  stale: boolean;
}

/** A week. Past this, the screens stop whispering it and start saying it. */
export const CLOCK_STALE_DAYS = 7;

interface CoverageRow {
  last_on_date: string | null;
  first_on_date: string | null;
  employees_covered: number | null;
  active_employees: number | null;
  rows_total: number | null;
}

function wholeDaysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/**
 * @param todayIso the caller's OPERATIONAL date, not `new Date()`. At 03:00 the night
 *   crew is still on yesterday's board, and a gap measured against the calendar would
 *   gain a day at midnight while nothing about the import had changed.
 */
export function useClockCoverage(todayIso: string) {
  const q = useQuery({
    queryKey: ["timemoto_coverage"],
    // The import runs at most daily; refetching it per mount would be asking a
    // question whose answer cannot have moved.
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<CoverageRow | null> => {
      // The view is newer than the generated Postgrest types, hence the cast.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- view newer than the generated types
      const { data, error } = await (supabase as any)
        .from("v_timemoto_coverage")
        .select("last_on_date, first_on_date, employees_covered, active_employees, rows_total")
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as CoverageRow | null;
    },
  });

  const row = q.data ?? null;
  const lastOnDate = row?.last_on_date ?? null;
  const daysBehind = lastOnDate ? Math.max(0, wholeDaysBetween(lastOnDate, todayIso)) : null;

  const coverage: ClockCoverage | null = row
    ? {
        lastOnDate,
        firstOnDate: row.first_on_date ?? null,
        employeesCovered: Number(row.employees_covered ?? 0),
        activeEmployees: Number(row.active_employees ?? 0),
        rowsTotal: Number(row.rows_total ?? 0),
        daysBehind,
        // Never stale on a table nobody has filled: that is not a late import, it is
        // no import, and the note says so in its own words.
        stale: daysBehind !== null && daysBehind > CLOCK_STALE_DAYS,
      }
    : null;

  return {
    coverage,
    /**
     * Load and failure kept apart, and neither folded into `coverage`.
     *
     * A null coverage from a failed read and a null from an empty table would say the
     * same thing to a caller that only checked for null, and one of them is "the clock
     * is empty" — a claim about the factory this hook has no right to make when it
     * could not ask.
     */
    isLoading: q.isPending,
    isError: q.isError,
    refetch: () => void q.refetch(),
  };
}
