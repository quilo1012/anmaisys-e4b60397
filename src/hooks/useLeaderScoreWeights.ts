import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_WEIGHTS, type LeaderScoreWeights } from "@/lib/leaderScore";

/**
 * How production, quality and documentation are weighted in the leader's final score.
 *
 * In the database rather than the source because it is a management judgement, not a
 * technical constant — the same reason severity points moved. The three must total
 * 100; the check constraint enforces it, so a half-saved edit cannot leave the score
 * quietly scaled wrong.
 */
export function useLeaderScoreWeights() {
  return useQuery({
    queryKey: ["leader_score_weights"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<LeaderScoreWeights> => {
      const { data, error } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not in generated types yet
        .from("leader_score_weights" as any)
        .select("production_pct, quality_pct, documentation_pct")
        .maybeSingle();
      if (error) throw error;
      return (data as unknown as LeaderScoreWeights) ?? DEFAULT_WEIGHTS;
    },
  });
}

export function useUpdateLeaderScoreWeights() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (w: LeaderScoreWeights) => {
      const { error } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not in generated types yet
        .from("leader_score_weights" as any)
        .update({ ...w, updated_at: new Date().toISOString() })
        .eq("id", true);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leader_score_weights"] });
      qc.invalidateQueries({ queryKey: ["ls_actions"] });
    },
  });
}
