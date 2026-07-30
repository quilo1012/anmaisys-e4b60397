import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Download, Clock, Factory, FileWarning, Printer } from "lucide-react";
import { printElementAsDocument } from "@/lib/printDocument";
import { ReportPrintHeader } from "@/components/reports/ReportPrintHeader";
import { toast } from "sonner";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import {
  QUALITY_SEVERITIES, severityMeta, DOCUMENTATION_LABEL, DOCUMENTATION_PENALTY_PCT,
  documentationScore, isValidatedPaperwork, validationMeta,
} from "@/lib/qualityConstants";
import { useProfileNames } from "@/hooks/useProfileNames";
import { useLeaderScoreWeights } from "@/hooks/useLeaderScoreWeights";
import { computeLeaderScore, DEFAULT_WEIGHTS } from "@/lib/leaderScore";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

interface LSAction {
  id: string; status: string; severity: string | null; recorded_at: string;
  labels: string[] | null; department: string | null; line: string | null;
  /** Fields the documentation demerit has to be able to show in an audit. */
  action_no: string | null; description: string | null; shift: string | null;
  validation_status: string | null; validated_at: string | null; validated_by: string | null;
  attachments: string[] | null; closed_at: string | null;
}
interface LSSession { oee_pct: number | null; run_time_min: number | null; down_time_min: number | null; intouch_good_total: number | null; session_date: string | null; line: string | null; shift: string | null }

function Kpi({ label, value, sub, tone }: { label: string; value: string | number; sub?: string; tone?: string }) {
  return (
    <Card><CardContent className="p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("text-xl font-bold", tone)}>{value}</div>
      {sub && <div className="text-2xs text-muted-foreground">{sub}</div>}
    </CardContent></Card>
  );
}

/**
 * @param from  first day of the period, as the screen filters it
 * @param to    last day, inclusive — every query is bounded by it
 * @param shift "all", "DAY" or "NIGHT", matching the screen's shift filter
 *
 * The window used to be open-ended: only `from` was passed and every query used
 * gte(). Filtering a single day therefore showed that day's actions AND everything
 * after it — the card disagreed with the list right behind it.
 */
