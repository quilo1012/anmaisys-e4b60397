import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * What iTouching says every line is doing, right now — for whoever is asking.
 *
 * ONE HOOK BECAUSE ONE ANSWER. The production board and the Control Centre both
 * paint a live state per line, and when they read separately they drift: on 13/08
 * the board named four stops that the Control Centre, reading work orders instead,
 * was printing as "Running". Both screens now pull the same rows through the same
 * query key, so react-query hands them the same object and they cannot disagree.
 *
 * Read from `v_line_live_status`, not from `intouch_machine_map`: that table is
 * readable by four roles and these screens by seven, so a supervisor would
 * otherwise get an empty pill on every card and no reason why.
 *
 * Deliberately independent of any period filter. This is about the minute you are
 * standing in, and a line can be behind for the shift and running perfectly now.
 */
export interface LineLiveRow {
  line: string;
  machine: string | null;
  status: number | null;
  reason: string | null;
  planned: boolean | null;
  seen_at: string | null;
  stop_since: string | null;
  job_code: string | null;
  job_name: string | null;
  job_state: string | null;
  job_seen_at: string | null;
}

export function useLineLiveStatus() {
  return useQuery({
    queryKey: ["line-live-status"],
    refetchInterval: 20_000,
    refetchIntervalInBackground: false,
    queryFn: async (): Promise<LineLiveRow[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the view is newer than the generated types
      const { data, error } = await (supabase as any)
        .from("v_line_live_status")
        .select("line, machine, status, reason, planned, seen_at, stop_since, job_code, job_name, job_state, job_seen_at");
      if (error) throw error;
      return (data ?? []) as LineLiveRow[];
    },
  });
}
