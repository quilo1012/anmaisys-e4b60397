import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type TimeBasis = "unconfirmed" | "per_unit" | "per_cycle";
export interface SkuFillTime {
  id: string; machine_name: string; sku_code: string; product_description: string;
  imported_current_seconds: number | null; suggested_seconds: number | null; median_seconds: number | null;
  sample_shifts: number | null; approved_seconds: number | null; time_basis: TimeBasis; units_per_cycle: number | null;
}
// Table lives in AN Maintenance only after APLICAR-sku-fill-times.sql; not in generated types yet.
const db = supabase as unknown as { from: (t: string) => any };
const KEY = ["sku-fill-times"];

/** null = table not activated in this database yet. */
export function useSkuFillTimes() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<SkuFillTime[] | null> => {
      const rows: SkuFillTime[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await db.from("sku_fill_times").select("*").order("machine_name").order("sku_code").range(from, from + 999);
        if (error) { if (error.code === "42P01" || error.code === "PGRST205") return null; throw error; }
        rows.push(...(data ?? []));
        if (!data || data.length < 1000) break;
      }
      return rows;
    },
  });
}

export function useApproveSkuFillTime() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { id: string; approved_seconds: number | null; time_basis: TimeBasis; units_per_cycle: number | null }) => {
      const { id, ...patch } = p;
      const { data, error } = await db.from("sku_fill_times").update(patch).eq("id", id).select("id, approved_seconds, time_basis, units_per_cycle").single();
      if (error) throw error;
      if (!data || Number(data.approved_seconds) !== Number(patch.approved_seconds) || data.time_basis !== patch.time_basis || data.units_per_cycle !== patch.units_per_cycle) throw new Error("The approved standard was not saved. Please reload and try again.");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** Registers (or updates) the real fill time of a SKU on a line or machine. */
export function useRegisterSkuFillTime() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { machine_name: string; sku_code: string; product_description: string; approved_seconds: number; time_basis: TimeBasis; units_per_cycle: number | null }) => {
      const { data: existing, error: e1 } = await db.from("sku_fill_times").select("id").eq("machine_name", p.machine_name).eq("sku_code", p.sku_code).maybeSingle();
      if (e1) throw e1;
      const { data, error } = existing
        ? await db.from("sku_fill_times").update({ approved_seconds: p.approved_seconds, time_basis: p.time_basis, units_per_cycle: p.units_per_cycle }).eq("id", existing.id).select("id, approved_seconds, time_basis, units_per_cycle").single()
        : await db.from("sku_fill_times").insert(p).select("id, approved_seconds, time_basis, units_per_cycle").single();
      if (error) throw error;
      if (!data || Number(data.approved_seconds) !== p.approved_seconds || data.time_basis !== p.time_basis || data.units_per_cycle !== p.units_per_cycle) throw new Error("The approved standard was not saved. Please reload and try again.");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
