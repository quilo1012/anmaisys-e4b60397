import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Tracks how many REACT_CRASH events have been captured since the admin last
// opened Root Diagnostics, so the sidebar can surface a badge instead of the
// admin having to open the page to discover a crash.
const SEEN_KEY = "rootDiagnosticsSeenAt";
const EPOCH = "1970-01-01T00:00:00.000Z";
export const TELEMETRY_BADGE_KEY = ["telemetry_crash_badge"] as const;

function getSeenAt(): string {
  try {
    return localStorage.getItem(SEEN_KEY) || EPOCH;
  } catch {
    return EPOCH;
  }
}

/** Call when the admin views Root Diagnostics — clears the badge from now on. */
export function markDiagnosticsSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, new Date().toISOString());
  } catch {
    /* ignore private-mode storage errors */
  }
}

/** Count of REACT_CRASH events newer than the last time the admin looked. */
export function useTelemetryCrashCount(enabled: boolean) {
  return useQuery({
    queryKey: TELEMETRY_BADGE_KEY,
    enabled,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { count, error } = await (supabase as unknown as {
        from: (t: string) => any;
      })
        .from("system_telemetry_logs")
        .select("id", { count: "exact", head: true })
        .eq("error_type", "REACT_CRASH")
        .gt("created_at", getSeenAt());
      if (error) throw error;
      return count ?? 0;
    },
  });
}

/** Mark seen and refresh the badge query so it drops to zero immediately. */
export function useMarkDiagnosticsSeen() {
  const qc = useQueryClient();
  return () => {
    markDiagnosticsSeen();
    qc.invalidateQueries({ queryKey: TELEMETRY_BADGE_KEY });
  };
}
