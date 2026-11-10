import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { identifyItemSku, type SkuCatalogue } from "@/lib/lineSku";
import {
  CLEAN_HISTORY_DAYS,
  cleanMinutesByLine,
  cleaningRule,
  type CleanDowntimeRow,
  type CleaningRule,
} from "@/lib/smartTargetCleaning";
import type { LineNo } from "@/lib/smartTargetEngine";

/**
 * What the deep and drill clean rule needs (Q81–Q83): how long each line's cleans took over
 * the last eight weeks, and each product's confirmed allergens (BLOCO 157). Before 157 the
 * allergens read fails quietly and the rule uses the name's suggestion.
 */
export function useCleaningBasis(catalogue: SkuCatalogue) {
  const query = useQuery({
    queryKey: ["smart_target_cleaning_basis"],
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const from = new Date(Date.now() - CLEAN_HISTORY_DAYS * 86_400_000).toISOString().slice(0, 10);
      const [stops, allergens] = await Promise.all([
        fetchAllRows<{ id: string; line: string | null; shift: string | null; downtime_date: string | null; occurred_date: string | null; reason: string | null; duration_minutes: number | null }>(
          supabase.from("production_downtimes").select("id, line, shift, downtime_date, occurred_date, reason, duration_minutes")
            .or("reason.ilike.%drill clean%,reason.ilike.%deep clean%")
            .gte("occurred_date", from)
            .order("id"),
        ),
        (async () => {
          try {
            return await fetchAllRows<{ id: string; code: string; allergens: string[] | null }>(
              // eslint-disable-next-line @typescript-eslint/no-explicit-any -- not in the generated types until BLOCO 157
              (supabase as any).from("sku_products").select("id, code, allergens").not("allergens", "is", null).order("code"),
            );
          } catch {
            return [];
          }
        })(),
      ]);
      const rows: CleanDowntimeRow[] = stops.map((s) => ({ line: s.line, shift: s.shift, date: s.downtime_date ?? s.occurred_date, reason: s.reason, duration_minutes: s.duration_minutes }));
      return { minutes: cleanMinutesByLine(rows), allergens: new Map(allergens.map((a) => [a.code.trim().toUpperCase(), a.allergens])) };
    },
  });

  const ruleFor = useMemo(() => {
    const data = query.data;
    if (!data) return null;
    const productOf = (sku: string) => {
      const row = identifyItemSku({ sku_id: null, sku_code_text: sku, actual: 0, started_at: null, finished_at: null }, catalogue);
      if (!row || row.uncatalogued) return null;
      return { name: row.name, allergens: data.allergens.get(String(row.code ?? sku).trim().toUpperCase()) ?? null };
    };
    const rules = new Map<LineNo, CleaningRule>();
    return (line: LineNo): CleaningRule => {
      if (!rules.has(line)) rules.set(line, cleaningRule(line, productOf, data.minutes));
      return rules.get(line)!;
    };
  }, [query.data, catalogue]);

  return { ruleFor, minutes: query.data?.minutes ?? null };
}
