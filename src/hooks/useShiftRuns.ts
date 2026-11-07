import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ShiftRun } from "@/lib/shiftOutcome";

/** Keyed like the RAG cells: `date|Line N|SHIFT`. */
export type ShiftRuns = Map<string, ShiftRun>;

/**
 * When each line last ran in each shift (BLOCO 154). Before the block is pasted it answers
 * an empty map, and the pages compare with the whole shift's target as before.
 */
export function useShiftRuns(from: string, to: string, enabled: boolean): ShiftRuns {
  const { data } = useQuery({
    queryKey: ["smart_target_shift_runs", from, to],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ShiftRuns> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("smart_target_shift_runs", { p_from: from, p_to: to });
      if (error) {
        if (error.code === "PGRST202" || error.code === "42883") return new Map();
        throw error;
      }
      const out: ShiftRuns = new Map();
      for (const r of (data ?? []) as { session_date: string; shift: string; line: string; last_run_at: string | null; heard_until: string | null }[]) {
        out.set(`${r.session_date}|${r.line}|${r.shift}`, { lastRunAt: r.last_run_at, heardUntil: r.heard_until });
      }
      return out;
    },
  });
  return data ?? new Map();
}
