import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface RagPlanHistoryRow {
  entry_id: string;
  changed_at: string;
  user_name: string | null;
  before_qty: number | null;
  after_qty: number | null;
  /**
   * 'line' — the line/shift plan itself was edited.
   * 'sku'  — a SKU target was edited, which feeds the line plan through
   *          sync_items_target_from_rag. Same cell, different level.
   */
  kind: "line" | "sku";
  sku_code: string | null;
  sku_name: string | null;
}

/**
 * Target-change history for the RAG Weekly board.
 *
 * One request per week — never one per cell. The whole set of visible entry ids
 * goes down in a single `rag_plan_history` call and comes back keyed by entry id,
 * so each Plan cell reads from the map instead of asking the server.
 *
 * `audit_logs` itself is admin-only (see the "Admins can view audit logs" policy),
 * so this goes through a SECURITY DEFINER function that returns nothing but
 * plan-target changes for RAG entries, to callers who can already read the board.
 */
export function useRagPlanHistory(entryIds: string[], enabled = true) {
  const ids = useMemo(() => Array.from(new Set(entryIds.filter(Boolean))).sort(), [entryIds]);

  const q = useQuery({
    // Keyed by the id set, so navigating weeks refetches and returning is cached.
    queryKey: ["rag-plan-history", ids],
    enabled: enabled && ids.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<RagPlanHistoryRow[]> => {
      const { data, error } = await (supabase as any).rpc("rag_plan_history", { _entry_ids: ids });
      if (error) throw error;
      return (data ?? []) as RagPlanHistoryRow[];
    },
  });

  const byEntry = useMemo(() => {
    const m = new Map<string, RagPlanHistoryRow[]>();
    for (const r of q.data ?? []) {
      const list = m.get(r.entry_id);
      if (list) list.push(r);
      else m.set(r.entry_id, [r]);
    }
    // Newest first — the whole story, not just the last hop.
    for (const list of m.values()) {
      list.sort((a, b) => new Date(b.changed_at).getTime() - new Date(a.changed_at).getTime());
    }
    return m;
  }, [q.data]);

  return { byEntry, isLoading: q.isLoading, isError: q.isError, error: q.error };
}
