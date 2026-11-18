import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type TelemetryLog = {
  id: string; created_at: string; user_id: string | null; user_role: string | null;
  error_type: string; message: string; stack_trace: string | null; route_path: string | null;
  metadata: Record<string, unknown> | null;
};

export const PUSH_STATE_ROWS_KEY = ["telemetry-push-state"] as const;

/**
 * How far back a device's reading still counts. A phone writes one a day while it is used;
 * one that has not written in two weeks has left the app, and its last word is history.
 */
const WINDOW_DAYS = 14;

/**
 * The PUSH_STATE rows of the last two weeks, newest first, for Phone Notifications and for
 * the faults Root Diagnostics still lists. Read on their own so the factory's ~40 phones a
 * day cannot crowd errors out of Root Diagnostics' newest 200.
 */
export function usePushStateRows() {
  return useQuery({
    queryKey: PUSH_STATE_ROWS_KEY,
    queryFn: async () => {
      const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await (supabase as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            eq: (k: string, v: string) => {
              gte: (k: string, v: string) => {
                order: (k: string, o: { ascending: boolean }) => {
                  limit: (n: number) => Promise<{ data: TelemetryLog[] | null; error: unknown }>;
                };
              };
            };
          };
        };
      })
        .from("system_telemetry_logs")
        .select("id, created_at, user_id, user_role, error_type, message, stack_trace, route_path, metadata")
        .eq("error_type", "PUSH_STATE")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(2000);
      if (error) throw error;
      return data ?? [];
    },
  });
}
