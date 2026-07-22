import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export const ISHIKAWA_CATEGORIES = ["Man", "Machine", "Method", "Material", "Measurement", "Environment"] as const;
export type IshikawaCategory = (typeof ISHIKAWA_CATEGORIES)[number];

export const CAPA_STATUSES = [
  { value: "open", label: "Open", badge: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/40" },
  { value: "in_progress", label: "In progress", badge: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/40" },
  { value: "verifying", label: "Verifying", badge: "bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/40" },
  { value: "closed", label: "Closed", badge: "bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/40" },
] as const;

export interface QualityCapa {
  id: string;
  action_id: string;
  capa_no: string | null;
  problem: string | null;
  five_whys: string[];
  root_cause: string | null;
  ishikawa: Record<string, string>;
  action_plan: string | null;
  responsible: string | null;
  due_date: string | null;
  status: string;
  effectiveness: string | null;
  effectiveness_ok: boolean | null;
  verified_by: string | null;
  verified_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export function useQualityCapa(actionId?: string) {
  return useQuery({
    queryKey: ["quality_capa", actionId],
    enabled: !!actionId,
    queryFn: async () => {
      const { data, error } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not in generated types yet
        .from("quality_capa" as any)
        .select("*")
        .eq("action_id", actionId as string)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as unknown as QualityCapa | null;
    },
  });
}

export type CapaSaveInput = Partial<Omit<QualityCapa, "id" | "action_id" | "created_at" | "updated_at" | "created_by">>
  & { id?: string; action_id: string };

export function useSaveCapa() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ id, ...fields }: CapaSaveInput) => {
      if (id) {
        const { error } = await supabase
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not in generated types yet
          .from("quality_capa" as any)
          .update(fields as unknown as never)
          .eq("id", id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not in generated types yet
          .from("quality_capa" as any)
          .insert({ ...fields, created_by: user?.id ?? null } as unknown as never);
        if (error) throw error;
      }
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ["quality_capa", v.action_id] }),
  });
}
