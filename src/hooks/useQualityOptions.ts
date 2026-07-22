import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { QUALITY_LABELS, QUALITY_DEPARTMENTS } from "@/lib/qualityConstants";

export interface QualityOption {
  id: string;
  kind: "label" | "department";
  value: string;
  active: boolean;
  sort: number;
}

/** All option rows (both kinds, incl. inactive) — for the admin manager UI. */
export function useAllQualityOptions() {
  return useQuery({
    queryKey: ["quality_options_all"],
    queryFn: async () => {
      const { data, error } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not in generated types yet
        .from("quality_options" as any)
        .select("id, kind, value, active, sort")
        .order("kind")
        .order("sort")
        .order("value");
      if (error) throw error;
      return (data ?? []) as unknown as QualityOption[];
    },
  });
}

/** Active label + department values for the pickers, with constant fallback. */
export function useQualityOptions() {
  return useQuery({
    queryKey: ["quality_options"],
    queryFn: async () => {
      const { data, error } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not in generated types yet
        .from("quality_options" as any)
        .select("kind, value")
        .eq("active", true)
        .order("sort")
        .order("value");
      if (error) throw error;
      const rows = (data ?? []) as unknown as { kind: string; value: string }[];
      const labels = rows.filter((r) => r.kind === "label").map((r) => r.value);
      const departments = rows.filter((r) => r.kind === "department").map((r) => r.value);
      return {
        labels: labels.length ? labels : [...QUALITY_LABELS],
        departments: departments.length ? departments : [...QUALITY_DEPARTMENTS],
      };
    },
  });
}
