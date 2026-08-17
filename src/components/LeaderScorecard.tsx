import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLeaderAttribution } from "@/hooks/useLabelAttribution";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Download, Printer } from "lucide-react";
import { printElementAsDocument } from "@/lib/printDocument";
import { toast } from "sonner";
import { format } from "date-fns";
import { useProfileNames } from "@/hooks/useProfileNames";
import { useLeaderScoreWeights } from "@/hooks/useLeaderScoreWeights";
import { DEFAULT_WEIGHTS } from "@/lib/leaderScore";
import { shiftDateFetchRange } from "@/lib/shifts";
import { leaderNamePattern, escapeLikePattern } from "@/lib/leaderNameMatch";
import { selectOptionalDomain } from "@/lib/optionalDomain";
import {
  computeScorecard, EMPTY_RAW,
  type LSAction, type LSItem, type LSRagRow, type LSSession, type LSStatusChange, type LSWorkOrder,
  type ScorecardPeriod,
} from "@/lib/leaderScorecard";
import { downloadScorecardCsv } from "@/lib/leaderScorecardCsv";
import { LeaderScorecardBody, SCORECARD_PRINT_ID } from "@/components/leader/LeaderScorecardBody";

/**
 * The manager's copy of a leader's scorecard, at its own address.
 *
 * It was a dialog on Production Performance until 17/08/2026: reachable one way and
 * gone on the next click, so it could not be linked, bookmarked or sent to the person
 * it is about. It is now the page behind `/dashboard/leader-scorecard/:leader`, and
 * Production Performance links to it with the leader and period already selected.
 *
 * It reads the tables directly, which its audience is allowed to do. The leader's own
 * copy — LeaderMyScorecardPage — cannot: a line tablet is RLS-scoped to one line while
 * a leader rotates across several, so those rows arrive through a database function
 * instead. Both then render {@link LeaderScorecardBody} over
 * {@link computeScorecard}, so the two screens cannot disagree about a person.
 *
 * @param from  first day of the period, as the screen filters it
 * @param to    last day, inclusive — every query is bounded by it
 * @param shift "all", "DAY" or "NIGHT", matching the screen's shift filter
 */
