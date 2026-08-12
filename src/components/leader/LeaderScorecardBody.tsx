import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, Factory, FileWarning } from "lucide-react";
import { ReportPrintHeader } from "@/components/reports/ReportPrintHeader";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Figure } from "@/components/ui/Figure";
import {
  QUALITY_SEVERITIES, severityMeta, DOCUMENTATION_LABEL, DOCUMENTATION_PENALTY_PCT,
  validationMeta,
} from "@/lib/qualityConstants";
import { useProfileNames } from "@/hooks/useProfileNames";
import { displayScore } from "@/lib/leaderScore";
import type { ScorecardPeriod, ScorecardResult } from "@/lib/leaderScorecard";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

/**
 * The scorecard itself, with no idea where its rows came from.
 *
 * A manager opens it in a dialog off Production Performance, reading the tables
 * directly; a line leader opens it full-screen on a tablet, their rows arriving
 * through a SECURITY DEFINER function because RLS scopes that session to one line.
 * Both render this, so neither can be shown a different number for the same person.
 */

export const SCORECARD_PRINT_ID = "leader-scorecard-print";

export function periodLabelOf(period: ScorecardPeriod): string {
  return period.from === period.to
    ? format(new Date(`${period.from}T00:00:00`), "dd/MM/yyyy")
    : `${format(new Date(`${period.from}T00:00:00`), "dd/MM/yyyy")} — ${format(new Date(`${period.to}T00:00:00`), "dd/MM/yyyy")}`;
}

export function shiftLabelOf(period: ScorecardPeriod): string {
  return period.shift === "all" ? "All shifts" : period.shift === "DAY" ? "Day (06–18)" : "Night (18–06)";
}

