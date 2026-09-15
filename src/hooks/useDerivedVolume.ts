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
 * The call is typed. `scorecard_derived_volume` IS in the generated
 * `src/integrations/supabase/types.ts`, `_leader_id` included, so the `as any` that
 * used to sit here bought nothing and cost the one check that mattered: while the
 * cast was in place, the call passed two arguments to a three-argument function and
 * nothing said a word. The cast that remains is on the returned ROW — the generator
 * types every column non-null, but these are `sum()`s over a possibly empty set and
 * really do come back null.
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
      const { data, error } = await supabase.rpc("scorecard_derived_volume", {
        _line_id: lineId as string,
        _week_ending: weekEnding,
        _leader_id: leaderId ?? undefined,
      });
      if (error) throw error;
      return (data?.[0] ?? null) as DerivedVolume | null;
    },
  });
}