export function LeaderScorecard({ leaderName, from, to, shift = "all" }: {
  leaderName: string | null; from: string; to: string; shift?: "all" | "DAY" | "NIGHT";
}) {
  const enabled = !!leaderName;
  const period: ScorecardPeriod = { from, to, shift };

  const { data: actions = [], isError: eActions } = useQuery({
    queryKey: ["ls_actions", leaderName, from, to, shift],
    enabled,
    queryFn: async () => {
      // The fetch reaches into the morning after so a night filed under `to` is not
      // cut off halfway; computeScorecard decides what actually stays.
      const window = shiftDateFetchRange(from, to);
      // One list, so the fallback below cannot drift from it — it is this string minus
      // the one column. `domain` is newer than the generated Postgrest types, hence the
      // cast — see `actionPoints()` for why the column has to be here at all.
      const COLUMNS =
        "id, status, severity, recorded_at, labels, department, line, action_no, description, shift, validation_status, validated_at, validated_by, attachments, closed_at, domain";
      const run = (columns: string) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- column newer than the generated types
        let qy = (supabase as any).from("quality_actions")
          .select(columns)
          // Case-insensitive: the log spells five of these people in capitals. See
          // leaderNamePattern — an `.eq()` here cost Cainan his whole quality section.
          .ilike("leader_name", leaderNamePattern(leaderName as string))
          .gte("recorded_at", window.gte).lte("recorded_at", window.lte);
        if (shift !== "all") qy = qy.eq("shift", shift);
        return qy.order("recorded_at");
      };

      // Asks for `domain` and settles for the log without it when the column has not
      // been migrated — see selectOptionalDomain for why that is the right reading and
      // not a workaround. A real failure still throws, and `readFailed` below turns it
      // into a message rather than a zero.
      const { data, error } = await selectOptionalDomain(COLUMNS, run);
      if (error) throw error;
      return (data ?? []) as unknown as LSAction[];
    },
  });

  const actionIds = useMemo(() => actions.map((a) => a.id), [actions]);
  const { data: completes = [], isError: eCompletes } = useQuery({
    /**
     * Keyed on the ids themselves, not on how many there are.
     *
     * This key counted the actions and omitted `shift`, which every other query on
     * this card carries. A leader with three actions on days and three on nights
     * therefore had one cache entry for both: switching the shift filter redrew the
     * card with the other shift's completion history, and "Avg resolution" reported
     * on actions that were not on screen. Two different sets of the same size are not
     * the same set.
     */
    queryKey: ["ls_hist", leaderName, from, to, shift, actionIds.join(",")],
    enabled: enabled && actionIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not in generated types yet
        .from("quality_action_history" as any)
        .select("action_id, changed_at, new_value, field")
        .in("action_id", actionIds).eq("field", "status").eq("new_value", "complete");
      if (error) throw error;
      return (data ?? []) as unknown as LSStatusChange[];
    },
  });

  const { data: sessions = [], isError: eSessions } = useQuery({
    queryKey: ["ls_prod", leaderName, from, to, shift],
    enabled,
    queryFn: async () => {
      let qy = supabase.from("production_sessions")
        .select("oee_pct, run_time_min, down_time_min, intouch_good_total, session_date, line, shift")
        .ilike("leader_name", leaderNamePattern(leaderName as string))
        .gte("session_date", from).lte("session_date", to);
      if (shift !== "all") qy = qy.eq("shift", shift);
      const { data, error } = await qy;
      if (error) throw error;
      return (data ?? []) as unknown as LSSession[];
    },
  });

  /**
   * The plan for this leader's sessions, from RAG weekly.
   *
   * production_items.target_qty is not it: only 22 of the 118 items this month carry
   * one, so dividing the full output by that fraction produced an attainment of 225%
   * on screen. RAG is the plan the rest of the system reports against — Analytics'
   * Leader Performance already reads it — and one number cannot be right on two
   * screens if they use different denominators.
   */
  const { data: ragRows = [], isError: eRag } = useQuery({
    queryKey: ["ls_rag", leaderName, from, to, shift],
    enabled,
    queryFn: async () => {
      let qy = supabase
        .from("rag_weekly_entries")
        .select("entry_date, line, shift, plan_qty")
        .gte("entry_date", from).lte("entry_date", to);
      if (shift !== "all") qy = qy.eq("shift", shift);
      const { data, error } = await qy;
      if (error) throw error;
      return (data ?? []) as unknown as LSRagRow[];
    },
  });

  const { data: items = [], isError: eItems } = useQuery({
    queryKey: ["ls_items", leaderName, from, to, shift],
    enabled,
    queryFn: async () => {
      let qy = supabase.from("production_items")
        // `line` is selected so the card can tell which planned line-shifts logged no
        // output — see ProductionSummary.plannedWithoutOutput.
        .select("actual_qty, target_qty, production_sessions!inner(leader_name, session_date, shift, line)")
        .ilike("production_sessions.leader_name", leaderNamePattern(leaderName as string))
        .gte("production_sessions.session_date", from)
        .lte("production_sessions.session_date", to);
      if (shift !== "all") qy = qy.eq("production_sessions.shift", shift);
      const { data, error } = await qy;
      // Thrown, not swallowed. Returning `[]` here made `eItems` dead code: the flag is
      // listed in `readFailed` and named in the message below, but could never be set.
      // A rejected read then reached the card as actual = 0 against a RAG target that
      // loaded fine — attainment 0%, a Production pillar of zero, weighted into the
      // final score as though it had been measured. See the note on `readFailed`: an
      // unreadable period is not an empty one, and here it was not even a flattering
      // one.
      if (error) throw error;
      return (data ?? []) as unknown as LSItem[];
    },
  });

  /**
   * Maintenance the leader called for in the period.
   *
   * requester_name is free text typed on the request form — "murilo", "Filipi
   * (Line 2)", "FILIPE" — so the match is a case-insensitive prefix on the leader's
   * name rather than an equality that would find none of them. It is the only link
   * the work order carries back to a line leader; there is no user id on a request
   * raised from the floor tablet.
   */
  const { data: woRequests = [], isError: eWos } = useQuery({
    queryKey: ["ls_wos", leaderName, from, to, shift],
    enabled,
    queryFn: async () => {
      const woWindow = shiftDateFetchRange(from, to);
      const { data, error } = await supabase
        .from("work_orders")
        .select("id, wo_number, created_at, status, line_at_time, line_stopped, description")
        .ilike("requester_name", `${escapeLikePattern((leaderName as string).trim())}%`)
        // The same window the quality log uses, and for the same reason: it reaches
        // into the morning after so a night raised at 02:00 is not cut off halfway,
        // and `workOrdersInPeriod` throws back what does not belong. It used to stop
        // at `to` 23:59 with no timezone on either bound, which both lost every
        // after-midnight call-out and counted the previous night's in their place.
        .gte("created_at", woWindow.gte).lte("created_at", woWindow.lte)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as unknown as LSWorkOrder[];
    },
  });

  /**
   * Scored on the weights in force at the END of the period, the same date the weekly
   * scorecard resolves its own on (`week_ending`). Without a date here, re-weighting
   * the score in November re-scored every card anyone opened about July — including
   * ones already printed and signed.
   */
  const { data: weights = DEFAULT_WEIGHTS } = useLeaderScoreWeights(to);
  const { excluded, ready: attributionReady } = useLeaderAttribution();

  /**
   * Every one of the six reads feeds the score, and each `useQuery` above defaults to
   * `[]` when it fails — so a rejected query is indistinguishable from a quiet period
   * unless it is asked about directly.
   *
   * It was not, and the cost was not theoretical: the `.select()` on quality_actions
   * names `domain`, a column that arrives with 20260817090000. Against a database
   * without it PostgREST rejects the query outright, the empty default flowed into
   * computeScorecard, and a leader with four open actions was shown "No quality action
   * was raised against this leader in this period" and Quality 100% — half the weight
   * of a final 100%. A failed read did not lower the score. It raised it.
   *
   * So the card does not draw at all. Refusing to say anything is the only honest
   * option: the same reasoning as `attributionReady` below, which already declines to
   * draw a score it might have to take back — and this way round is worse, because a
   * score that flatters is one nobody reports.
   */
  const readFailed = eActions || eCompletes || eSessions || eRag || eItems || eWos;
  const result = useMemo(
    () => computeScorecard(
      { ...EMPTY_RAW, actions, completes, sessions, ragRows, items, woRequests },
      period,
      { weights, excludedLabels: excluded },
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- period is rebuilt each render from these three
    [actions, completes, sessions, ragRows, items, woRequests, from, to, shift, weights, excluded],
  );

  const { data: profileNames = [] } = useProfileNames();
  const nameOf = useMemo(() => {
    const m = new Map(profileNames.map((p) => [p.id, p.name]));
    return (id: string | null) => (id ? m.get(id) ?? "—" : "—");
  }, [profileNames]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div className="min-w-0">
        {/* The title and the two buttons are siblings, not nested. Lifting the dialog's
            header out into the page left the buttons inside the <h2>, where they
            inherited its column layout and dropped underneath the date instead of
            sitting beside it — and a <button> inside a heading is not markup anybody
            should have to explain to a screen reader either. */}
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h2 className="flex flex-col text-lg font-semibold">
            <span className="flex flex-col">
              <span>{leaderName}</span>
              {/* Stated, because every figure below is bounded by it — and because
                  the card used to report from this date onward, with no end. */}
              <span className="text-xs font-normal text-muted-foreground">
                {from === to
                  ? format(new Date(`${from}T00:00:00`), "dd MMM yyyy")
                  : `${format(new Date(`${from}T00:00:00`), "dd MMM")} → ${format(new Date(`${to}T00:00:00`), "dd MMM yyyy")}`}
                {shift !== "all" && ` · ${shift === "DAY" ? "Day" : "Night"} shift`}
              </span>
            </span>
          </h2>
          {/* Hidden rather than disabled: a printed or exported card outlives the screen
              it came from, and a CSV of a failed read carries none of the warning above
              with it. There is nothing here to take away yet. */}
          <span className={`flex shrink-0 gap-2${readFailed ? " hidden" : ""}`}>
              <Button size="sm" variant="outline" onClick={async () => {
                const el = document.getElementById(SCORECARD_PRINT_ID);
                try {
                  if (el) await printElementAsDocument(el, `Leader Scorecard — ${leaderName ?? ""}`);
                } catch (e: any) {
                  toast.error(e?.message ?? "Could not open the print dialog.");
                }
              }}><Printer className="mr-1 h-4 w-4" />Print</Button>
              <Button size="sm" variant="outline" onClick={() => downloadScorecardCsv(leaderName, period, result, nameOf)}>
                <Download className="mr-1 h-4 w-4" />Export
              </Button>
            </span>
        </div>

        <div className="mt-4 min-w-0">
          {/* Every figure below is weighted, and the quality score is a subtraction.
              Drawing it before attribution lands would show the leader a worse score
              than they have, then correct it — on the one screen where being wrong
              about somebody costs the most. */}
          {readFailed ? (
            <div className="py-16 text-center">
              <p className="text-sm font-medium">This scorecard could not be read.</p>
              {/* Named, because the reader's next question is which part is missing,
                  and because the answer is usually a migration that has not run. */}
              <p className="mt-1 text-xs text-muted-foreground">
                {[
                  eActions && "quality actions",
                  eCompletes && "action history",
                  eSessions && "production sessions",
                  eRag && "the RAG weekly plan",
                  eItems && "production items",
                  eWos && "work orders",
                ].filter(Boolean).join(", ")} did not load, so no score is shown —
                an unreadable period is not an empty one.
              </p>
            </div>
          ) : attributionReady
            ? <LeaderScorecardBody
                leaderName={leaderName}
                period={period}
                result={result}
                /* Only this copy of the card links out. The leader's own copy renders
                   the same rows without a destination — see LeaderScorecardBody. */
                actionHref={(a) => `/dashboard/quality?action=${encodeURIComponent(a.id)}`}
              />
            : <p className="py-16 text-center text-sm text-muted-foreground">Working out which actions count…</p>}
        </div>
      </div>
    </div>
  );
}
