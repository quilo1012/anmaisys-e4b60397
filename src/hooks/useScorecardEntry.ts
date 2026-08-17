import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { emptyDraft, pickWritable, type ScorecardEntryDraft, type ScorecardEntryVerdict } from "@/lib/scorecardEntry";

/**
 * One leader's one week: the draft they can edit, and the verdict the database
 * computed for it. The verdict is read straight off `v_leader_weekly_scorecard` —
 * nothing here derives a RAG, a fail type or a score. If the database disagrees
 * with what this hook shows, the database is right and this hook has a bug.
 *
 * `as any` on both calls because neither `v_leader_weekly_scorecard` nor
 * `leader_weekly_scorecard` is in the generated `src/integrations/supabase/types.ts`
 * yet — their migration has not been applied to the database. Same escape as
 * `useScorecardWeek.ts` and `useLeaderScoreWeights.ts:20`; drop the cast once the
 * migration lands and the types are regenerated.
 *
 * Today the table does not exist, so every read errors. That is surfaced as
 * `verdict.isError`/`verdict.error`, not swallowed into a blank draft — a blank
 * week (nothing typed yet) and a failed query must stay distinguishable to
 * whoever opens the drawer.
 */
export function useScorecardEntry(leaderId: string, lineId: string, weekEnding: string) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<ScorecardEntryDraft>(() => emptyDraft(leaderId, lineId, weekEnding));
  const timer = useRef<ReturnType<typeof setTimeout>>();
  // Every write — debounced or `saveNow` — is chained behind whatever write is
  // already in flight, rather than fired independently. A record this module
  // audits cannot afford two upserts landing at the database out of send order:
  // a bump-counter that just drops a stale *response* still lets the stale
  // *request* reach Postgres first or last, unpredictably, and the row is
  // whichever one the network happened to deliver last. Chaining instead means
  // the next write's `mutateAsync` is simply never called until the previous one
  // has settled, so completion order always equals send order, and `saveNow`
  // (used to stamp submitted_by/approved_by) can never be overwritten by an
  // earlier debounced save that was still in flight when it ran.
  const pendingWrite = useRef<Promise<unknown>>(Promise.resolve());

  // Reset to a blank draft whenever the identity of the week changes, so a stale
  // leader's numbers can't flash on screen while the new week's query is in flight.
  useEffect(() => {
    setDraft(emptyDraft(leaderId, lineId, weekEnding));
  }, [leaderId, lineId, weekEnding]);

  // O veredicto vem sempre da view. O ecra nunca o calcula.
  const verdict = useQuery({
    queryKey: ["scorecard-entry", leaderId, lineId, weekEnding],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- view not in generated types yet
      const { data, error } = await (supabase as any)
        .from("v_leader_weekly_scorecard")
        .select("*")
        .eq("leader_id", leaderId)
        .eq("line_id", lineId)
        .eq("week_ending", weekEnding)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as (ScorecardEntryVerdict & { id: string }) | null;
    },
  });

  // The fetched row reaches the draft HERE, not inside `queryFn`. Two reasons.
  // First, `queryFn` runs on every refetch — including the one this hook's own
  // `onSuccess` triggers after each save — and setting state from inside it
  // stamped over whatever the person was in the middle of typing. React Query's
  // structural sharing keeps `verdict.data` referentially stable when a refetch
  // returns the same row, so an effect on it does not fire for a no-op refetch.
  // Second and larger: only the draft's OWN columns are merged. The view carries
  // names, labels, RAGs, drivers and two GENERATED ALWAYS columns that the base
  // table will not accept on a write — see `pickWritable`.
  const fetchedRow = verdict.data;
  useEffect(() => {
    if (!fetchedRow) return;
    setDraft((d) => ({ ...d, ...pickWritable(fetchedRow as unknown as Record<string, unknown>) }));
  }, [fetchedRow]);

  const save = useMutation({
    mutationFn: async (next: ScorecardEntryDraft) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not in generated types yet
      const { error } = await (supabase as any)
        .from("leader_weekly_scorecard")
        // Projected through the draft's own key set on the way OUT as well as on
        // the way in: whatever else may have found its way onto the object, only
        // columns the base table actually has are ever sent.
        .upsert(pickWritable(next as unknown as Record<string, unknown>), { onConflict: "leader_id,line_id,week_ending" });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scorecard-entry", leaderId, lineId, weekEnding] });
      qc.invalidateQueries({ queryKey: ["scorecard-week", weekEnding] });
    },
    // A base e que manda: a mensagem do trigger da CAPA aparece tal como ela a escreveu.
    onError: (e: { message: string }) => toast.error(e.message),
  });

  /**
   * Queues one write behind whatever is already pending, so two upserts for the
   * same row can never be in flight at once — see the comment on `pendingWrite`
   * above. The `.catch(() => {})` on the head of the chain only stops one
   * write's rejection from breaking the chain for the *next* write; it does not
   * swallow this call's own failure, which the caller still awaits/rejects on.
   */
  const enqueueSave = useCallback((next: ScorecardEntryDraft) => {
    const chained = pendingWrite.current.catch(() => {}).then(() => save.mutateAsync(next));
    pendingWrite.current = chained;
    return chained;
  }, [save]);

  const setField = useCallback(<K extends keyof ScorecardEntryDraft>(key: K, value: ScorecardEntryDraft[K]) => {
    setDraft((d) => {
      const next = { ...d, [key]: value };
      clearTimeout(timer.current);
      // Fire-and-forget from the timer's point of view — `save`'s own onError
      // already toasts a failure — but still routed through the same queue as
      // everything else, so a slow debounced write cannot outrun a `saveNow`
      // that follows it.
      timer.current = setTimeout(() => { void enqueueSave(next).catch(() => {}); }, 400);
      return next;
    });
  }, [enqueueSave]);

  useEffect(() => () => clearTimeout(timer.current), []);

  /**
   * Grava ja, sem esperar pelo debounce. E o que submeter e aprovar usam: um carimbo de
   * auditoria nao pode ficar 400 ms pendurado num temporizador que a gaveta a fechar
   * cancela.
   *
   * Clearing the *pending timer* only stops a write that has not fired yet. One
   * that already has is in `pendingWrite`, and `enqueueSave` queues behind it —
   * so a debounced save that started just before `saveNow` is called is still
   * guaranteed to finish, and finish first, rather than racing this one and
   * possibly landing after it.
   */
  const saveNow = useCallback(async (fields: Partial<ScorecardEntryDraft>) => {
    clearTimeout(timer.current);
    const next = { ...draft, ...fields };
    setDraft(next);
    await enqueueSave(next);
  }, [draft, enqueueSave]);

  return {
    draft,
    setField,
    saveNow,
    verdict: verdict.data ?? null,
    isSaving: save.isPending,
    isLoading: verdict.isLoading,
    isError: verdict.isError,
    error: verdict.error,
  };
}
