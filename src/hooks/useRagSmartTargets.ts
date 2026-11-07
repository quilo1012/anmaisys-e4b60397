import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ragSmartKey, type RagShift, type RagSmartMap } from "@/lib/ragSmartTarget";

/**
 * The Smart Targets kept for a week, for the RAG board. Only read for those who may see the
 * Smart Target (Q74); the table's policy refuses everyone else anyway. Undefined means the
 * rows are not shown at all.
 */
export function useRagSmartTargets(from: string, to: string, allowed: boolean): RagSmartMap | undefined {
  const { data } = useQuery({
    queryKey: ["rag-smart-targets", from, to],
    enabled: allowed,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("smart_target_forecasts")
        .select("session_date, shift, line, expected_total, frozen_at, source")
        .gte("session_date", from)
        .lte("session_date", to)
        .not("expected_total", "is", null)
        .order("session_date");
      if (error) throw error;
      const map: RagSmartMap = new Map();
      for (const r of (data ?? []) as { session_date: string; shift: RagShift; line: number; expected_total: number; frozen_at: string; source: string | null }[]) {
        map.set(ragSmartKey(r.session_date, `Line ${r.line}`, r.shift), { expected: Number(r.expected_total), setAt: r.frozen_at, source: r.source });
      }
      return map;
    },
  });
  return allowed ? data : undefined;
}
