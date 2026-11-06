import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { shiftWindow, type ShiftType } from "@/lib/smartTargetEngine";
import { reportRefreshMs, type DowntimeRow, type StatusRow } from "@/lib/shiftReport";

/** Everything the shift report reads beyond the forecast: stops, the machine's log, the RAG plan. */
export function useShiftReportData(date: string, shift: ShiftType) {
  const window = shiftWindow(date, shift);
  const refreshMs = reportRefreshMs(window, Date.now());
  return useQuery({
    queryKey: ["smart_target_shift_report", date, shift],
    refetchInterval: refreshMs,
    // Coming back to the tab is no reason to read eighteen hours of log for a closed shift.
    refetchOnWindowFocus: refreshMs !== false,
    queryFn: async () => {
      const [downtimes, status, rag, comments, leaders] = await Promise.all([
        fetchAllRows<DowntimeRow & { id: string }>(
          supabase.from("production_downtimes").select("id, line, shift, reason, category, duration_minutes")
            .or(`downtime_date.eq.${date},and(downtime_date.is.null,occurred_date.eq.${date})`)
            .eq("shift", shift).order("id"),
        ),
        // Six hours either side: back for the state each line began in, forward to see whether
        // a silence at the end of the shift ended with it or carried on.
        window
          ? fetchAllRows<StatusRow & { id: number }>(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (supabase as any).from("intouch_status_log").select("id, line, status, changed_at")
              .gte("changed_at", new Date(window.startMs - 6 * 3_600_000).toISOString())
              .lt("changed_at", new Date(window.endMs + 6 * 3_600_000).toISOString()).order("id"),
          )
          : Promise.resolve([]),
        supabase.from("rag_weekly_entries").select("line, plan_qty").eq("entry_date", date).eq("shift", shift),
        supabase.from("rag_weekly_comments").select("line, comment").eq("entry_date", date),
        supabase.from("production_sessions").select("line, leader_name").eq("session_date", date).eq("shift", shift),
      ]);
      return {
        downtimes,
        status,
        rag: rag.data ?? [],
        comments: comments.data ?? [],
        leaders: leaders.data ?? [],
      };
    },
  });
}
