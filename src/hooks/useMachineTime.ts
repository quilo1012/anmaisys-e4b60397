import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAllRows";
import {
  MACHINE_TIME_LOOKBACK_MS,
  MAX_MACHINE_TIME_DAYS,
  machineTimeByLine,
  machineTimeWindows,
  periodDays,
  plannedLookup,
  type MachineLogRow,
} from "@/lib/machineTime";

/**
 * Machine time (run, planned and unplanned stops) for the period and shift being
 * shown, from iTouching's machine log. See `machineTime.ts`.
 *
 * `line` narrows the read to one line; null reads every line. Periods longer than
 * {@link MAX_MACHINE_TIME_DAYS} are not read at all (`tooLong`), so picking "All time"
 * does not page a hundred thousand log rows into the browser.
 *
 * The log is readable by admin, manager, production office, maintenance manager and
 * engineer. For anybody else the read comes back empty and the panel says there is
 * nothing logged, which is what that user can see.
 */
export function useMachineTime(params: { from: string; to: string; shift: string; line: string | null }) {
  const { from, to, shift, line } = params;
  const days = periodDays(from, to);
  const tooLong = days > MAX_MACHINE_TIME_DAYS;
  const query = useQuery({
    queryKey: ["production_control_machine_time", from, to, shift, line],
    enabled: days > 0 && !tooLong,
    // A closed period does not move; an open one moves with the poll, every few minutes.
    staleTime: 2 * 60_000,
    queryFn: async () => {
      const windows = machineTimeWindows(from, to, shift);
      const nowMs = Date.now();
      if (!windows.length || windows[0].startMs >= nowMs) return [];
      const lo = new Date(windows[0].startMs - MACHINE_TIME_LOOKBACK_MS).toISOString();
      const hi = new Date(Math.min(windows[windows.length - 1].endMs, nowMs)).toISOString();
      const [rows, codes] = await Promise.all([
        fetchAllRows<MachineLogRow>({
          range: (a, b) => {
            let q = supabase
              .from("intouch_status_log")
              .select("line, status, stop_label, changed_at")
              .gte("changed_at", lo)
              .lt("changed_at", hi);
            if (line) q = q.eq("line", line);
            // `id` after the time, so two rows on one instant cannot swap between pages.
            return q.order("changed_at", { ascending: true }).order("id", { ascending: true }).range(a, b);
          },
        }),
        supabase.from("intouch_stop_code_catalog").select("name, planned"),
      ]);
      if (codes.error) throw codes.error;
      return machineTimeByLine(rows, windows, plannedLookup(codes.data ?? []), nowMs);
    },
  });
  return { ...query, tooLong, days };
}
