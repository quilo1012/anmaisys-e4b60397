import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { summariseUnledShifts, type UnledShifts } from "@/lib/scorecardWeek";

/**
 * The shifts in this week that the board cannot show, because nobody is recorded as
 * having led them.
 *
 * A session is created empty — the production import writes only
 * `(session_date, shift, line)` — and the leader is written later, by the tablet on the
 * line when somebody submits the shift. A shift nobody submitted keeps no leader, ever.
 * Measured 16/09/2026: 183 of 780 sessions, 8 to 24 a week, still happening. Of those
 * 183, exactly 5 could be traced to a leader through `daily_allocations`, so there is no
 * repairing them after the fact — only saying how many there are.
 *
 * This is a plain select, not an RPC, and deliberately so. Every unled session has BOTH
 * `leader_id` and `leader_name` null — there is not one with an id and no name, nor one
 * whose name fails to resolve — so "no leader" is a predicate, not the name-matching
 * `scorecard_week_board` does inside itself. Asking the database the simple question
 * keeps that rule in one place instead of copying it into a second function that could
 * then drift. Both columns are filtered, not just the name: if a session ever arrives
 * with an id and no name, the board counts it and this must not also count it.
 */
export function useUnledShifts(weekEnding: string) {
  return useQuery({
    queryKey: ["scorecard-unled-shifts", weekEnding],
    queryFn: async (): Promise<UnledShifts> => {
      // The board's week is the seven days ending on the chosen Sunday, the same span
      // `scorecard_week_board` uses (`_week_ending - 6` to `_week_ending`).
      const start = new Date(`${weekEnding}T00:00:00Z`);
      start.setUTCDate(start.getUTCDate() - 6);

      const { data, error } = await supabase
        .from("production_sessions")
        .select("line")
        .is("leader_id", null)
        .is("leader_name", null)
        .gte("session_date", start.toISOString().slice(0, 10))
        .lte("session_date", weekEnding);
      if (error) throw error;
      return summariseUnledShifts(data ?? []);
    },
  });
}