export function LeaderScorecard({ leaderName, from, to, shift = "all", onClose }: {
  leaderName: string | null; from: string; to: string; shift?: "all" | "DAY" | "NIGHT"; onClose: () => void;
}) {
  const untilTs = `${to}T23:59:59.999`;
  const periodLabel = from === to
    ? format(new Date(`${from}T00:00:00`), "dd/MM/yyyy")
    : `${format(new Date(`${from}T00:00:00`), "dd/MM/yyyy")} — ${format(new Date(`${to}T00:00:00`), "dd/MM/yyyy")}`;
  const shiftLabel = shift === "all" ? "All shifts" : shift === "DAY" ? "Day (06–18)" : "Night (18–06)";
  const enabled = !!leaderName;

  const { data: actions = [] } = useQuery({
    queryKey: ["ls_actions", leaderName, from, to, shift],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from("quality_actions")
        .select("id, status, severity, recorded_at, labels, department, line, action_no, description, shift, validation_status, validated_at, validated_by, attachments, closed_at")
        .eq("leader_name", leaderName as string)
        .gte("recorded_at", from).lte("recorded_at", untilTs)
        .order("recorded_at");
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
      return (data ?? []) as unknown as { action_id: string; changed_at: string }[];
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
      return (data ?? []) as unknown as Array<{ entry_date: string; line: string; shift: string; plan_qty: number }>;
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
      if (error) return [] as { actual_qty: number | null; target_qty: number | null }[];
      return (data ?? []) as unknown as { actual_qty: number | null; target_qty: number | null }[];
    },
  });

  const q = useMemo(() => {
    const total = actions.length;
    const completed = actions.filter((a) => a.status === "complete").length;
    const filed = actions.filter((a) => !!a.closed_at).length;
    const open = total - completed;
    const sev = { critical: 0, high: 0, medium: 0, low: 0 } as Record<string, number>;
    for (const a of actions) if (a.severity && sev[a.severity] !== undefined) sev[a.severity] += 1;
    const completeAt = new Map<string, number>();
    for (const c of completes) {
      const t = new Date(c.changed_at).getTime();
      const prev = completeAt.get(c.action_id);
      if (prev === undefined || t > prev) completeAt.set(c.action_id, t);
    }
    let sumDays = 0, n = 0;
    for (const a of actions) {
      const done = completeAt.get(a.id);
      if (a.status === "complete" && done) { sumDays += (done - new Date(a.recorded_at).getTime()) / 86400000; n += 1; }
    }
    const avgResolution = n > 0 ? sumDays / n : null;
    const labelMap = new Map<string, number>();
    for (const a of actions) for (const l of a.labels ?? []) labelMap.set(l, (labelMap.get(l) ?? 0) + 1);
    const topLabels = Array.from(labelMap.entries()).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count).slice(0, 6);
    const dayMap = new Map<string, number>();
    for (const a of actions) { const k = format(new Date(a.recorded_at), "yyyy-MM-dd"); dayMap.set(k, (dayMap.get(k) ?? 0) + 1); }
    const trend = Array.from(dayMap.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([k, count]) => ({ day: format(new Date(k + "T00:00:00"), "dd/MM"), count }));
    return { total, completed, filed, open, pctClosed: total ? Math.round((completed / total) * 100) : 0, sev, avgResolution, topLabels, trend };
  }, [actions, completes]);

  /**
   * Documentation score: 100 minus 5 for every VALIDATED Paperwork action.
   *
   * Validated only. An action counts against a leader when Quality has confirmed it
   * is a real deviation and signed for that verdict — not when somebody types it,
   * which is the difference between a scorecard and an accusation.
   */
  const docs = useMemo(() => {
    const penalised = actions.filter(isValidatedPaperwork);
    const raised = actions.filter((a) => (a.labels ?? []).includes(DOCUMENTATION_LABEL));
    return {
      penalised,
      // Raised but not yet judged — shown so nobody reads a clean score as "nothing
      // was found", when the truth may be "nothing has been reviewed yet".
      pending: raised.filter((a) => a.validation_status === "open" || a.validation_status === "under_investigation"),
      rejected: raised.filter((a) => a.validation_status === "rejected"),
      score: documentationScore(penalised.length),
      impactPct: penalised.length * DOCUMENTATION_PENALTY_PCT,
    };
  }, [actions]);

  // Who signed each verdict — "Attributable", the first letter of ALCOA+.
  const { data: profileNames = [] } = useProfileNames();
  const nameOf = useMemo(() => {
    const m = new Map(profileNames.map((p) => [p.id, p.name]));
    return (id: string | null) => (id ? m.get(id) ?? "—" : "—");
  }, [profileNames]);

  const p = useMemo(() => {
    // Only count what the lines actually report. A metric no line fills in is not
    // zero — "0.0h downtime" read as a perfect week when the truth was that nothing
    // was recorded: 0 of 216 sessions this month carry down_time_min, and none carry
    // oee_pct at all.
    const oees = sessions.map((s) => s.oee_pct).filter((v): v is number => v != null);
    const avgOEE = oees.length ? oees.reduce((a, b) => a + b, 0) / oees.length : null;
    const dtReported = sessions.filter((s) => s.down_time_min != null);
    const downtimeH = dtReported.length ? dtReported.reduce((s, x) => s + (x.down_time_min ?? 0), 0) / 60 : null;
    const runtimeReported = sessions.filter((s) => s.run_time_min != null);
    const runtimeH = runtimeReported.length ? runtimeReported.reduce((s, x) => s + (x.run_time_min ?? 0), 0) / 60 : null;

    // Output is what the floor logged, the same figure My Production and RAG use.
    // intouch_good_total is only on 89 of 216 sessions, so it under-reports whoever
    // works a line iTouching does not cover.
    const actual = items.reduce((s, x) => s + (x.actual_qty ?? 0), 0);

    // Target from the RAG plan, matched on date + shift + line like everywhere else.
    const norm = (v: string | null | undefined) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, "");
    const planMap = new Map<string, number>();
    for (const r of ragRows) {
      const k = `${r.entry_date}|${String(r.shift ?? "").trim().toUpperCase()}|${norm(r.line)}`;
      planMap.set(k, (planMap.get(k) ?? 0) + Number(r.plan_qty ?? 0));
    }
    let target = 0;
    const seen = new Set<string>();
    for (const s of sessions) {
      const k = `${s.session_date}|${String(s.shift ?? "").trim().toUpperCase()}|${norm(s.line)}`;
      if (seen.has(k)) continue;   // one plan per line+shift+day, not per session row
      seen.add(k);
      target += planMap.get(k) ?? 0;
    }
    const attainment = target > 0 ? Math.round((actual / target) * 100) : null;

    return {
      sessions: sessions.length, avgOEE, downtimeH, runtimeH,
      output: actual, attainment, actualQty: actual, targetQty: target,
      plannedSessions: seen.size, sessionsWithPlan: Array.from(seen).filter((k) => (planMap.get(k) ?? 0) > 0).length,
    };
  }, [sessions, items, ragRows]);

  const { data: weights = DEFAULT_WEIGHTS } = useLeaderScoreWeights();

  const score = useMemo(
    () => computeLeaderScore(
      { actual: p.actualQty, target: p.targetQty, avgOEE: p.avgOEE, actions },
      weights,
    ),
    [p, actions, weights],
  );

  const exportCSV = () => {
    const rows: string[][] = [
      ["Leader", leaderName ?? ""],
      ["Period", `${from} → ${to}`],
      ["Shift", shift === "all" ? "All shifts" : shift],
      [],
      ["QUALITY"],
      ["Total actions", String(q.total)], ["Open", String(q.open)], ["Completed", String(q.completed)], ["% closed", `${q.pctClosed}%`],
      ["Avg resolution (days)", q.avgResolution == null ? "—" : q.avgResolution.toFixed(1)],
      ["Final score", score.final === null ? "—" : `${score.final.toFixed(0)}%`],
      ["  Production component", score.production.value === null ? "—" : `${score.production.value.toFixed(0)}% (weight ${score.applied.production_pct}%) — ${score.production.basis}`],
      ["  Quality component", score.quality.value === null ? "—" : `${score.quality.value.toFixed(0)}% (weight ${score.applied.quality_pct}%) — ${score.quality.basis}`],
      ["  Documentation component", `${score.documentation.value}% (weight ${score.applied.documentation_pct}%) — ${score.documentation.basis}`],
      [],
      ["Documentation score", `${docs.score}%`],
      ["Validated Paperwork actions", String(docs.penalised.length)],
      ["Documentation impact", `-${docs.impactPct}%`],
      ["Paperwork under review (not counted)", String(docs.pending.length)],
      ["Paperwork rejected (not counted)", String(docs.rejected.length)],
      [],
      ["VALIDATED DOCUMENTATION ERRORS"],
      ["Action", "Line", "Shift", "Raised", "Validated", "Validated by", "Evidence files", "Penalty", "Description"],
      ...docs.penalised.map((a) => [
        a.action_no || a.id.slice(0, 8),
        a.line ?? "", a.shift ?? "",
        format(new Date(a.recorded_at), "dd/MM/yyyy"),
        a.validated_at ? format(new Date(a.validated_at), "dd/MM/yyyy HH:mm") : "",
        nameOf(a.validated_by),
        String(a.attachments?.length ?? 0),
        `-${DOCUMENTATION_PENALTY_PCT}%`,
        (a.description ?? "").replace(/"/g, "'"),
      ]),
      [],
      ["Critical", String(q.sev.critical)], ["High", String(q.sev.high)], ["Medium", String(q.sev.medium)], ["Low", String(q.sev.low)],
      [],
      ["PRODUCTION"],
      ["Sessions", String(p.sessions)], ["Avg OEE", p.avgOEE == null ? "—" : `${p.avgOEE.toFixed(1)}%`],
      ["Output (good)", String(p.output)], ["Attainment", p.attainment == null ? "—" : `${p.attainment}%`],
      ["Downtime (h)", p.downtimeH.toFixed(1)], ["Run time (h)", p.runtimeH.toFixed(1)],
    ];
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `leader-${(leaderName ?? "x").replace(/\s+/g, "_")}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={!!leaderName} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
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
                const el = document.getElementById("leader-scorecard-print");
                try {
                  if (el) await printElementAsDocument(el, `Leader Scorecard — ${leaderName ?? ""}`);
                } catch (e: any) {
                  toast.error(e?.message ?? "Could not open the print dialog.");
                }
              }}><Printer className="mr-1 h-4 w-4" />Print</Button>
              <Button size="sm" variant="outline" onClick={exportCSV}><Download className="mr-1 h-4 w-4" />Export</Button>
            </span>
          </DialogTitle>
        </DialogHeader>

        <div id="leader-scorecard-print" className="space-y-4 print-content">
          <ReportPrintHeader
            title={`Leader Scorecard — ${leaderName ?? ""}`}
            periodLabel={periodLabel}
            shift={shiftLabel}
          />

          {/* Final score — the one number, with the three it is made of and how each
              was worked out. Printed rather than hidden behind a tooltip: the leader
              this is about has to be able to check it. */}
          <Card className="border-l-4 border-l-primary">
            <CardContent className="p-3">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Final score</p>
                  <p className="text-4xl font-bold tabular-nums">
                    {score.final === null ? "—" : `${score.final.toFixed(0)}%`}
                  </p>
                </div>
                <div className="grid flex-1 grid-cols-3 gap-2 text-center">
                  {([
                    ["Production", score.production, score.applied.production_pct],
                    ["Quality", score.quality, score.applied.quality_pct],
                    ["Documentation", score.documentation, score.applied.documentation_pct],
                  ] as const).map(([label, c, w]) => (
                    <div key={label} className="rounded-md border p-2">
                      <p className="text-2xs uppercase tracking-wide text-muted-foreground">{label}</p>
                      <p className="text-lg font-bold tabular-nums">{c.value === null ? "—" : `${c.value.toFixed(0)}%`}</p>
                      <p className="text-2xs text-muted-foreground">weight {w}%</p>
                    </div>
                  ))}
                </div>
              </div>
              <ul className="mt-2 space-y-0.5 text-2xs text-muted-foreground">
                <li><b>Production:</b> {score.production.basis}</li>
                <li><b>Quality:</b> {score.quality.basis}</li>
                <li><b>Documentation:</b> {score.documentation.basis}</li>
              </ul>
              {docs.pending.length > 0 && (
                <p className="mt-1 text-2xs text-warning-strong">
                  {docs.pending.length} paperwork action{docs.pending.length === 1 ? "" : "s"} awaiting a verdict from
                  Quality — already counted in the quality score, but the −5% documentation penalty only applies once
                  validated.
                </p>
              )}
              {(score.production.value === null || score.quality.value === null || score.documentation.value === null) && (
                <p className="mt-1 text-2xs text-warning-strong">
                  A component with no data is left out and its weight shared between the others, rather than counted as zero.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Quality */}
          <div>
            <div className="mb-1.5 flex items-center gap-1 text-sm font-semibold"><Clock className="h-4 w-4" /> Quality</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Kpi label="Total actions" value={q.total} />
              <Kpi label="Open" value={q.open} tone="text-amber-600 dark:text-amber-400" />
              <Kpi label="% closed" value={`${q.pctClosed}%`} tone="text-green-600 dark:text-green-400" sub={`${q.completed} completed`} />
              <Kpi label="Avg resolution" value={q.avgResolution == null ? "—" : `${q.avgResolution.toFixed(1)}d`} sub="created → complete" />
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {QUALITY_SEVERITIES.slice().reverse().map((s) => (
                <Badge key={s.value} variant="outline" className={cn("text-2xs", severityMeta(s.value)?.badge)}>{s.label}: {q.sev[s.value] ?? 0}</Badge>
              ))}
            </div>
          </div>

          {/* Every action in the period, whatever its state.
              A closed action is still part of the leader's history — filing it away
              must not remove it from the record anyone reviews. */}
          {actions.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                Actions in this period ({actions.length})
                {q.filed > 0 && <span className="ml-1 font-normal normal-case">· {q.filed} closed, still listed</span>}
              </div>
              <div className="max-h-56 overflow-y-auto rounded-md border divide-y print:max-h-none print:overflow-visible">
                {actions.slice().reverse().map((a) => (
                  <div key={a.id} className="flex flex-wrap items-center gap-2 px-2 py-1.5 text-xs">
                    <span className="font-mono">{a.action_no || a.id.slice(0, 8)}</span>
                    <span className="text-muted-foreground">{format(new Date(a.recorded_at), "dd/MM")}</span>
                    {a.line && <span className="text-muted-foreground">{a.line}</span>}
                    {a.severity && (
                      <Badge variant="outline" className={cn("text-2xs", severityMeta(a.severity)?.badge)}>
                        {severityMeta(a.severity)?.label}
                      </Badge>
                    )}
                    <Badge variant="outline" className={cn("text-2xs", validationMeta(a.validation_status).badge)}>
                      {validationMeta(a.validation_status).label}
                    </Badge>
                    {a.closed_at && (
                      <Badge variant="outline" className="text-2xs bg-emerald-500/15 text-success-strong border-emerald-500/40">
                        closed {format(new Date(a.closed_at), "dd/MM")}
                      </Badge>
                    )}
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">{a.description}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {q.trend.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Actions over time</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={q.trend} margin={{ top: 4, right: 12, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="day" fontSize={11} tickLine={false} />
                    <YAxis allowDecimals={false} fontSize={11} tickLine={false} />
                    <Tooltip contentStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="count" name="Actions" stroke="hsl(0 72% 51%)" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {q.topLabels.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Top labels</div>
              <div className="flex flex-wrap gap-1.5">
                {q.topLabels.map((l) => <Badge key={l.label} variant="secondary" className="text-2xs">{l.label} · {l.count}</Badge>)}
              </div>
            </div>
          )}

          {/* Documentation errors — the demerit block.
              Answers, on its own, the question an audit asks: why did this leader lose
              points, who decided, when, and where is the evidence. */}
          <div>
            <div className="mb-1.5 flex items-center gap-1 text-sm font-semibold">
              <FileWarning className="h-4 w-4" /> Documentation errors ({DOCUMENTATION_LABEL})
            </div>

            {docs.penalised.length === 0 ? (
              <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3">
                <p className="text-sm font-semibold text-success-strong">No penalty · 100% compliant</p>
                <p className="text-2xs text-muted-foreground">
                  No validated {DOCUMENTATION_LABEL.toLowerCase()} action in this period.
                  {docs.pending.length > 0 && ` ${docs.pending.length} raised and still under review — a verdict could change this.`}
                  {docs.rejected.length > 0 && ` ${docs.rejected.length} rejected by Quality.`}
                </p>
              </div>
            ) : (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5">
                <div className="flex items-baseline justify-between gap-2 border-b border-destructive/30 p-3">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Total impact</p>
                    <p className="text-2xl font-bold text-destructive-strong tabular-nums">
                      −{docs.impactPct}% <span className="text-sm font-medium">({docs.penalised.length} validated)</span>
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Documentation score</p>
                    <p className="text-2xl font-bold tabular-nums">{docs.score}%</p>
                  </div>
                </div>

                <ul className="divide-y divide-destructive/20">
                  {docs.penalised.map((a) => (
                    <li key={a.id} className="p-3 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono font-semibold">{a.action_no || `#${a.id.slice(0, 8)}`}</span>
                        <Badge variant="outline" className={cn("text-2xs", validationMeta(a.validation_status).badge)}>
                          {validationMeta(a.validation_status).label}
                        </Badge>
                        <span className="font-semibold text-destructive-strong">−{DOCUMENTATION_PENALTY_PCT}%</span>
                        {(a.attachments?.length ?? 0) > 0 && (
                          <Badge variant="secondary" className="text-2xs">
                            {a.attachments!.length} evidence file{a.attachments!.length === 1 ? "" : "s"}
                          </Badge>
                        )}
                      </div>
                      {a.description && <p className="mt-1">{a.description}</p>}
                      <p className="mt-1 text-2xs text-muted-foreground">
                        {[
                          a.line, a.shift,
                          `raised ${format(new Date(a.recorded_at), "dd/MM/yyyy")}`,
                          a.validated_at ? `validated ${format(new Date(a.validated_at), "dd/MM/yyyy HH:mm")} by ${nameOf(a.validated_by)}` : null,
                        ].filter(Boolean).join(" · ")}
                      </p>
                    </li>
                  ))}
                </ul>

                {(docs.pending.length > 0 || docs.rejected.length > 0) && (
                  <p className="border-t border-destructive/30 p-2 text-2xs text-muted-foreground">
                    Not counted: {docs.pending.length} still under review, {docs.rejected.length} rejected by Quality.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Production */}
          <div>
            <div className="mb-1.5 flex items-center gap-1 text-sm font-semibold"><Factory className="h-4 w-4" /> Production <span className="text-xs font-normal text-muted-foreground">({p.sessions} sessions)</span></div>
            {p.sessions === 0 ? (
              <p className="text-xs text-muted-foreground">No production sessions for this leader in the period.</p>
            ) : (
              <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Kpi
                  label="Avg OEE"
                  value={p.avgOEE == null ? "n/a" : `${p.avgOEE.toFixed(1)}%`}
                  sub={p.avgOEE == null ? "not reported by the lines" : undefined}
                  tone={p.avgOEE == null ? "text-muted-foreground" : "text-blue-600 dark:text-blue-400"}
                />
                <Kpi
                  label="Attainment"
                  value={p.attainment == null ? "n/a" : `${p.attainment}%`}
                  sub={p.attainment == null ? "no RAG plan for these sessions" : `${p.actualQty.toLocaleString()} of ${p.targetQty.toLocaleString()} planned`}
                />
                <Kpi label="Output" value={p.output.toLocaleString()} sub="logged on My Production" />
                <Kpi
                  label="Downtime"
                  value={p.downtimeH == null ? "n/a" : `${p.downtimeH.toFixed(1)}h`}
                  sub={p.downtimeH == null ? "not recorded on the session" : undefined}
                  tone={p.downtimeH == null ? "text-muted-foreground" : "text-destructive-strong"}
                />
              </div>
              {p.sessionsWithPlan < p.plannedSessions && (
                <p className="mt-1 text-2xs text-muted-foreground">
                  {p.plannedSessions - p.sessionsWithPlan} of {p.plannedSessions} line-shifts have no RAG plan, so they add
                  output without adding target — attainment reads higher than it is.
                </p>
              )}
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
