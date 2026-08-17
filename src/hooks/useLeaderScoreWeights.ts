import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_WEIGHTS, type LeaderScoreWeights } from "@/lib/leaderScore";
import { chooseWeights, type WeightVersionRow } from "@/lib/leaderScoreWeights";

/**
 * How production, quality and documentation are weighted in the leader's final score.
 *
 * In the database rather than the source because it is a management judgement, not a
 * technical constant — the same reason severity points moved. The three must total
 * 100; the check constraint enforces it, so a half-saved edit cannot leave the score
 * quietly scaled wrong.
 */
export function useLeaderScoreWeights(asOf?: string) {
  return useQuery({
    queryKey: ["leader_score_weights", asOf ?? "now"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<LeaderScoreWeights> => {
      const { data, error } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not in generated types yet
        .from("leader_score_weights" as any)
        .select("production_pct, quality_pct, documentation_pct")
        .maybeSingle();
      if (error) throw error;
      const editing = (data as unknown as LeaderScoreWeights) ?? null;

      // No date asked for: the caller is the editing screen, which is about what the
      // weights ARE, not what they were. Nothing to resolve.
      if (!asOf) return editing ?? DEFAULT_WEIGHTS;

      /**
       * The dated versions, when this database has them.
       *
       * A missing table is not an error to report: `leader_scorecard_threshold` gains
       * its W_* rows only with 20260818090000, and until that migration is applied the
       * editing surface is the only record of the decision there is. Refusing to score
       * would be worse than scoring on the value the factory is actually using — and
       * `chooseWeights` makes that fallback the explicit second choice rather than an
       * accident.
       */
      const versioned = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not in generated types yet
        .from("leader_scorecard_threshold" as any)
        .select("name, value, valid_from, valid_to")
        .in("name", ["W_Production", "W_Quality", "W_Documentation"]);

      return chooseWeights(
        versioned.error ? null : (versioned.data as unknown as WeightVersionRow[]),
        editing,
        asOf,
      );
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
