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
    queryKey: ["engineer_scores", "v2"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("engineer_scores")
        .select("*")
        .order("score", { ascending: false });
      if (error) throw error;

      const ids = (data as any[]).map((s: any) => s.engineer_id);
      if (!ids.length) return [] as EngineerScore[];

      // Resolve names from BOTH sources in parallel:
      // - `engineers` (PIN identity) via SECURITY DEFINER RPC `list_engineer_names`
      // - `profiles_safe` (auth user identity) for engineers that login via email
      // We fetch ALL active rows (no `.in()` filter) because list_engineer_names
      // doesn't accept arguments — then build a map locally.
      const [enginRes, profRes] = await Promise.all([
        (supabase as any).rpc("list_engineer_names"),
        supabase.from("profiles_safe" as any).select("id, name, email").in("id", ids),
      ]);

      const nameMap: Record<string, string> = {};

      // 1) Lower priority: profile name/email (auth identity)
      (profRes.data as any[])?.forEach((p: any) => {
        if (p.name) nameMap[p.id] = p.name;
        else if (p.email) nameMap[p.id] = p.email;
      });

      // 2) Higher priority: engineers table (PIN-based identity = real operator)
      (enginRes.data as any[])?.forEach((e: any) => {
        if (e.name) nameMap[e.id] = e.name;
      });

      return (data as any[]).map((s: any) => ({
        ...s,
        score: Math.max(0, Math.min(100, s.score ?? 0)),
        engineer_name: nameMap[s.engineer_id] || "Unknown",
      })) as EngineerScore[];
    },
    refetchInterval: 30_000,
    staleTime: 0,
  });
}
