import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ScorecardBoardRow } from "@/lib/scorecardWeek";

/**
 * The week's board: one row per leader-line assignment, as `scorecard_week_board`
 * computes it server-side. Nothing here recomputes a RAG, a score or a ceiling —
 * that is the database's job; this hook only carries the rows across the wire.
 *
 * `as any` on the RPC call because `scorecard_week_board` is not yet in the
 * generated `src/integrations/supabase/types.ts` — its migration has not been
 * applied to the database. This is the same escape already used elsewhere in the
 * repo (see `useLeaderScoreWeights.ts`, `useLoginBranding.ts`); drop the cast once
 * the migration lands and the types are regenerated.
 */
export function useScorecardWeek(weekEnding: string) {
  return useQuery({
    queryKey: ["scorecard-week", weekEnding],
    queryFn: async (): Promise<ScorecardBoardRow[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC not in generated types yet
      const { data, error } = await (supabase as any).rpc("scorecard_week_board", {
        _week_ending: weekEnding,
      });
      if (error) throw error;
      return (data ?? []) as ScorecardBoardRow[];
    },
  });
}
