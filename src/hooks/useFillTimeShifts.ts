import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { FillShift } from "@/lib/fillTimes";

const PAGE = 1000;

/** Per-shift run minutes and units per product from `sku_production_history`, last `days` days. */
export function useFillTimeShifts(days = 90) {
  return useQuery({
    queryKey: ["fill-time-shifts", days],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<FillShift[]> => {
      const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
      const out: FillShift[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from("sku_production_history")
          .select("quantity, run_minutes, lines(name), sku_products(code, name)")
          .gte("session_date", since)
          .order("id")
          .range(from, from + PAGE - 1);
        if (error) throw error;
        for (const r of (data ?? []) as unknown as { quantity: number; run_minutes: number; lines: { name: string } | null; sku_products: { code: string; name: string } | null }[]) {
          out.push({ line: r.lines?.name, sku: r.sku_products?.code, name: r.sku_products?.name, quantity: r.quantity, runMinutes: r.run_minutes });
        }
        if (!data || data.length < PAGE) break;
      }
      return out;
    },
  });
}
