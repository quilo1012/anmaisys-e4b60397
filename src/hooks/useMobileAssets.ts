import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type MobileAssetType = "printer" | "bag_sealer";

export interface MobileAsset {
  id: string;
  asset_type: MobileAssetType;
  asset_number: number;
  current_line_id: string | null;
  active: boolean;
  created_at: string;
}

export function useMobileAssets() {
  return useQuery({
    queryKey: ["mobile_assets"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("mobile_assets")
        .select("*")
        .eq("active", true)
        .order("asset_type")
        .order("asset_number");
      if (error) throw error;
      return data as MobileAsset[];
    },
    staleTime: 5 * 60_000,
  });
}

export function formatMobileAsset(a: MobileAsset) {
  const label = a.asset_type === "printer" ? "Printer" : "Bag Sealer";
  return `${label} ${a.asset_number}`;
}

export function useUpsertMobileAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<MobileAsset> & { asset_type: MobileAssetType; asset_number: number }) => {
      const { data, error } = await (supabase as any)
        .from("mobile_assets")
        .upsert(input, { onConflict: "asset_type,asset_number" })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mobile_assets"] }),
  });
}
