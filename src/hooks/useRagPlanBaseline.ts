import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { planAtStart } from "@/lib/smartTargetAccuracy";
import { shiftWindow, type ShiftType } from "@/lib/smartTargetEngine";

/**
 * The RAG plan of Lines 1–6 as it stood when each shift started, keyed `date|SHIFT|line`
 * (Q88). Plans written after the shift began are left out: they are not forecasts.
 */
export function useRagPlanBaseline(from: string, to: string, enabled: boolean) {
  return useQuery({
    queryKey: ["rag_plan_baseline", from, to],
    enabled,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const entries = await fetchAllRows<{ id: string; entry_date: string; shift: string; line: string; plan_qty: number | null; created_at: string }>(
        supabase.from("rag_weekly_entries").select("id, entry_date, shift, line, plan_qty, created_at")
          .gte("entry_date", from).lte("entry_date", to).like("line", "Line %").order("id"),
      );
      const ids = entries.map((e) => e.id);
      const changes = new Map<string, { changed_at: string; before_qty: number | null; kind: string }[]>();
      for (let i = 0; i < ids.length; i += 300) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- rpc not in the generated types
        const { data, error } = await (supabase as any).rpc("rag_plan_history", { _entry_ids: ids.slice(i, i + 300) });
        if (error) throw error;
        for (const r of (data ?? []) as { entry_id: string; changed_at: string; before_qty: number | null; kind: string }[]) {
          changes.set(r.entry_id, [...(changes.get(r.entry_id) ?? []), r]);
        }
      }
      const plans = new Map<string, number>();
      for (const e of entries) {
        const line = /^Line ([1-6])$/.exec(e.line)?.[1];
        const w = shiftWindow(e.entry_date, e.shift as ShiftType);
        if (!line || !w) continue;
        const p = planAtStart(e, changes.get(e.id) ?? [], w.startMs);
        if (p !== null) plans.set(`${e.entry_date}|${e.shift}|${line}`, p);
      }
      return plans;
    },
  });
}
