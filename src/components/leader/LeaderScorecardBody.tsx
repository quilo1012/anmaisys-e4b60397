import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Factory, FileWarning } from "lucide-react";
import { ReportPrintHeader } from "@/components/reports/ReportPrintHeader";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Figure } from "@/components/ui/Figure";
import {
  QUALITY_SEVERITIES, severityMeta, DOCUMENTATION_LABEL,
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

/**
 * Quantities, in one locale.
 *
 * `toLocaleString()` with no argument follows the device, and these tablets are set to
 * Portuguese: 40648 printed as "40.648", directly beside "48.512 planned", on a card
 * whose every other figure is a percentage or a count of days. The dot reads as a
 * decimal point and the output of a shift reads as forty. The rest of the app already
 * pins its locale; this card was the one that did not.
 */
const fmt = (n: number) => n.toLocaleString("en-GB");

/** A section heading and the hairline that closes it — the card's only structural rule. */
function SectionHead({ id, icon: Icon, children, aside }: {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-baseline gap-2 border-b pb-1.5">
      <Icon className="h-4 w-4 shrink-0 self-center text-muted-foreground" />
      <h3 id={id} className="font-display text-xs font-bold uppercase tracking-[0.14em]">
        {children}
      </h3>
      {aside && <span className="text-2xs text-muted-foreground">{aside}</span>}
    </div>
  );
}

export function LeaderScorecardBody({ leaderName, period, result }: {
  leaderName: string | null;
  period: ScorecardPeriod;
  result: ScorecardResult;
}) {
  const { quality: q, docs, production: p, score, actions, woRequests, woStopped } = result;

  /**
   * The three parts of the score, and what each is worth.
   *
   * A component with no data is dropped rather than drawn empty: computeScorecard
   * leaves it out and shares its weight between the others, so a segment sitting at
   * zero would claim a failure where there was only nothing to measure.
   */
  const parts = ([
    ["Production", score.production, score.applied.production_pct],
    ["Quality", score.quality, score.applied.quality_pct],
    ["Documentation", score.documentation, score.applied.documentation_pct],
  ] as const).filter(([, c, w]) => c.value !== null && w > 0);

  const dropped = ([
    ["Production", score.production], ["Quality", score.quality], ["Documentation", score.documentation],
  ] as const).filter(([, c]) => c.value === null).map(([label]) => label);

  const barLabel = `How this score was built. ${parts
    .map(([label, c, w]) => `${label} ${displayScore(c.value)}% of 100, counting ${w}%`)
    .join(". ")}.`;

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

      {/* The score, and the arithmetic behind it, as one object.

          This was a number beside three equal bordered boxes, one of which carried the
          words "weight 40%". Equal boxes claim the parts are equal; they are 40/30/30.
          Here each part is given the WIDTH it actually counts for and filled to what it
          scored, so 83/100/100 → 93 can be read off the shape before a digit is. The
          leader this card is about has to be able to check it, which is why none of it
          hides behind a tooltip.

          Navy on the brand's --section, the same panel ModuleHeader uses, so the one
          number the screen exists for is the one thing that is not a white card. It
          goes back to ink on paper for print — the page is meant to be handed over. */}
      <div className="rounded-xl bg-[hsl(var(--section))] p-4 text-white shadow-sm sm:p-5 print:rounded-none print:border print:bg-white print:p-0 print:text-black print:shadow-none">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-7">
          <div className="shrink-0">
            <p className="font-display text-2xs font-bold uppercase leading-none tracking-[0.18em] text-white/60 print:text-black/50">
              Final score
            </p>
            <p className="mt-2 font-figure text-6xl font-semibold leading-none tracking-[-0.03em] sm:text-7xl">
              {score.final === null ? "—" : displayScore(score.final)}
              {score.final !== null && <span className="align-top text-2xl font-medium text-white/50 sm:text-3xl print:text-black/40">%</span>}
            </p>
          </div>

          {/* Width = what it counts for. Fill = what it scored.

              `grow basis-0` rather than `flex-1`, which is the same thing in the
              browser and not on paper: index.css prints with
              `.print-content [class*="flex"] { display: flex !important }`, and that
              substring catches `flex-1` too. This column became a flex ROW on the
              printed page, and the caption below the bars was laid out beside them,
              on top of the Documentation label. */}
          <div className="min-w-0 grow basis-0">
            <div role="img" aria-label={barLabel} className="flex items-end gap-1.5">
              {parts.map(([label, c, w]) => (
                <div key={label} role="presentation" style={{ flexGrow: w }} className="min-w-0 basis-0">
                  {/* "Documentation" needs 99px and the narrow segment offers about 94
                      at 390px, so it clipped to "DOCUMENTATI…". The word is shortened
                      rather than the type, and only where the room runs out. */}
                  <span className="block truncate font-display text-[10px] font-bold uppercase tracking-[0.08em] text-white/60 print:text-black/50">
                    <span className="sm:hidden">{label === "Documentation" ? "Docs" : label}</span>
                    <span className="hidden sm:inline">{label}</span>
                  </span>
                  <div className="mt-1.5 h-3 overflow-hidden rounded-sm bg-white/15 print:border print:border-black/30 print:bg-white">
                    <div
                      className="h-full rounded-sm bg-white/90 print:bg-black/75"
                      style={{ width: `${Math.max(0, Math.min(100, c.value ?? 0))}%` }}
                    />
                  </div>
                  <p className="mt-1.5 font-figure text-base font-semibold leading-none sm:text-lg">
                    {displayScore(c.value)}%
                  </p>
                  {/* "of 40%" beside "85%" read as 85% OF 40%, which is 34 — the one
                      arithmetic this panel exists to make unambiguous. */}
                  <p className="mt-1 truncate font-figure text-2xs text-white/50 print:text-black/50">
                    counts {w}%
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-2xs text-white/50 print:text-black/50">
              Each block is as wide as it counts for, and as full as it scored.
            </p>
          </div>
        </div>

        {/* How each number was arrived at. On the panel rather than under it: the basis
            is the part a leader argues with, and it belongs beside the claim. */}
        <ul className="mt-4 grid gap-1 border-t border-white/15 pt-3 text-2xs text-white/70 sm:grid-cols-3 print:border-black/20 print:text-black/70">
          <li><b className="font-semibold text-white/90 print:text-black">Production</b> · {score.production.basis}</li>
          <li><b className="font-semibold text-white/90 print:text-black">Quality</b> · {score.quality.basis}</li>
          <li><b className="font-semibold text-white/90 print:text-black">Documentation</b> · {score.documentation.basis}</li>
        </ul>
        {docs.pending.length > 0 && (
          <p className="mt-2 text-2xs text-amber-200 print:text-black">
            {docs.pending.length} paperwork action{docs.pending.length === 1 ? "" : "s"} awaiting a verdict from
            Quality — counted in the quality score while open. Validating {docs.pending.length === 1 ? "it" : "them"} moves
            the charge here instead of adding to it: −{docs.penaltyPct}% documentation, and the quality score gives it back.
          </p>
        )}
        {dropped.length > 0 && (
          <p className="mt-2 text-2xs text-amber-200 print:text-black">
            {dropped.join(" and ")} {dropped.length === 1 ? "is" : "are"} not counted in this period — there was
            nothing to measure {dropped.length === 1 ? "it" : "them"} on, so the weight is shared between the rest
            rather than scored as zero.
          </p>
        )}
      </div>

      {/* Quality. The icon was a clock — the section is not about time. */}
      <section aria-labelledby="sc-quality">
        <SectionHead id="sc-quality" icon={AlertTriangle}>Quality</SectionHead>

        {q.total === 0 ? (
          /* A period with no action used to print Total actions 0, Open 0, % closed 0%,
             Avg resolution —, and four severity badges reading 0: nine pieces of
             furniture for one fact, and the fact was the good news. Say it once. */
          <p className="text-sm text-muted-foreground">
            No quality action was raised against this leader in this period.
            {docs.pending.length > 0 && ` ${docs.pending.length} raised elsewhere is still under review.`}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Figure label="Total actions" value={fmt(q.total)} />
              <Figure label="Open" value={fmt(q.open)} tone={q.open > 0 ? "owed" : "neutral"} />
              {/* Earned only at a hundred. It carried the earned tone unconditionally,
                  so a leader who had closed none of four was shown a green 0% standing
                  on the rule that means "earned" on every other screen here. */}
              <Figure
                label="% closed"
                value={`${q.pctClosed}%`}
                tone={q.pctClosed === 100 ? "earned" : "neutral"}
                hint={`${fmt(q.completed)} of ${fmt(q.total)} completed`}
              />
              <Figure
                label="Avg resolution"
                value={q.avgResolution == null ? "—" : `${q.avgResolution.toFixed(1)}d`}
                hint="created → complete"
              />
            </div>
            {/* Only the severities actually present. A row of four zeros is four
                claims that nothing happened, said in the colours of alarm. */}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {QUALITY_SEVERITIES.slice().reverse()
                .filter((s) => (q.sev[s.value] ?? 0) > 0)
                .map((s) => (
                  <Badge key={s.value} variant="outline" className={cn("text-2xs", severityMeta(s.value)?.badge)}>
                    {s.label}: {q.sev[s.value]}
                  </Badge>
                ))}
            </div>
          </>
        )}
      </section>

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
      <section aria-labelledby="sc-docs">
        <SectionHead id="sc-docs" icon={FileWarning} aside={DOCUMENTATION_LABEL}>
          Documentation errors
        </SectionHead>

        {docs.penalised.length === 0 && docs.pending.length > 0 ? (
          /* Nothing validated, so nothing is charged — but a green "100% compliant"
             over cases nobody has judged yet is the card vouching for a record it has
             not seen. Amber says the true thing: no penalty so far, and here is what
             is still on the table. The score itself does not move. */
          <div className="rounded-lg border border-warning/40 bg-warning/5 p-3">
            <p className="text-sm font-semibold text-warning-strong">
              No penalty yet · {docs.pending.length} under review
            </p>
            <p className="text-2xs text-muted-foreground">
              No validated {DOCUMENTATION_LABEL.toLowerCase()} action in this period, so nothing is charged.
              {" "}A verdict on {docs.pending.length === 1 ? "it" : "them"} would cost up to −{docs.pendingImpactPct}%.
              {docs.rejected.length > 0 && ` ${docs.rejected.length} rejected by Quality.`}
            </p>
          </div>
        ) : docs.penalised.length === 0 ? (
          <div className="rounded-lg border border-success/40 bg-success/5 p-3">
            <p className="text-sm font-semibold text-success-strong">No penalty · 100% compliant</p>
            <p className="text-2xs text-muted-foreground">
              No validated {DOCUMENTATION_LABEL.toLowerCase()} action in this period.
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
                    <span className="font-semibold text-destructive-strong">−{docs.penaltyPct}%</span>
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
      </section>

      {/* Production */}
      <section aria-labelledby="sc-production">
        <SectionHead
          id="sc-production"
          icon={Factory}
          aside={`${fmt(p.sessions)} session${p.sessions === 1 ? "" : "s"}`}
        >
          Production
        </SectionHead>
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
                hint={p.attainment == null ? "no RAG plan for these sessions" : `${fmt(p.actualQty)} of ${fmt(p.targetQty)} planned`}
              />
              <Figure label="Output" value={fmt(p.output)} hint="logged on My Production" />
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
      </section>
    </div>
  );
}
