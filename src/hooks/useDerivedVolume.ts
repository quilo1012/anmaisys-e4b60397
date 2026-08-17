import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { DerivedVolume } from "@/lib/derivedVolume";

/**
 * What production already recorded for this line and week, per
 * `scorecard_derived_volume` — so the same figure is not typed twice into two
 * modules that could then disagree.
 *
 * `as any` because `scorecard_derived_volume` is not in the generated
 * `src/integrations/supabase/types.ts` yet — its migration has not been applied to
 * the database (same escape as `useScorecardWeek.ts` and `useScorecardEntry.ts`;
 * drop the cast once the migration lands and the types are regenerated).
 *
 * Today the function does not exist, so this query errors — surfaced as `isError`,
 * never folded into "production has nothing" (`data === null`, no error). Those are
 * different facts: a person filling this in must be able to tell a failed lookup
 * from a genuinely empty week.
 */
export function useDerivedVolume(lineId: string | null, weekEnding: string) {
  return useQuery({
    queryKey: ["scorecard-derived-volume", lineId, weekEnding],
    enabled: Boolean(lineId),
    queryFn: async (): Promise<DerivedVolume | null> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC not in generated types yet
      const { data, error } = await (supabase as any).rpc("scorecard_derived_volume", {
        _line_id: lineId,
        _week_ending: weekEnding,
      });
      if (error) throw error;
      return (data?.[0] ?? null) as DerivedVolume | null;
    },
  });
}
