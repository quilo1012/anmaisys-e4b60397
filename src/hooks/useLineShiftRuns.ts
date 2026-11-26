import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ShiftRun } from "@/lib/lineShiftPerformance";

const PAGE = 1000;

/** Per-shift run minutes and units per product, from `sku_production_history`. */
export function useLineShiftRuns(days = 30) {
  return useQuery({
    queryKey: ["line-shift-runs", days],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ShiftRun[]> => {
      const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
      const out: ShiftRun[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from("sku_production_history")
          .select("session_date, shift, quantity, run_minutes, lines(name), sku_products(code, name)")
          .gte("session_date", since)
          .order("id")
          .range(from, from + PAGE - 1);
        if (error) throw error;
        for (const r of (data ?? []) as unknown as { session_date: string; shift: string; quantity: number; run_minutes: number; lines: { name: string } | null; sku_products: { code: string; name: string } | null }[]) {
          out.push({ date: r.session_date, shift: r.shift, line: r.lines?.name ?? "", sku: r.sku_products?.code ?? "", name: r.sku_products?.name ?? null, quantity: Number(r.quantity), runMinutes: Number(r.run_minutes) });
        }
        if (!data || data.length < PAGE) break;
      }
      return out;
    },
  });
}
