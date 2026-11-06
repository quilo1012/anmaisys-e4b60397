import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CircleDashed, RefreshCw, Target } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useSkuCatalogue } from "@/hooks/useSkuCatalogue";
import { useItouchCycles } from "@/hooks/useItouchCycles";
import { useSmartTargetHistory } from "@/hooks/useSmartTargetHistory";
import { useSmartTargetQueue, type QueueState } from "@/hooks/useSmartTargetQueue";
import { planFromQueue } from "@/lib/smartTargetAhead";
import { fillFromQueue } from "@/lib/smartTargetQueue";
import { useFreezeSmartTargetForecasts, useSmartTargetForecastRows, type LineToFreeze } from "@/hooks/useSmartTargetForecastLog";
import {
  accuracyByLine,
  actualTotals,
  lineVisibility,
  ON_TIME_MINUTES,
  SHOW_MAX_MEDIAN_ERROR,
  SHOW_MIN_SCORED,
  type LineAccuracy,
} from "@/lib/smartTargetAccuracy";
import { FORECAST_LINES, HELD_BACK_REASON, historyFromSessions } from "@/lib/smartTargetHistory";
import {
  cleanCycles,
  cyclesToFix,
  lineFactors,
  lineRates,
  BASE_LINES,
  BASE_SOURCE,
  ESTIMATED_SOURCE,
  withEstimates,
  LINE_RATES_CONFIG,
  OBSERVED_SOURCE,
  productsWithoutCode,
  type CycleToFix,
  type LineFactor,
} from "@/lib/smartTargetRates";
import { ItouchCyclesCard } from "@/components/smartTarget/ItouchCyclesCard";
import { getCurrentFactoryShift } from "@/lib/shifts";
import { cn } from "@/lib/utils";
import { forecastShift, type JobForecast, type LineNo, type ShiftForecast, type ShiftType } from "@/lib/smartTargetEngine";
import {
  buildShiftInputs,
  previousShiftOf,
  lineGaps,
  setupMinutes,
  MISSING_INPUTS,
  type SmartTargetItem,
  type SmartTargetSession,
} from "@/lib/smartTargetInput";

/**
 * Smart Target: what each line can be expected to fill this shift, how the number was
 * made, and, line by line, what is still missing where there is no number.
 *
 * Each line is drawn as its run of jobs in iTouch order, with the changeovers between
 * them. It saves the running shift's forecast once and never changes a target anywhere
 * else. A line with no rate reads "—": a stand-in number would hide the gap.
 */

const STATUS: Record<ShiftForecast["status"], { label: string; className: string }> = {
  ok: { label: "Forecast", className: "bg-success/15 text-success-strong border-success/30" },
  partial: { label: "Partial", className: "bg-warning/15 text-warning-strong border-warning/30" },
  insufficient_data: { label: "Not enough data", className: "bg-muted text-muted-foreground border-border" },
  invalid_input: { label: "Invalid input", className: "bg-destructive/10 text-destructive border-destructive/30" },
};

/** The rates item once factors are computed: what is live, and what is held back. */
const RATES_LIVE = {
  label: "Rates: every line, on the tablet once it proves itself",
  why: `Rates come from each line's base (its logged shifts, the Standard Line Targets reports and iTouch), then iTouch's ideal speed × the line's performance over the last eight weeks, then the rate the line reached on shifts that filled only that product (all provisional). The office sees every line. A line's number reaches the tablet while its last ${SHOW_MIN_SCORED}+ measured shifts miss by a median of ${SHOW_MAX_MEDIAN_ERROR}% or less.`,
  owner: "Production: correct the cycles listed under Fix in iTouch",
};

const londonTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });

/** One line under the summary: where this shift's order quantities come from. */
function queueText(state: QueueState | null): string | null {
  if (!state) return null;
  switch (state.kind) {
    case "saved": return `Order quantities: iTouch queue read at ${londonTime(state.fetchedAt)}.`;
    case "reading": return "Reading the iTouch queue for order quantities…";
    case "not_current": return "Order quantities: no iTouch queue was saved for this shift, and iTouch can only be read for the shift running now.";
    case "not_installed": return "Order quantities from iTouch need BLOCO 147 pasted in the PMSYSTEM SQL editor.";
    case "empty": return `Order quantities: ${state.reason}. Jobs without a quantity use the end-of-shift rule.`;
    case "error": return `Order quantities: the iTouch queue could not be read (${state.message}).`;
  }
}

