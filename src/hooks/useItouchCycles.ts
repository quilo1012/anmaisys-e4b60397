import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { CycleRecord } from "@/lib/smartTargetRates";

/**
 * iTouch's stored cycle times, read once and shared: the cycles card shows them and
 * the Smart Target page turns them into rates. One query key, so both read the same
 * cache instead of fetching 5000 rows twice.
 */

const PAGE = 1000;

export interface StoredCycles {
  records: CycleRecord[];
  source: string | null;
  importedAt: string | null;
}

/** Every stored row, a page at a time: PostgREST returns at most 1000 per request. */
export async function fetchStoredCycles(): Promise<StoredCycles> {
  const rows: { machine: string; sku: string; cycle_seconds: number | null; cavities: number | null; source: string; imported_at: string }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("itouch_cycle_times")
      .select("machine, sku, cycle_seconds, cavities, source, imported_at")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return {
    records: rows.map((r) => ({
      line: r.machine,
      sku: r.sku,
      cycleSeconds: r.cycle_seconds === null ? null : Number(r.cycle_seconds),
      cavities: r.cavities === null ? null : Number(r.cavities),
      source: r.source,
    })),
    source: rows[0]?.source ?? null,
    importedAt: rows.reduce<string | null>((max, r) => (max && max > r.imported_at ? max : r.imported_at), null),
  };
}

export function useItouchCycles() {
  return useQuery({ queryKey: ["itouch_cycle_times"], queryFn: fetchStoredCycles });
}
