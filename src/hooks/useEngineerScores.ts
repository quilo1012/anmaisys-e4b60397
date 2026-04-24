import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface EngineerScore {
  id: string;
  engineer_id: string;
  score: number;
  updated_at: string;
  engineer_name?: string;
}

export function useEngineerScores() {
  return useQuery({
    queryKey: ["engineer_scores"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("engineer_scores")
        .select("*")
        .order("score", { ascending: false });
      if (error) throw error;

      // Fetch engineer names from both profiles and engineers tables
      const ids = (data as any[]).map((s: any) => s.engineer_id);
      if (!ids.length) return [] as EngineerScore[];

      const { data: profiles } = await supabase
        .from("profiles_safe" as any)
        .select("id, name")
        .in("id", ids);

      // engineers table has SELECT blocked by RLS; use the SECURITY DEFINER
      // RPC `list_engineer_names` which returns id+name (no PIN) for active
      // engineers. This is what makes the "Top Engineers" panel show real names
      // instead of "Unknown".
      const { data: engineers } = await (supabase as any).rpc("list_engineer_names");

      const nameMap: Record<string, string> = {};
      (profiles as any[])?.forEach((p: any) => { nameMap[p.id] = p.name; });
      // Engineers table takes priority (PIN identity = real engineer name)
      (engineers as any[])?.forEach((e: any) => { if (e.name) nameMap[e.id] = e.name; });

      return (data as any[]).map((s: any) => ({
        ...s,
        score: Math.max(0, Math.min(100, s.score ?? 0)),
        engineer_name: nameMap[s.engineer_id] || "Unknown",
      })) as EngineerScore[];
    },
    refetchInterval: 30_000,
  });
}
