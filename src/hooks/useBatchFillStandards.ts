import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { batchFillStandards, type BatchRun, type StopWindow } from "@/lib/batchFillStandards";

const LIMIT = 20_000;

/** Completed batches (start and finish recorded) and the stops inside them, last `days` days. */
export function useBatchFillStandards(days = 90) {
  return useQuery({
    queryKey: ["batch-fill-standards", days],
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
      const db = supabase as any;
      const items = await fetchAllRows<any>({ range: (lo, hi) => db.from("production_items")
        .select("id, actual_qty, batch_code, sku_code_text, started_at, finished_at, sku_products(code, name), production_sessions!inner(line, session_date)")
        .gt("actual_qty", 0)
        .gte("production_sessions.session_date", since).order("id").range(lo, hi) }, LIMIT);
      const stops = await fetchAllRows<any>({ range: (lo, hi) => db.from("production_downtimes")
        .select("id, line, occurred_date, started_at, ended_at, duration_minutes")
        .gte("occurred_date", since).order("id").range(lo, hi) }, LIMIT);
      const batches: BatchRun[] = items.map((r) => ({ line: r.production_sessions?.line ?? "", sku: r.sku_products?.code ?? r.sku_code_text ?? "", name: r.sku_products?.name ?? null, batch: r.batch_code ?? null, date: r.production_sessions?.session_date ?? "", startedAt: r.started_at ?? "", finishedAt: r.finished_at ?? "", quantity: Number(r.actual_qty) }));
      const windows: StopWindow[] = stops.map((s) => ({ line: s.line, date: s.occurred_date, startedAt: s.started_at, endedAt: s.ended_at, durationMinutes: Number(s.duration_minutes) }));
      const standards = batchFillStandards(batches, windows);
      const used = standards.reduce((n, s) => n + s.samples.length, 0);
      return { standards, runs: batches, windows, batches: batches.length, excluded: batches.length - used, truncated: items.length >= LIMIT || stops.length >= LIMIT };
    },
  });
}