export function LeaderScorecardBody({ leaderName, period, result }: {
  leaderName: string | null;
  period: ScorecardPeriod;
  result: ScorecardResult;
}) {
  const { quality: q, docs, production: p, score, actions, woRequests, woStopped } = result;

  // Who signed each verdict — "Attributable", the first letter of ALCOA+.
  const { data: profileNames = [] } = useProfileNames();
  const nameOf = useMemo(() => {
    const m = new Map(profileNames.map((pn) => [pn.id, pn.name]));
    return (id: string | null) => (id ? m.get(id) ?? "—" : "—");
  }, [profileNames]);

  return (
    <div id={SCORECARD_PRINT_ID} className="space-y-4 print-content [&>div]:break-inside-avoid">
      <ReportPrintHeader
        title={`Leader Scorecard — ${leaderName ?? ""}`}
        periodLabel={periodLabelOf(period)}
        shift={shiftLabelOf(period)}
      />

      {/* Final score — the one number, with the three it is made of and how each was
          worked out. Printed rather than hidden behind a tooltip: the leader this is
          about has to be able to check it. */}
      <Card>
        <CardContent className="p-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="font-display text-2xs font-bold uppercase leading-none tracking-[0.12em] text-muted-foreground">Final score</p>
              <p className="mt-2 font-figure text-4xl font-bold leading-none tracking-[-0.02em]">
                {score.final === null ? "—" : `${displayScore(score.final)}%`}
              </p>
            </div>
            {/* Full width on a phone, beside the score from `sm` up.
                Sharing the row at 390px left each box about 70px, and index.css
                sets `overflow-wrap: anywhere` on every div and span inside main —
                a guard against long URLs blowing out a card. A word that does not
                fit is therefore broken wherever it happens to run out, and these
                three read "PRODUC TION", "QUALIT Y", "DOCUM ENTATIO N". The rule
                is right; the box was too narrow to spare it. */}
            <div className="grid w-full grid-cols-3 gap-2 text-center sm:w-auto sm:min-w-0 sm:flex-1">
              {([
                ["Production", score.production, score.applied.production_pct],
                ["Quality", score.quality, score.applied.quality_pct],
                ["Documentation", score.documentation, score.applied.documentation_pct],
              ] as const).map(([label, c, w]) => (
                // The padding, the letter-spacing and a pixel of type are given up on
                // a phone — never the word. Measured at 390px: "DOCUMENTATION" set as
                // it is above needs 99px and the box offers 94, so it broke as
                // "DOCUM ENTATIO N". These three together leave about 8px spare,
                // which is margin rather than a shave, and the components stay side
                // by side — the whole point of a block you are meant to compare.
                <div key={label} className="rounded-md border p-1 sm:p-2">
                  <p className="font-display text-[10px] font-bold uppercase tracking-normal text-muted-foreground sm:text-2xs sm:tracking-[0.1em]">{label}</p>
                  <p className="mt-1 font-figure text-lg font-bold leading-none">{c.value === null ? "—" : `${displayScore(c.value)}%`}</p>
                  <p className="mt-1 font-figure text-2xs text-muted-foreground">weight {w}%</p>
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
          <Figure label="Total actions" value={String(q.total)} />
          <Figure label="Open" value={String(q.open)} tone={q.open > 0 ? "owed" : "neutral"} />
          <Figure label="% closed" value={`${q.pctClosed}%`} tone="earned" hint={`${q.completed} completed`} />
          <Figure label="Avg resolution" value={q.avgResolution == null ? "—" : `${q.avgResolution.toFixed(1)}d`} hint="created → complete" />
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {QUALITY_SEVERITIES.slice().reverse().map((s) => (
            <Badge key={s.value} variant="outline" className={cn("text-2xs", severityMeta(s.value)?.badge)}>{s.label}: {q.sev[s.value] ?? 0}</Badge>
          ))}
        </div>
      </div>

      {/* Every action in the period, whatever its state. A closed action is still part
          of the leader's history — filing it away must not remove it from the record
          anyone reviews. */}
      {actions.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
            Actions in this period ({actions.length})
            {q.filed > 0 && <span className="ml-1 font-normal normal-case">· {q.filed} closed, still listed</span>}
          </div>
          <div className="max-h-56 overflow-y-auto rounded-md border divide-y print:max-h-none print:overflow-visible">
            {actions.slice().reverse().map((a) => (
              <div key={a.id} className="flex min-w-0 flex-wrap items-center gap-2 px-2 py-1.5 text-xs">
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
                  <Badge variant="outline" className="text-2xs bg-success/15 text-success-strong border-success/40">
                    closed {format(new Date(a.closed_at), "dd/MM")}
                  </Badge>
                )}
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{a.description}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Hidden in print when there is a single day: a line chart with one dot says
          nothing a table above it has not already said, and it costs a third of the page. */}
      {q.trend.length > 0 && (
        <Card className={q.trend.length < 2 ? "print:hidden" : undefined}>
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

      {/* Documentation errors — the demerit block. Answers, on its own, the question an
          audit asks: why did this leader lose points, who decided, when, and where is
          the evidence. */}
      <div>
        <div className="mb-1.5 flex items-center gap-1 text-sm font-semibold">
          <FileWarning className="h-4 w-4" /> Documentation errors ({DOCUMENTATION_LABEL})
        </div>

        {docs.penalised.length === 0 ? (
          <div className="rounded-lg border border-success/40 bg-success/5 p-3">
            <p className="text-sm font-semibold text-success-strong">No penalty · 100% compliant</p>
            <p className="text-2xs text-muted-foreground">
              No validated {DOCUMENTATION_LABEL.toLowerCase()} action in this period.
              {docs.pending.length > 0 && ` ${docs.pending.length} raised and still under review — a verdict could change this.`}
              {docs.rejected.length > 0 && ` ${docs.rejected.length} rejected by Quality.`}
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-destructive/30 p-3">
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
        <div className="mb-1.5 flex items-center gap-1 text-sm font-semibold">
          <Factory className="h-4 w-4" /> Production <span className="text-xs font-normal text-muted-foreground">({p.sessions} sessions)</span>
        </div>
        {p.sessions === 0 ? (
          <p className="text-xs text-muted-foreground">
            No production sessions for this leader in the period.
            {woRequests.length > 0 && ` ${woRequests.length} work order${woRequests.length === 1 ? "" : "s"} were still raised in their name — listed below.`}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Figure
                label="Attainment"
                value={p.attainment == null ? "n/a" : `${p.attainment}%`}
                hint={p.attainment == null ? "no RAG plan for these sessions" : `${p.actualQty.toLocaleString()} of ${p.targetQty.toLocaleString()} planned`}
              />
              <Figure label="Output" value={p.output.toLocaleString()} hint="logged on My Production" />
              <Figure
                label="Maintenance called"
                value={String(woRequests.length)}
                hint={woRequests.length === 0 ? "no work order raised in this period" : `${woStopped} stopped the line`}
                tone={woStopped > 0 ? "owed" : "neutral"}
              />
            </div>
            {woRequests.length > 0 && (
              <div className="mt-2 space-y-1">
                <div className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Work orders raised by this leader ({woRequests.length})
                </div>
                {woRequests.map((w) => (
                  <div key={w.id} className="flex min-w-0 flex-wrap items-start gap-2 rounded border p-1.5 text-xs break-inside-avoid">
                    <span className="font-mono font-semibold">
                      {w.wo_number ? `WO-${new Date(w.created_at).getFullYear()}-${String(w.wo_number).padStart(6, "0")}` : "—"}
                    </span>
                    <span className="whitespace-nowrap text-muted-foreground">{format(new Date(w.created_at), "dd/MM HH:mm")}</span>
                    {w.line_at_time && <span className="text-muted-foreground">{w.line_at_time}</span>}
                    <Badge variant="outline" className="text-2xs capitalize">{(w.status ?? "—").replace(/_/g, " ")}</Badge>
                    {w.line_stopped && (
                      <Badge variant="outline" className="border-destructive/40 bg-destructive/10 text-2xs text-destructive-strong">
                        Line stopped
                      </Badge>
                    )}
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">{w.description ?? ""}</span>
                  </div>
                ))}
              </div>
            )}
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
  );
}