const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toLocaleString());

function ShiftSwitch({ value, onChange }: { value: ShiftType; onChange: (v: ShiftType) => void }) {
  const options: { value: ShiftType; label: string; hint: string }[] = [
    { value: "DAY", label: "Day", hint: "06:00–18:00" },
    { value: "NIGHT", label: "Night", hint: "18:00–06:00" },
  ];
  return (
    <div role="group" aria-label="Shift" className="inline-flex items-center gap-1 rounded-lg border bg-muted/40 p-1">
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            title={o.hint}
            onClick={() => onChange(o.value)}
            className={cn(
              "h-8 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? o.value === "DAY" ? "bg-warning text-warning-foreground shadow-sm" : "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-background",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** What happens between two jobs, in the gap between their blocks. */
function Transition({ job }: { job: JobForecast }) {
  const minutes = job.changeoverMinutes + job.mixingMinutes;
  if (job.transition === "sku_unknown") {
    return (
      <span className="self-center px-1 text-2xs text-muted-foreground" title="This job or the one before it has no SKU, so no changeover is charged.">
        ?
      </span>
    );
  }
  if (job.transition === "same_sku" && minutes === 0) {
    return <ArrowRight className="h-4 w-4 shrink-0 self-center text-muted-foreground/60" aria-label="Same SKU, no changeover" />;
  }
  const parts = [
    job.changeoverMinutes > 0 && `change ${job.changeoverMinutes}`,
    job.mixingMinutes > 0 && `mix ${job.mixingMinutes}`,
  ].filter(Boolean);
  return (
    <div
      className="flex shrink-0 flex-col items-center justify-center rounded-md border border-dashed border-warning/50 bg-warning/10 px-2 py-1 text-center text-2xs leading-tight text-warning-strong"
      title={job.transition === "first_unknown" ? "What ran before the shift is unknown, so no changeover is charged." : undefined}
    >
      <span className="font-medium">{job.transition === "sku_change" ? "SKU change" : "Start"}</span>
      <span className="tabular-nums">{parts.join(" + ")} min</span>
    </div>
  );
}

function JobBlock({ job }: { job: JobForecast }) {
  return (
    <div className="min-w-[7.5rem] flex-1 rounded-md border bg-card px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-2xs tabular-nums text-muted-foreground">{job.sequence}</span>
        <span className="text-sm font-semibold tabular-nums">{fmt(job.expectedContainers)}</span>
      </div>
      <div className="truncate font-mono text-xs font-medium" title={job.sku ?? "No SKU"}>{job.sku ?? "No SKU"}</div>
      <div className="text-2xs text-muted-foreground">Order {fmt(job.orderQty)}</div>
      {job.allocation?.basis === "order_qty_at_rate" && (
        <div className="text-2xs text-warning-strong">
          {job.allocation.completesOrder ? "Order completes at this rate" : "Cut short: rate × time left"}
        </div>
      )}
      {job.rate?.source.startsWith(ESTIMATED_SOURCE) && (
        <div className="text-2xs text-warning-strong" title={job.rate.source}>
          Estimated: no rate for this product
        </div>
      )}
      {job.rate?.source.startsWith(BASE_SOURCE) && (
        <div className="text-2xs text-muted-foreground" title={job.rate.source}>
          Rate from the line's base ({job.rate.sampleShifts} shifts)
        </div>
      )}
      {job.rate?.source.startsWith(OBSERVED_SOURCE) && (
        <div className="text-2xs text-muted-foreground" title={job.rate.source}>
          Rate observed on this line ({job.rate.sampleShifts} shifts)
        </div>
      )}
      {job.allocation?.basis === "runs_to_shift_end" && (
        <div className="text-2xs text-warning-strong">No order quantity: runs to the end of the shift</div>
      )}
    </div>
  );
}

interface RateBasis {
  factor: LineFactor | null;
  /** Null when the number reaches the tablet; otherwise why it stays in the office. */
  heldBack: string | null;
  from: string;
  to: string;
}

function LineCard({ line, result, notes, basis }: { line: number; result: ShiftForecast; notes: string[]; basis: RateBasis | null }) {
  const status = STATUS[result.status];
  if (!result.jobs.length) {
    return (
      <Card data-testid={`smart-target-line-${line}`} className="border-dashed bg-muted/20">
        <CardContent className="flex items-center justify-between gap-3 py-4">
          <div className="flex items-center gap-3">
            <CircleDashed className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-semibold">Line {line}</h3>
          </div>
          <span className="text-sm text-muted-foreground">No plan for this shift</span>
        </CardContent>
      </Card>
    );
  }
  const gaps = lineGaps(result);
  // Every warning the engine raised for this line, once each. Two are left out because
  // they would say the same on every line: the previous SKU is listed once at the bottom
  // of the page, and every job is sized from its order since iTouch's expected times
  // are not used (Q20); the job block itself says which ones complete.
  const warnings = [
    ...notes,
    ...new Set(
      result.warnings
        // The job block already says how its time was set.
        .filter((w) => w.code !== "DURATION_FROM_ORDER_QTY" && w.code !== "RUNS_TO_SHIFT_END")
        .map((w) => w.message),
    ),
  ];
  const setup = setupMinutes(result);
  return (
    <Card data-testid={`smart-target-line-${line}`}>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0 pb-3">
        <div className="space-y-1">
          <h3 className="text-lg font-semibold leading-none tracking-tight">Line {line}</h3>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline" className={cn("font-medium", status.className)}>{status.label}</Badge>
            {basis?.heldBack && <Badge variant="outline" className="font-medium">Office only</Badge>}
            {result.expectedTotal !== null && (
              <Badge variant="outline" className="font-medium">
                {result.confidence === "medium" ? "Medium confidence" : "Low confidence"}
              </Badge>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className="text-3xl font-semibold tabular-nums leading-none">{fmt(result.expectedTotal)}</div>
          <div className="mt-1 text-xs text-muted-foreground">expected containers</div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <div className="flex min-w-max gap-2 sm:min-w-0 sm:flex-wrap">
            {result.jobs.map((j, i) => (
              <Fragment key={j.jobId}>
                {(i > 0 || j.changeoverMinutes + j.mixingMinutes > 0) && <Transition job={j} />}
                <JobBlock job={j} />
              </Fragment>
            ))}
          </div>
        </div>
        <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
          <dt className="text-muted-foreground">Rate</dt>
          <dd>
            {basis?.factor?.factor != null
              ? `${BASE_LINES.includes(line as LineNo) ? "The line's base where it knows the product, then " : ""}iTouch ideal × ${Math.round(basis.factor.factor * 100)}%, this line's performance over ${basis.factor.shiftsUsed} shifts (${basis.from} to ${basis.to})`
              : basis
                ? `${BASE_LINES.includes(line as LineNo) ? "The line's base where it knows the product. " : ""}No performance factor yet: ${basis.factor?.shiftsUsed ?? 0} measurable shifts between ${basis.from} and ${basis.to}, 5 needed.`
                : "Loading the last eight weeks…"}
          </dd>
          {basis?.heldBack && (
            <>
              <dt className="text-muted-foreground">Tablet</dt>
              <dd>{basis.heldBack}</dd>
            </>
          )}
          <dt className="text-muted-foreground">Changeover and mixing</dt>
          <dd className="tabular-nums">{setup} min <span className="text-muted-foreground">(provisional durations)</span></dd>
          {gaps.length > 0 && (
            <>
              <dt className="text-muted-foreground">Why no number</dt>
              <dd>
                <ul className="space-y-0.5">{gaps.map((g) => <li key={g}>{g}</li>)}</ul>
              </dd>
            </>
          )}
          {warnings.length > 0 && (
            <>
              <dt className="text-muted-foreground">Notes</dt>
              <dd>
                <ul className="space-y-0.5 text-muted-foreground">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
              </dd>
            </>
          )}
        </dl>
      </CardContent>
    </Card>
  );
}

const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "—");

/** How the frozen forecasts did against what was logged, per line, over four weeks. */
function AccuracyCard({ accuracy, installed, shown }: { accuracy: LineAccuracy[] | null; installed: boolean; shown: ReadonlySet<number> }) {
  return (
    <Card data-testid="smart-target-accuracy">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">How close the forecasts were</CardTitle>
        <p className="text-sm text-muted-foreground">
          Last four weeks. Each shift's forecast is kept as it was first made; only those made in the first{" "}
          {ON_TIME_MINUTES / 60} hours of the shift count. Actual is what operators logged (provisional until iTouch's
          filling events are confirmed). A line's number reaches the tablet while it has at least {SHOW_MIN_SCORED} measured
          shifts and a median miss of {SHOW_MAX_MEDIAN_ERROR}% or less.
        </p>
      </CardHeader>
      <CardContent>
        {!installed ? (
          <p className="text-sm">Keeping forecasts needs BLOCO 148 pasted in the PMSYSTEM SQL editor.</p>
        ) : !accuracy ? (
          <Skeleton className="h-24" />
        ) : accuracy.every((a) => a.scored === 0) ? (
          <p className="text-sm text-muted-foreground">
            No closed shift has a forecast made in its first {ON_TIME_MINUTES / 60} hours yet. Open this page early in each shift
            and the first figures appear the day after.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3 font-medium">Line</th>
                  <th className="py-1 pr-3 text-right font-medium">Shifts measured</th>
                  <th className="py-1 pr-3 text-right font-medium">Median error</th>
                  <th className="py-1 pr-3 text-right font-medium">Within ±10%</th>
                  <th className="py-1 pr-3 text-right font-medium">Within ±20%</th>
                  <th className="py-1 font-medium">Not counted</th>
                </tr>
              </thead>
              <tbody>
                {accuracy.map((a) => (
                  <tr key={a.line} className="border-t">
                    <td className="py-1.5 pr-3">Line {a.line}{shown.has(a.line) ? "" : " (office only)"}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{a.scored}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{a.medianAbsPctError === null ? "—" : `${a.medianAbsPctError}%`}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{pct(a.within10, a.scored)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{pct(a.within20, a.scored)}</td>
                    <td className="py-1.5 text-xs text-muted-foreground">
                      {[
                        a.frozenLate && `${a.frozenLate} made late`,
                        a.noNumber && `${a.noNumber} without a number`,
                        a.noActual && `${a.noActual} with nothing logged`,
                      ].filter(Boolean).join(", ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The short list for iTouch (Q44a): only the products the lines actually filled in the
 * last eight weeks that have no usable cycle, so the fix is a handful of rows instead of
 * every rejected record. Under it, what was typed instead of picked from the product list.
 */
function FixInItouchCard({ fix, noCode }: { fix: CycleToFix[] | null; noCode: { line: number; text: string; qty: number }[] }) {
  if (!fix) return null;
  return (
    <Card data-testid="smart-target-fix-itouch">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Fix in iTouch</CardTitle>
        <p className="text-sm text-muted-foreground">
          Products filled in the last eight weeks that have no usable cycle time in iTouch for that line. Correct them in
          iTouch's Product Details, export it again and load it in the iTouch cycles card below.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {fix.length === 0 ? (
          <p className="text-sm text-muted-foreground">Every product filled in the last eight weeks has a usable cycle time.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1.5 pr-3 font-medium">Line</th>
                  <th className="py-1.5 pr-3 font-medium">Product</th>
                  <th className="py-1.5 pr-3 font-medium">In iTouch now</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Filled, 8 weeks</th>
                  <th className="py-1.5 font-medium">Meanwhile</th>
                </tr>
              </thead>
              <tbody>
                {fix.map((f) => (
                  <tr key={`${f.line}|${f.sku}`} className="border-t align-top">
                    <td className="py-1.5 pr-3">Line {f.line}</td>
                    <td className="py-1.5 pr-3 font-mono text-xs">{f.sku}</td>
                    <td className="py-1.5 pr-3">
                      {f.itouchSeconds !== null ? `${f.itouchSeconds} s` : "—"}
                      <div className="text-xs text-muted-foreground">{f.problem}</div>
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">
                      {f.madeQty.toLocaleString()}
                      <div className="text-xs text-muted-foreground">{f.shifts} shifts</div>
                    </td>
                    <td className="py-1.5 text-xs text-muted-foreground">
                      {f.coveredMeanwhile ? "Has a rate from the line's base or history" : "No number for jobs of this product"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {noCode.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer font-medium">
              Logged with a product that is not in the product list ({noCode.length})
            </summary>
            <p className="mt-1 text-muted-foreground">
              Typed in Production Control instead of picked from the list, so these shifts count for no line's performance.
              Pick the product from the list, or add the missing code to the product list.
            </p>
            <ul className="mt-2 space-y-0.5">
              {noCode.slice(0, 20).map((n) => (
                <li key={`${n.line}|${n.text}`}>
                  Line {n.line}: {n.text} <span className="tabular-nums text-muted-foreground">({n.qty.toLocaleString()})</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

export default function SmartTargetPage() {
  const now = getCurrentFactoryShift();
  const [date, setDate] = useState(now.sessionDate);
  const [shift, setShift] = useState<ShiftType>(now.shiftCode === "day" ? "DAY" : "NIGHT");
  const { catalogue, isLoading: skusLoading } = useSkuCatalogue();
  const cyclesQuery = useItouchCycles();
  const historyQuery = useSmartTargetHistory(date);
  const queue = useSmartTargetQueue(date, shift);

  // Each line's performance over the eight weeks before `date`, against iTouch's ideal.
  const rateBasis = useMemo(() => {
    if (!cyclesQuery.data || !historyQuery.data) return null;
    const { cycles, rejected } = cleanCycles(cyclesQuery.data.records);
    // No cycles loaded: there is no ideal to scale, so no factor and no rate to show.
    if (!cycles.length) return null;
    const history = historyFromSessions(historyQuery.data.sessions, historyQuery.data.items, catalogue);
    const factors = lineFactors(history, cycles);
    return { cycles, factors, history, fix: cyclesToFix(history, cycles, rejected), noCode: productsWithoutCode(history), from: historyQuery.data.from, to: historyQuery.data.to };
  }, [cyclesQuery.data, historyQuery.data, catalogue]);

  // Which lines are shown comes from their own measured record (Q45a), so the kept
  // forecasts are read before the forecast is built.
  const forecastRows = useSmartTargetForecastRows(date);
  const accuracy = useMemo(() => {
    if (!forecastRows.data?.installed || !historyQuery.data) return null;
    const history = historyFromSessions(historyQuery.data.sessions, historyQuery.data.items, catalogue);
    return accuracyByLine(forecastRows.data.rows, actualTotals(history));
  }, [forecastRows.data, historyQuery.data, catalogue]);
  const visibility = useMemo(() => lineVisibility(accuracy, FORECAST_LINES, HELD_BACK_REASON), [accuracy]);
  const shownSet = useMemo(() => new Set(visibility.filter((v) => v.shown).map((v) => v.line as number)), [visibility]);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["smart_target_inputs", date],
    queryFn: async () => {
      const { data: sessions, error: sErr } = await supabase
        .from("production_sessions")
        .select("id, line, session_date, shift, started_at")
        // The shift being forecast and the one before it, for the starting SKU (Q17).
        .gte("session_date", previousShiftOf(date, "DAY").date)
        .lte("session_date", date);
      if (sErr) throw sErr;
      const ids = (sessions ?? []).map((s) => s.id);
      if (!ids.length) return { sessions: [] as SmartTargetSession[], items: [] as SmartTargetItem[] };
      const { data: items, error: iErr } = await supabase
        .from("production_items")
        .select("id, session_id, display_order, sku_id, sku_code_text, planned_qty")
        .in("session_id", ids);
      if (iErr) throw iErr;
      return { sessions: (sessions ?? []) as SmartTargetSession[], items: (items ?? []) as SmartTargetItem[] };
    },
  });

  const built = useMemo(() => {
    if (!data) return null;
    const inputs = buildShiftInputs(date, shift, data.sessions, data.items, catalogue);
    return {
      otherLines: inputs.otherLines,
      lines: inputs.lines.map((l) => {
        const factor = rateBasis?.factors.find((f) => f.line === l.line) ?? null;
        const vis = visibility.find((v) => v.line === l.line);
        const shown = vis?.shown ?? false;
        const ownRates = rateBasis ? lineRates(l.line, rateBasis.cycles, factor, rateBasis.history) : [];
        const basis: RateBasis | null = rateBasis
          ? { factor, heldBack: shown ? null : vis?.heldBack ?? null, from: rateBasis.from, to: rateBasis.to }
          : null;
        // Plan rows with no quantity take what was left of iTouch's order for the same SKU
        // when the queue was read (Q26b).
        const fromQueue = fillFromQueue(l.line, l.input.jobs, queue.rows);
        // Nothing logged on this line yet: the plan is what iTouch has queued for it (Q32a).
        // Once Production Control has a plan for the line, that plan answers instead.
        const queuePlan = l.input.jobs.length ? null : planFromQueue(l.line, queue.rows, 0, ownRates);
        const usesQueuePlan = !!queuePlan?.jobs.length;
        const input = usesQueuePlan
          ? { ...l.input, jobs: queuePlan.jobs, previousSku: queuePlan.previousSku ?? l.input.previousSku }
          : { ...l.input, jobs: fromQueue.jobs };
        const notes = usesQueuePlan
          ? [...l.notes, `Plan from the iTouch queue read at ${londonTime(queue.rows[0].fetched_at)}: Production Control has nothing for this line yet.`, ...queuePlan.notes]
          : fromQueue.filled
          ? [...l.notes, `Order quantity for ${fromQueue.filled} job${fromQueue.filled === 1 ? "" : "s"} from the iTouch queue read at ${londonTime(queue.rows[0].fetched_at)}: what was left to make then.`]
          : l.notes;
        const result = forecastShift({ ...input, rates: withEstimates(l.line, input.jobs.map((j) => j.sku), ownRates) }, LINE_RATES_CONFIG);
        return { ...l, notes, basis, result, shown, factor };
      }),
    };
  }, [data, date, shift, catalogue, rateBasis, queue.rows, visibility]);

  const toFreeze = useMemo<LineToFreeze[] | null>(
    () => built?.lines.map((l) => ({ line: l.line, shown: l.shown, forecast: l.result, factor: l.factor })) ?? null,
    [built],
  );
  // Freeze only a complete forecast: rates known, and the iTouch queue read (or known to be unavailable).
  const readyToFreeze = !!rateBasis && !!queue.state && queue.state.kind !== "reading";
  useFreezeSmartTargetForecasts(date, shift, toFreeze, readyToFreeze, forecastRows);

  const loading = isLoading || skusLoading;
  const assumptions = built?.lines[0]?.result.assumptions ?? [];
  const planned = built?.lines.filter((l) => l.result.jobs.length) ?? [];
  const forecast = planned.filter((l) => l.result.expectedTotal !== null);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <PageHeader
          module="Production"
          title="Smart Target"
          description="What each line can be expected to fill this shift, and what is still missing to say it"
          icon={<Target className="h-5 w-5" />}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="date"
                aria-label="Shift date"
                value={date}
                onChange={(e) => e.target.value && setDate(e.target.value)}
                className="h-10 w-40"
              />
              <ShiftSwitch value={shift} onChange={setShift} />
            </div>
          }
        />

        {error ? (
          <Card className="border-destructive/40">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4 text-sm">
              <span className="text-destructive">The production plan for {date} could not be loaded: {(error as Error).message}</span>
              <button type="button" onClick={() => refetch()} className="inline-flex items-center gap-1.5 font-medium underline-offset-4 hover:underline">
                <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} /> Try again
              </button>
            </CardContent>
          </Card>
        ) : loading || !built ? (
          <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-36" />)}</div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {planned.length === 0
                ? "No line has a plan for this shift, in Production Control or in the iTouch queue."
                : `${planned.length} of 6 lines have a plan. ${forecast.length} can be forecast.`}
            </p>
            {queueText(queue.state) && <p className="text-sm text-muted-foreground">{queueText(queue.state)}</p>}
            <div className="space-y-3">
              {built.lines.map(({ line, result, notes, basis }) => (
                <LineCard key={line} line={line} result={result} notes={notes} basis={basis} />
              ))}
            </div>
            {built.otherLines.length > 0 && (
              <p className="text-sm text-muted-foreground">
                Also planned, but outside this version (Lines 1–6 only): {built.otherLines.join(", ")}.
              </p>
            )}
          </>
        )}

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">What the forecast still needs</CardTitle>
            <p className="text-sm text-muted-foreground">
              Until each of these arrives, the page shows "—". It never fills a gap with a default or an estimate.
            </p>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-3 md:grid-cols-2">
              {MISSING_INPUTS.map((m) =>
                m.key === "rates" && rateBasis ? { ...m, ...RATES_LIVE } : m,
              ).map((m) => (
                <li key={m.key} className="rounded-md border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium">{m.label}</span>
                    <Badge variant="outline" className="shrink-0 text-2xs">Missing</Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{m.why}</p>
                  <p className="mt-1 text-xs"><span className="text-muted-foreground">From:</span> {m.owner}</p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <AccuracyCard accuracy={accuracy} installed={forecastRows.data?.installed ?? true} shown={shownSet} />

        <FixInItouchCard fix={rateBasis?.fix ?? null} noCode={rateBasis?.noCode ?? []} />

        <ItouchCyclesCard />

        {assumptions.length > 0 && (
          <details className="rounded-lg border bg-card p-4 text-sm">
            <summary className="cursor-pointer font-medium">Assumptions in use until Production confirms them</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
              {assumptions.map((a) => <li key={a}>{a}</li>)}
            </ul>
          </details>
        )}
      </div>
    </DashboardLayout>
  );
}
