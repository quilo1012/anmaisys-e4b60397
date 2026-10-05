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
   * printing a huge one would read as a bug rather than as an empty table. Null too
   * when the stored date cannot be read as a date: a zero there would read as
   * "imported today", which is the one thing this hook exists to stop.
   *
   * NEGATIVE when the clock carries days ahead of today. It is signed on purpose —
   * see `daysAhead`.
   */
  daysBehind: number | null;
  /**
   * How far the clock runs PAST today, or null when it does not.
   *
   * On 05/10/2026 the view's `last_on_date` was 11/10 — six days ahead, because
   * `attendance_days` holds 210 rows dated after today. The gap was clamped with
   * `Math.max(0, …)`, so the note read "last imported 11 Oct 2026 — today" on three
   * screens, untroubled, about days nobody can have worked yet. A clock that runs
   * ahead misleads in the opposite direction from one that runs late, and both have
   * to be sayable.
   */
  daysAhead: number | null;
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

/** Null rather than nought when either date is unreadable: nought is a claim. */
function wholeDaysBetween(fromIso: string, toIso: string): number | null {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

/**
 * The view's row, read into the shape the screens use.
 *
 * Pulled out of the hook so the arithmetic can be tested without a query client: the
 * clamp that hid a clock dated in the future lived in here, unreachable by any test.
 */
export function coverageFrom(row: CoverageRow | null, todayIso: string): ClockCoverage | null {
  if (!row) return null;
  const lastOnDate = row.last_on_date ?? null;
  const daysBehind = lastOnDate ? wholeDaysBetween(lastOnDate, todayIso) : null;
  return {
    lastOnDate,
    firstOnDate: row.first_on_date ?? null,
    employeesCovered: Number(row.employees_covered ?? 0),
    activeEmployees: Number(row.active_employees ?? 0),
    rowsTotal: Number(row.rows_total ?? 0),
    daysBehind,
    daysAhead: daysBehind !== null && daysBehind < 0 ? -daysBehind : null,
    // Never stale on a table nobody has filled: that is not a late import, it is
    // no import, and the note says so in its own words. Nor on a clock that runs
    // ahead — that is a different fault with a different sentence.
    stale: daysBehind !== null && daysBehind > CLOCK_STALE_DAYS,
  };
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

  const coverage = coverageFrom(q.data ?? null, todayIso);

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
