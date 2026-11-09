import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ChevronRight, Download, Printer, RefreshCw, Target } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useSkuCatalogue } from "@/hooks/useSkuCatalogue";
import { useItouchCycles } from "@/hooks/useItouchCycles";
import { useSmartTargetHistory } from "@/hooks/useSmartTargetHistory";
import { useSmartTargetQueue, type QueueState } from "@/hooks/useSmartTargetQueue";
import { planFromQueue, productsOffPlan } from "@/lib/smartTargetAhead";
import { fillFromQueue } from "@/lib/smartTargetQueue";
import { useFreezeSmartTargetForecasts, useSmartTargetForecastRows, type LineToFreeze } from "@/hooks/useSmartTargetForecastLog";
import {
  accuracyByLine,
  actualTotals,
  lineCautions,
  targetVersusLogged,
  ON_TIME_MINUTES,
  SHOW_MAX_MEDIAN_ERROR,
  SHOW_MIN_SCORED,
  type LineAccuracy,
  type StoredForecast,
} from "@/lib/smartTargetAccuracy";
import { FORECAST_LINES, WIDE_MARGIN_LINES, historyFromSessions, skuFamily, skuIsSample } from "@/lib/smartTargetHistory";
import {
  cleanCycles,
  cyclesToFix,
  lineFactors,
  planRates,
  NO_HISTORY_SOURCE,
  SAMPLE_SOURCE,
  explainTarget,
  fixSuggestion,
  type FixSuggestion,
  ESTIMATED_SOURCE,
  FAMILY_SOURCE,
  LINE_RATES_CONFIG,
  productsWithoutCode,
  type CycleToFix,
  type LineFactor,
} from "@/lib/smartTargetRates";
import { ItouchCyclesCard } from "@/components/smartTarget/ItouchCyclesCard";
import { ShiftStrip, stripHours, stripSegments } from "@/components/smartTarget/ShiftStrip";
import { ShiftReport } from "@/components/smartTarget/ShiftReport";
import { useShiftRuns } from "@/hooks/useShiftRuns";
import { endedBeforeHalfway, shiftOutcome } from "@/lib/shiftOutcome";
import { useShiftReportData } from "@/hooks/useShiftReportData";
import { jobsInTarget, lineReport, londonTime, plannedProducts, machineClock, stopsByReason, type LineReport } from "@/lib/shiftReport";
import { printElementAsDocument } from "@/lib/printDocument";
import * as XLSX from "xlsx";
import { getCurrentFactoryShift } from "@/lib/shifts";
import { identifyItemSku } from "@/lib/lineSku";
import { cn } from "@/lib/utils";
import { forecastShift, shiftWindow, type JobForecast, type LineNo, type ShiftForecast, type ShiftType } from "@/lib/smartTargetEngine";
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
  label: "Rates: every line",
  why: `Each product's rate is what the line did on its last 5 shifts of it. With no history there, iTouch's ideal speed × the line's performance, marked as an estimate. Sample bags count by the batch, about 3 h each. All provisional. Every line shows its number. A line missing by more than ${SHOW_MAX_MEDIAN_ERROR}% over ${SHOW_MIN_SCORED}+ measured shifts shows a caution beside it.`,
  owner: "Production: correct the cycles listed under Fix in iTouch",
};


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
        <div className="text-2xs text-warning-strong" title={job.rate.source}>Estimated: no rate for this product</div>
      )}
      {job.rate?.source.startsWith(NO_HISTORY_SOURCE) && (
        <div className="text-2xs text-warning-strong" title={job.rate.source}>No history here: estimate</div>
      )}
      {job.rate?.source.startsWith(SAMPLE_SOURCE) && (
        <div className="text-2xs text-muted-foreground" title={job.rate.source}>Sample batches: about 3 h each</div>
      )}
      {job.rate?.source.startsWith(FAMILY_SOURCE) && (
        <div className="text-2xs text-muted-foreground" title={job.rate.source}>Rate from the line's last {job.rate.sampleShifts} shifts of this product</div>
      )}
      {job.allocation?.basis === "runs_to_shift_end" && (
        <div className="text-2xs text-warning-strong">No order quantity: runs to the end of the shift</div>
      )}
    </div>
  );
}

interface RateBasis {
  factor: LineFactor | null;
  /** Null when the line is within the goal; otherwise the caution beside its number. */
  caution: string | null;
  from: string;
  to: string;
}

