import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isMissingTable } from "@/lib/postgrestErrors";

/**
 * Whether this database freezes an action's points at the scale of its own day.
 *
 * `scoring_version` arrives with 20260822090000. Until it does, points are derived on
 * every render from the live weights, and re-pricing a label genuinely does re-score
 * July — so the warning the lists manager prints has to be the true one for whichever
 * database it is running against.
 *
 * That is the whole reason this exists rather than the screen simply being told the new
 * text. A migration is applied by hand here, by a person, through the Lovable chat; the
 * frontend ships on its own schedule and can arrive first. A screen hard-coded to say
 * "actions already logged keep their points" on a database with no scoring_version would
 * be a promise the database is not keeping, printed on the exact screen where somebody
 * is about to change a number on that promise. Detecting it costs one cached query.
 *
 * Shaped like `useLeaderAttribution`, deliberately: same question ("has this migration
 * landed"), same answer shape, same screen. See its `missing` for the reasoning.
 */
export interface ScoringFreezeState {
  /** Points are frozen at creation. False while the query is in flight. */
  frozen: boolean;
  /** The reading is settled — `frozen` can be trusted. */
  ready: boolean;
  /**
   * The table is not there: the migration has not been applied to this database.
   *
   * Separate from a plain failure for the reason `useLeaderAttribution.missing` is —
   * it has one specific, actionable cause, while every other failure is transient or a
   * permission problem.
   */
  missing: boolean;
}

export function useScoringFreeze(): ScoringFreezeState {
  const query = useQuery({
    queryKey: ["scoring_version_in_force"],
    staleTime: 5 * 60 * 1000,
    retry: false,
    // The throw below is how this hook READS its answer, not a failure to announce.
    // Without this the global queryCache handler put "Something did not load — Could
    // not find the table 'public.scoring_version'" over every screen carrying the
    // hook, on exactly the databases the hook was written to cope with.
    meta: { schemaOptional: true },
    queryFn: async (): Promise<{ id: number; valid_from: string } | null> => {
      try {
        const { data, error } = await (supabase as unknown as {
          from: (t: string) => {
            select: (c: string) => {
              is: (c: string, v: null) => {
                maybeSingle: () => Promise<{ data: unknown; error: { code?: string } | null }>;
              };
            };
          };
        })
          .from("scoring_version")
          .select("id, valid_from")
          .is("valid_to", null)
          .maybeSingle();
        // A database without the migration is a valid state, not a failure: answer
        // "not frozen" quietly instead of surfacing a global error.
        if (error && !isMissingTable(error)) throw error;
        if (error) return null;
        return (data as { id: number; valid_from: string } | null) ?? null;
      } catch (e) {
        // Some clients throw the same refusal instead of returning it; a thrown
        // "table not found" still means the migration has not landed.
        if (isMissingTable(e as { code?: string; message?: string })) return null;
        throw e;
      }
    },


  });

  // A missing table is the answer "not frozen", not an error to report upward — the
  // same reading `selectOptionalColumns` applies to the missing column. Anything else
  // that fails leaves `frozen` false too, which is the safe direction: the screen then
  // keeps warning that a change re-scores the history, which is what it did before this
  // hook existed and is never a dangerous thing to over-say.
  const missing = isMissingTable(query.error as { code?: string } | null);

  return {
    frozen: query.isSuccess && query.data !== null,
    ready: query.isSuccess || missing,
    missing,
  };
}
