import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { factorWindow, type HistoryItem } from "@/lib/smartTargetHistory";
import type { SmartTargetSession } from "@/lib/smartTargetInput";

/**
 * The closed shifts Smart Target learns each line's performance from: the eight weeks
 * before the forecast date, quantities only.
 *
 * Eight weeks is several hundred sessions and over a thousand items, past PostgREST's
 * 1000-row cap, so both reads are paged and ordered. A short read would hand the factor
 * the oldest shifts and silently drop the newest.
 */

/** Ids per `.in()` request, so the URL stays well under any length limit. */
const IDS_PER_REQUEST = 150;

export function useSmartTargetHistory(date: string) {
  const { from, to } = factorWindow(date);
  return useQuery({
    queryKey: ["smart_target_history", from, to],
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const sessions = await fetchAllRows<SmartTargetSession>(
        supabase
          .from("production_sessions")
          .select("id, line, session_date, shift, started_at")
          .gte("session_date", from)
          .lte("session_date", to)
          .order("id"),
      );
      const ids = sessions.map((s) => s.id);
      const items: HistoryItem[] = [];
      for (let i = 0; i < ids.length; i += IDS_PER_REQUEST) {
        items.push(
          ...(await fetchAllRows<HistoryItem>(
            supabase
              .from("production_items")
              .select("session_id, display_order, sku_id, sku_code_text, actual_qty")
              .in("session_id", ids.slice(i, i + IDS_PER_REQUEST))
              .order("id"),
          )),
        );
      }
      return { sessions, items, from, to };
    },
  });
}