const MISS_WARNING = 15;

function LineRow({ line, result, notes, basis, kept, logged, offPlan, nowPct, report }: { line: number; result: ShiftForecast; notes: string[]; basis: RateBasis | null; kept: StoredForecast | null; logged: number; offPlan: string[]; nowPct: number | null; report: LineReport }) {
  const status = STATUS[result.status];
  const grid = "grid gap-x-4 gap-y-1.5 md:grid-cols-[4rem_minmax(0,1fr)_5.5rem_5rem_4rem] md:items-center";
  if (!result.jobs.length) {
    const row = (
      <>
        <h3 className="font-semibold text-muted-foreground">Line {line}</h3>
        <span className="text-sm text-muted-foreground">No plan for this shift</span>
      </>
    );
    // A line can run with no plan: it still gets its report.
    if (report.logged <= 0 && !report.stops.length && !report.clock) {
      return <div data-testid={`smart-target-line-${line}`} className={cn(grid, "px-4 py-3")}>{row}</div>;
    }
    return (
      <details data-testid={`smart-target-line-${line}`} className="group">
        <summary className={cn(grid, "cursor-pointer list-none px-4 py-3 hover:bg-muted/30")}>{row}</summary>
        <div className="border-t bg-muted/20 px-4 py-3 md:pl-[5.75rem]"><ShiftReport report={report} /></div>
      </details>
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
  const reasons = explainTarget(result.jobs);
  const miss = targetVersusLogged(kept?.expected_total, logged);
  const { noTime } = stripSegments(result);
  // Only the jobs that make up the target; what iTouch has queued after them is left out.
  const shown = jobsInTarget(result.jobs);
  const target = kept ? kept.expected_total : result.expectedTotal;
  return (
    <details data-testid={`smart-target-line-${line}`} className="group">
      <summary className={cn(grid, "cursor-pointer list-none px-4 py-3 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden")}>
        <h3 className="flex items-center gap-1 font-semibold">
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden="true" />
          <span className="whitespace-nowrap">Line {line}</span>
        </h3>
        <div className="min-w-0">
          <ShiftStrip result={result} nowPct={nowPct} />
          {(offPlan.length > 0 || noTime.length > 0) && (
            <div className="mt-1 space-y-0.5 text-xs">
              {offPlan.length > 0 && (
                <p className="font-medium text-warning-strong">
                  Plan changed: {offPlan.join(", ")} {offPlan.length === 1 ? "was" : "were"} not in it. The target stays as set.
                </p>
              )}
              {noTime.length > 0 && <p className="text-muted-foreground">No rate, so no time on the strip: {noTime.join(", ")}</p>}
            </div>
          )}
        </div>
        <dl className="grid grid-cols-3 gap-2 md:contents">
          <div className="md:text-right">
            <dt className="text-xs text-muted-foreground md:sr-only">Target</dt>
            <dd>
              <span className="text-lg font-semibold tabular-nums">{fmt(target)}</span>
              <span className="block text-2xs text-muted-foreground">{kept ? `set ${londonTime(kept.frozen_at)}` : "not set yet"}</span>
            </dd>
          </div>
          <div className="md:text-right">
            <dt className="text-xs text-muted-foreground md:sr-only">Logged</dt>
            <dd className="tabular-nums" data-testid={`smart-target-logged-${line}`}>{logged > 0 ? logged.toLocaleString() : "—"}</dd>
          </div>
          <div className="md:text-right">
            <dt className="text-xs text-muted-foreground md:sr-only">Miss</dt>
            <dd
              data-testid={`smart-target-miss-${line}`}
              className={cn("tabular-nums", miss !== null && Math.abs(miss) > MISS_WARNING ? "font-semibold text-destructive-strong" : "text-muted-foreground")}
            >
              {miss === null ? "—" : `${miss > 0 ? "+" : ""}${miss}%`}
            </dd>
          </div>
        </dl>
      </summary>
      <div className="space-y-3 border-t bg-muted/20 px-4 py-3 md:pl-[5.75rem]">
        <ShiftReport report={report} />
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline" className={cn("font-medium", status.className)}>{status.label}</Badge>
          {basis?.caution && <Badge variant="outline" className="font-medium">Wide margin</Badge>}
          {result.expectedTotal !== null && (
            <Badge variant="outline" className="font-medium">
              {result.confidence === "medium" ? "Medium confidence" : "Low confidence"}
            </Badge>
          )}
          {kept && kept.expected_total !== result.expectedTotal && (
            <span className="self-center text-xs tabular-nums text-muted-foreground">Calculated now: {fmt(result.expectedTotal)}</span>
          )}
        </div>
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <div className="flex min-w-max gap-2 sm:min-w-0 sm:flex-wrap">
            {shown.map((j, i) => (
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
              ? `The line's last shifts of each product, then iTouch ideal × ${Math.round(basis.factor.factor * 100)}%, this line's performance over ${basis.factor.shiftsUsed} shifts (${basis.from} to ${basis.to})`
              : basis
                ? `The line's last shifts of each product. No performance factor yet: ${basis.factor?.shiftsUsed ?? 0} measurable shifts between ${basis.from} and ${basis.to}, 5 needed.`
                : "Loading the last eight weeks…"}
          </dd>
          {basis?.caution && (
            <>
              <dt className="text-muted-foreground">Margin</dt>
              <dd>{basis.caution}</dd>
            </>
          )}
          {reasons.length > 0 && (
            <>
              <dt className="text-muted-foreground">Why this target</dt>
              <dd>
                <ul className="space-y-0.5">{reasons.map((r) => <li key={r}>{r}</li>)}</ul>
              </dd>
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
      </div>
    </details>
  );
}

/** Column heads over the strips: the hours of the shift, the three numbers, and where now is. */
function StripHeader({ shift, gross, nowPct }: { shift: ShiftType; gross: number; nowPct: number | null }) {
  return (
    <div className="hidden gap-x-4 border-b px-4 py-2 text-xs text-muted-foreground md:grid md:grid-cols-[4rem_minmax(0,1fr)_5.5rem_5rem_4rem]">
      <span />
      <div className="relative h-4">
        {stripHours(shift === "DAY" ? 6 : 18, gross).map((h) => (
          <span key={h.left} className="absolute -translate-x-1/2 tabular-nums first:translate-x-0 last:-translate-x-full" style={{ left: `${h.left}%` }}>{h.label}</span>
        ))}
        {nowPct !== null && (
          <span className="absolute top-0 -translate-x-1/2 rounded bg-foreground px-1 text-2xs font-medium leading-4 text-background" style={{ left: `${nowPct}%` }}>now</span>
        )}
      </div>
      <span className="text-right">Target</span>
      <span className="text-right">Logged</span>
      <span className="text-right">Miss</span>
    </div>
  );
}

const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "—");

/** How the frozen forecasts did against what was logged, per line, over four weeks. */
function AccuracyCard({ accuracy, installed }: { accuracy: LineAccuracy[] | null; installed: boolean }) {
  return (
    <Card data-testid="smart-target-accuracy">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">How close the forecasts were</CardTitle>
        <p className="text-sm text-muted-foreground">
          Last four weeks. Each shift's forecast is kept as it was first made; only those made in the first{" "}
          {ON_TIME_MINUTES / 60} hours of the shift count. Actual is what operators logged (provisional until iTouch's
          filling events are confirmed). The goal is a median miss of {SHOW_MAX_MEDIAN_ERROR}% or less over at least {SHOW_MIN_SCORED}
          measured shifts; a line over it keeps its number and shows a caution.
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
                    <td className="py-1.5 pr-3">Line {a.line}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{a.scored}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{a.medianAbsPctError === null ? "—" : `${a.medianAbsPctError}%`}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{pct(a.within10, a.scored)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{pct(a.within20, a.scored)}</td>
                    <td className="py-1.5 text-xs text-muted-foreground">
                      {[
                        a.frozenLate && `${a.frozenLate} made late`,
                        a.noNumber && `${a.noNumber} without a number`,
                        a.noActual && `${a.noActual} with nothing logged`,
                        a.estimated && `${a.estimated} estimates`,
                        a.endedEarly && `${a.endedEarly} closed before half way`,
                        a.oldMethod && `${a.oldMethod} from an older method`,
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
function FixInItouchCard({ fix, noCode }: { fix: (CycleToFix & { description: string | null; suggestion: FixSuggestion })[] | null; noCode: { line: number; text: string; qty: number }[] }) {
  if (!fix) return null;
  return (
    <Card data-testid="smart-target-fix-itouch">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Fix in iTouch</CardTitle>
        <p className="text-sm text-muted-foreground">
          Products filled in the last eight weeks that have no usable cycle time in iTouch for that line. Correct them in
          iTouch's Product Details with the value under Solution, export it again and load it in the iTouch cycles card below.
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
                  <th className="py-1.5 pr-3 font-medium">SKU and product</th>
                  <th className="py-1.5 pr-3 font-medium">In iTouch now</th>
                  <th className="py-1.5 pr-3 font-medium">Solution</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Filled, 8 weeks</th>
                  <th className="py-1.5 font-medium">Meanwhile</th>
                </tr>
              </thead>
              <tbody>
                {fix.map((f) => (
                  <tr key={`${f.line}|${f.sku}`} className="border-t align-top">
                    <td className="py-1.5 pr-3">Line {f.line}</td>
                    <td className="py-1.5 pr-3">
                      <div className="font-mono text-xs">{f.sku}</div>
                      {f.description && <div className="text-xs text-muted-foreground">{f.description}</div>}
                    </td>
                    <td className="py-1.5 pr-3">
                      {f.itouchSeconds !== null ? `${f.itouchSeconds} s` : "—"}
                      <div className="text-xs text-muted-foreground">{f.problem}</div>
                    </td>
                    <td className="py-1.5 pr-3">
                      {f.suggestion.cycleSeconds !== null && <div className="font-medium">Enter {f.suggestion.cycleSeconds} s</div>}
                      {f.suggestion.perHour !== null && <div className="text-xs">Target {f.suggestion.perHour.toLocaleString()}/h</div>}
                      <div className="text-xs text-muted-foreground">{f.suggestion.why}</div>
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">
                      {f.madeQty.toLocaleString()}
                      <div className="text-xs text-muted-foreground">{f.shifts} shifts</div>
                    </td>
                    <td className="py-1.5 text-xs text-muted-foreground">
                      {f.coveredMeanwhile ? "Has a rate from the line's recent shifts" : "No number for jobs of this product"}
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
    return { cycles, factors, history, fix: cyclesToFix(history, cycles, rejected, { familyOf: skuFamily(catalogue), isSample: skuIsSample(catalogue) }).map((f) => ({
      ...f,
      description: identifyItemSku({ sku_id: null, sku_code_text: f.sku, actual: 0, started_at: null, finished_at: null }, catalogue)?.name ?? null,
      suggestion: fixSuggestion(f.sku, planRates(f.line, [{ jobId: f.sku, sku: f.sku, sequence: 1 }], {
        cycles, factor: factors.find((x) => x.line === f.line) ?? null, history, familyOf: skuFamily(catalogue), isSample: skuIsSample(catalogue),
      }).rates, factors.find((x) => x.line === f.line)?.factor ?? null),
    })), noCode: productsWithoutCode(history), from: historyQuery.data.from, to: historyQuery.data.to };
  }, [cyclesQuery.data, historyQuery.data, catalogue]);

  // Which lines are shown comes from their own measured record (Q45a), so the kept
  // forecasts are read before the forecast is built.
  const forecastRows = useSmartTargetForecastRows(date);
  // When each line last ran over the same four weeks (BLOCO 154), so a shift that closed
  // before half way is not scored (Q79).
  const runsFrom = forecastRows.data?.rows[0]?.session_date ?? date;
  const shiftRuns = useShiftRuns(runsFrom, date, !!forecastRows.data?.installed);
  const accuracy = useMemo(() => {
    if (!forecastRows.data?.installed || !historyQuery.data) return null;
    const history = historyFromSessions(historyQuery.data.sessions, historyQuery.data.items, catalogue);
    const actuals = actualTotals(history);
    const sessions = new Set(historyQuery.data.sessions.map((s) => `${s.session_date}|${s.shift}|${s.line}`));
    const endedEarly = new Set<string>();
    for (const f of forecastRows.data.rows) {
      const key = `${f.session_date}|${f.shift}|${f.line}`;
      const o = shiftOutcome({
        date: f.session_date,
        shift: f.shift,
        hasSession: sessions.has(`${f.session_date}|${f.shift}|Line ${f.line}`),
        logged: actuals.get(key) ?? 0,
        run: shiftRuns.get(`${f.session_date}|Line ${f.line}|${f.shift}`),
        nowMs: Date.now(),
      });
      if (endedBeforeHalfway(o)) endedEarly.add(key);
    }
    return accuracyByLine(forecastRows.data.rows, actuals, 5, endedEarly);
  }, [forecastRows.data, historyQuery.data, catalogue, shiftRuns]);
  const cautions = useMemo(() => lineCautions(accuracy, WIDE_MARGIN_LINES), [accuracy]);

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
        .select("id, session_id, display_order, sku_id, sku_code_text, planned_qty, created_at, actual_qty")
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
        const shown = FORECAST_LINES.includes(l.line);
        const basis: RateBasis | null = rateBasis
          ? { factor, caution: cautions.find((c) => c.line === l.line)?.caution ?? null, from: rateBasis.from, to: rateBasis.to }
          : null;
        // Plan rows with no quantity take what was left of iTouch's order for the same SKU
        // when the queue was read (Q26b).
        const fromQueue = fillFromQueue(l.line, l.input.jobs, queue.rows);
        // Nothing logged on this line yet: the plan is what iTouch has queued for it (Q32a).
        // Once Production Control has a plan for the line, that plan answers instead.
        const queuePlan = l.input.jobs.length ? null : planFromQueue(l.line, queue.rows, 0, []);
        const usesQueuePlan = !!queuePlan?.jobs.length;
        const input = usesQueuePlan
          ? { ...l.input, jobs: queuePlan.jobs, previousSku: queuePlan.previousSku ?? l.input.previousSku }
          : { ...l.input, jobs: fromQueue.jobs };
        const notes = usesQueuePlan
          ? [...l.notes, `Plan from the iTouch queue read at ${londonTime(queue.rows[0].fetched_at)}: Production Control has nothing for this line yet.`, ...queuePlan.notes]
          : fromQueue.filled
          ? [...l.notes, `Order quantity for ${fromQueue.filled} job${fromQueue.filled === 1 ? "" : "s"} from the iTouch queue read at ${londonTime(queue.rows[0].fetched_at)}: what was left to make then.`]
          : l.notes;
        const planned = rateBasis
          ? planRates(l.line, input.jobs, { cycles: rateBasis.cycles, factor, history: rateBasis.history, familyOf: skuFamily(catalogue), isSample: skuIsSample(catalogue) })
          : { jobs: input.jobs, rates: [] };
        const result = forecastShift({ ...input, jobs: planned.jobs, rates: planned.rates }, LINE_RATES_CONFIG);
        return { ...l, notes, basis, result, shown, factor };
      }),
    };
  }, [data, date, shift, catalogue, rateBasis, queue.rows, cautions]);

  const toFreeze = useMemo<LineToFreeze[] | null>(
    () => built?.lines.map((l) => ({ line: l.line, shown: l.shown, forecast: l.result, factor: l.factor })) ?? null,
    [built],
  );
  // Freeze only a complete forecast: rates known, and the iTouch queue read (or known to be unavailable).
  const readyToFreeze = !!rateBasis && !!queue.state && queue.state.kind !== "reading";
  useFreezeSmartTargetForecasts(date, shift, toFreeze, readyToFreeze, forecastRows);

  // Where now falls along the strips, for the shift running now. Moved once a minute.
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setClock(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const stripWindow = shiftWindow(date, shift);
  const nowPct = stripWindow && clock >= stripWindow.startMs && clock < stripWindow.endMs
    ? ((clock - stripWindow.startMs) / 60_000 / stripWindow.grossMinutes) * 100
    : null;

  const reportData = useShiftReportData(date, shift);
  const printRef = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => {
    if (!built) return [];
    return built.lines.map(({ line, result, sessionIds }) => {
      const name = `Line ${line}`;
      const kept = forecastRows.data?.rows.find((r) => r.session_date === date && r.shift === shift && r.line === line) ?? null;
      const own = (data?.items ?? []).filter((i) => sessionIds.includes(i.session_id));
      const made = new Map<string, number>();
      for (const i of own) {
        const qty = Math.max(0, Number(i.actual_qty) || 0);
        const code = identifyItemSku({ sku_id: i.sku_id, sku_code_text: i.sku_code_text, actual: 0, started_at: null, finished_at: null }, catalogue)?.code;
        if (qty > 0 && code) made.set(code, (made.get(code) ?? 0) + qty);
      }
      const logged = own.reduce((sum, i) => sum + Math.max(0, Number(i.actual_qty) || 0), 0);
      // Only the products that make up the target, not everything iTouch had queued for the line.
      // The plan is what was kept for the shift. A kept forecast from before jobs carried their
      // number (before 06/11) lists its products as kept: today's recalculation is not the plan
      // the shift was set against, and checking against it hid real plan changes.
      const planned = kept?.jobs?.length
        ? plannedProducts(kept.jobs)
        : plannedProducts(jobsInTarget(result.jobs).map((j) => ({ sku: j.sku, expected: j.expectedContainers })));
      // Made but not in the target's products: off plan, even if iTouch had it queued further down.
      const offPlan = planned.length ? productsOffPlan({ jobs: planned }, [...made.keys()], skuFamily(catalogue)) : [];
      const target = kept ? kept.expected_total : result.expectedTotal;
      const report = lineReport({
        line,
        target,
        targetSetAt: kept?.frozen_at ?? null,
        targetVersion: kept?.engine_version ?? null,
        ragPlan: reportData.data?.rag.find((r) => r.line === name)?.plan_qty ?? null,
        logged,
        miss: targetVersusLogged(kept?.expected_total, logged),
        planned,
        made: [...made.entries()].map(([sku, qty]) => ({ sku, qty })),
        offPlan,
        stops: stopsByReason(reportData.data?.downtimes ?? [], name, shift),
        clock: stripWindow ? machineClock(reportData.data?.status ?? [], name, stripWindow.startMs, stripWindow.endMs, clock) : null,
        grossMinutes: stripWindow?.grossMinutes ?? 720,
        leader: reportData.data?.leaders.find((l) => l.line === name)?.leader_name ?? null,
        comment: reportData.data?.comments.find((c) => c.line === name)?.comment ?? null,
      });
      return { line, kept, logged, offPlan, report };
    });
  }, [built, forecastRows.data, data, date, shift, catalogue, reportData.data, stripWindow, clock]);

  const exportReport = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.map(({ report: r }) => ({
      Line: r.line, Target: r.target, "Target set": r.targetSetAt ? londonTime(r.targetSetAt) : null, "RAG plan": r.ragPlan, Logged: r.logged, "Miss %": r.miss,
      Leader: r.leader, "First ran": r.clock?.firstRun ? londonTime(r.clock.firstRun) : null, "Last ran": r.clock?.lastRun ? londonTime(r.clock.lastRun) : null, "Running min": r.clock?.runningMinutes ?? null, "Log covered min": r.clock?.coveredMinutes ?? null,
      "Stops min": r.stopMinutes, Expected: r.planned.map((p) => (p.expected === null ? p.sku : `${p.sku} ${p.expected}`)).join(", "), Made: r.made.map((m) => `${m.sku} ${m.qty}`).join(", "), Why: r.why.join(" "), Comment: r.comment,
    }))), "Shift");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.flatMap(({ report: r }) => r.stops.map((s) => ({ Line: r.line, Reason: s.reason, Minutes: s.minutes })))), "Stops");
    XLSX.writeFile(wb, `smart-target_${date}_${shift}.xlsx`);
  };

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
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => printRef.current && printElementAsDocument(printRef.current, `Smart Target ${date} ${shift}`, { landscape: true, css: ".shift-report-print{display:block !important}" })}
              >
                <Printer className="mr-2 h-4 w-4" /> Print shift report
              </Button>
              <Button variant="outline" size="sm" onClick={exportReport}>
                <Download className="mr-2 h-4 w-4" /> Export to Excel
              </Button>
            </div>
            <div ref={printRef} className="shift-report-print hidden">
              <h2 className="mb-3 text-lg font-semibold">Smart Target, {date}, {shift === "DAY" ? "day" : "night"} shift</h2>
              {rows.map(({ report }) => (
                <div key={report.line} className="mb-4 break-inside-avoid border-t pt-3">
                  <h3 className="mb-2 font-semibold">Line {report.line}</h3>
                  <ShiftReport report={report} />
                </div>
              ))}
            </div>
            <div className="divide-y overflow-hidden rounded-lg border bg-card">
              <StripHeader shift={shift} gross={shiftWindow(date, shift)?.grossMinutes ?? 720} nowPct={nowPct} />
              {built.lines.map(({ line, result, notes, basis }) => {
                const row = rows.find((r) => r.line === line)!;
                return (
                <LineRow
                  key={line}
                  nowPct={nowPct}
                  line={line}
                  result={result}
                  notes={notes}
                  basis={basis}
                  kept={row.kept}
                  logged={row.logged}
                  offPlan={row.offPlan}
                  report={row.report}
                />
                );
              })}
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

        <AccuracyCard accuracy={accuracy} installed={forecastRows.data?.installed ?? true} />

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
