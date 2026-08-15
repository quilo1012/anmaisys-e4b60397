import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLeaderAttribution } from "@/hooks/useLabelAttribution";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Download, Printer } from "lucide-react";
import { printElementAsDocument } from "@/lib/printDocument";
import { toast } from "sonner";
import { format } from "date-fns";
import { useProfileNames } from "@/hooks/useProfileNames";
import { useLeaderScoreWeights } from "@/hooks/useLeaderScoreWeights";
import { DEFAULT_WEIGHTS } from "@/lib/leaderScore";
import { shiftDateFetchRange } from "@/lib/shifts";
import {
  computeScorecard, EMPTY_RAW,
  type LSAction, type LSItem, type LSRagRow, type LSSession, type LSStatusChange, type LSWorkOrder,
  type ScorecardPeriod,
} from "@/lib/leaderScorecard";
import { downloadScorecardCsv } from "@/lib/leaderScorecardCsv";
import { LeaderScorecardBody, SCORECARD_PRINT_ID } from "@/components/leader/LeaderScorecardBody";

/**
 * The manager's copy of a leader's scorecard, opened from Production Performance.
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
export function LeaderScorecard({ leaderName, from, to, shift = "all", onClose }: {
  leaderName: string | null; from: string; to: string; shift?: "all" | "DAY" | "NIGHT"; onClose: () => void;
}) {
  const untilTs = `${to}T23:59:59.999`;
  const enabled = !!leaderName;
  const period: ScorecardPeriod = { from, to, shift };

  const { data: actions = [] } = useQuery({
    queryKey: ["ls_actions", leaderName, from, to, shift],
    enabled,
    queryFn: async () => {
      // The fetch reaches into the morning after so a night filed under `to` is not
      // cut off halfway; computeScorecard decides what actually stays.
      const window = shiftDateFetchRange(from, to);
      let qy = supabase.from("quality_actions")
        .select("id, status, severity, recorded_at, labels, department, line, action_no, description, shift, validation_status, validated_at, validated_by, attachments, closed_at")
        .eq("leader_name", leaderName as string)
        .gte("recorded_at", window.gte).lte("recorded_at", window.lte);
      if (shift !== "all") qy = qy.eq("shift", shift);
      const { data, error } = await qy.order("recorded_at");
      if (error) throw error;
      return (data ?? []) as unknown as LSAction[];
    },
  });

  const actionIds = useMemo(() => actions.map((a) => a.id), [actions]);
  const { data: completes = [] } = useQuery({
    queryKey: ["ls_hist", leaderName, from, to, actionIds.length],
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

  const { data: sessions = [] } = useQuery({
    queryKey: ["ls_prod", leaderName, from, to, shift],
    enabled,
    queryFn: async () => {
      let qy = supabase.from("production_sessions")
        .select("oee_pct, run_time_min, down_time_min, intouch_good_total, session_date, line, shift")
        .eq("leader_name", leaderName as string)
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
  const { data: ragRows = [] } = useQuery({
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

  const { data: items = [] } = useQuery({
    queryKey: ["ls_items", leaderName, from, to, shift],
    enabled,
    queryFn: async () => {
      let qy = supabase.from("production_items")
        .select("actual_qty, target_qty, production_sessions!inner(leader_name, session_date, shift)")
        .eq("production_sessions.leader_name", leaderName as string)
        .gte("production_sessions.session_date", from)
        .lte("production_sessions.session_date", to);
      if (shift !== "all") qy = qy.eq("production_sessions.shift", shift);
      const { data, error } = await qy;
      if (error) return [] as LSItem[];
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
  const { data: woRequests = [] } = useQuery({
    queryKey: ["ls_wos", leaderName, from, to, shift],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_orders")
        .select("id, wo_number, created_at, status, line_at_time, line_stopped, description")
        .ilike("requester_name", `${leaderName}%`)
        .gte("created_at", `${from}T00:00:00`).lte("created_at", untilTs)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as unknown as LSWorkOrder[];
    },
  });

  const { data: weights = DEFAULT_WEIGHTS } = useLeaderScoreWeights();
  const { excluded, ready: attributionReady } = useLeaderAttribution();
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
    <Dialog open={!!leaderName} onOpenChange={(o) => { if (!o) onClose(); }}>
      {/* The header stays put and only the body scrolls.
          It used to be one scrolling box: content wider than the dialog pushed the
          title row sideways and took Print and Export off the right-hand edge with
          it, so the card looked as though it had no print option at all. */}
      <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-2 pr-6">
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
            <span className="flex shrink-0 gap-2">
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
          </DialogTitle>
        </DialogHeader>

        <div className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
          {/* Every figure below is weighted, and the quality score is a subtraction.
              Drawing it before attribution lands would show the leader a worse score
              than they have, then correct it — on the one screen where being wrong
              about somebody costs the most. */}
          {attributionReady
            ? <LeaderScorecardBody leaderName={leaderName} period={period} result={result} />
            : <p className="py-16 text-center text-sm text-muted-foreground">Working out which actions count…</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
