import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { DerivedVolume } from "@/lib/derivedVolume";

/**
 * What production already recorded for this line and week, per
 * `scorecard_derived_volume` — so the same figure is not typed twice into two
 * modules that could then disagree.
 *
 * `leaderId` narrows it to the (day, shift) pairs that THIS person opened on this
 * line. Without it the function still answers, and answers with the whole line —
 * which on a line with four leaders is the work of four people offered to each of
 * them. `rag_weekly_entries` and `production_sessions` are both keyed by
 * (line, shift, day), so this is a selection of the same rows, not a share-out.
 *
 * `as any` because `scorecard_derived_volume` is not in the generated
 * `src/integrations/supabase/types.ts` yet — its migration has not been applied to
 * the database (same escape as `useScorecardWeek.ts` and `useScorecardEntry.ts`;
 * drop the cast once the migration lands and the types are regenerated).
 *
 * A failed lookup is surfaced as `isError`, never folded into "production has
 * nothing" (`data === null`, no error). Those are different facts: a person filling
 * this in must be able to tell one from the other. (The older note here said the
 * function did not exist in the database — sondado a 11/09/2026, existe e responde;
 * o que faltava era o parametro do lider.)
 */
export function useDerivedVolume(
  lineId: string | null,
  weekEnding: string,
  leaderId: string | null,
) {
  return useQuery({
    queryKey: ["scorecard-derived-volume", lineId, weekEnding, leaderId],
    enabled: Boolean(lineId),
    queryFn: async (): Promise<DerivedVolume | null> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC not in generated types yet
      const { data, error } = await (supabase as any).rpc("scorecard_derived_volume", {
        _line_id: lineId,
        _week_ending: weekEnding,
        _leader_id: leaderId,
      });
      if (error) throw error;
      return (data?.[0] ?? null) as DerivedVolume | null;
    },
  });
}
