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
import { ItouchCyclesCard } from "@/components/smartTarget/ItouchCyclesCard";
import { getCurrentFactoryShift } from "@/lib/shifts";
import { cn } from "@/lib/utils";
import { forecastShift, type JobForecast, type ShiftForecast, type ShiftType } from "@/lib/smartTargetEngine";
import {
  buildShiftInputs,
  lineGaps,
  setupMinutes,
  MISSING_INPUTS,
  type SmartTargetItem,
  type SmartTargetSession,
} from "@/lib/smartTargetInput";

/**
 * Smart Target, as a diagnostic: what the engine can forecast for each line and
 * shift today, and, line by line, why it cannot forecast the rest.
 *
 * Read-only. It writes nothing, and no target anywhere changes because of it.
 * Most lines will read "—" until the inputs listed at the top arrive. That is
 * the point of the page: the gaps are the work left to do, and a stand-in number
 * would hide them.
 *
 * Each line is drawn as its run of jobs in iTouch order, with the changeovers
 * between them. That part is real today, because it needs only the sequence.
 * The blocks are all the same width on purpose: without a rate there is no
 * duration, and drawing one would be the stand-in this page refuses.
 */

const STATUS: Record<ShiftForecast["status"], { label: string; className: string }> = {
  ok: { label: "Forecast", className: "bg-success/15 text-success-strong border-success/30" },
  partial: { label: "Partial", className: "bg-warning/15 text-warning-strong border-warning/30" },
  insufficient_data: { label: "Not enough data", className: "bg-muted text-muted-foreground border-border" },
  invalid_input: { label: "Invalid input", className: "bg-destructive/10 text-destructive border-destructive/30" },
};

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
    </div>
  );
}

function LineCard({ line, result, notes }: { line: number; result: ShiftForecast; notes: string[] }) {
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
  // Every warning the engine raised for this line, once each. The previous-SKU one is
  // the same on every line and is listed once at the bottom of the page instead.
  const warnings = [
    ...notes,
    ...new Set(result.warnings.filter((w) => w.code !== "PREVIOUS_SKU_UNKNOWN").map((w) => w.message)),
  ];
  const setup = setupMinutes(result);
  return (
    <Card data-testid={`smart-target-line-${line}`}>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0 pb-3">
        <div className="space-y-1">
          <h3 className="text-lg font-semibold leading-none tracking-tight">Line {line}</h3>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline" className={cn("font-medium", status.className)}>{status.label}</Badge>
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

export default function SmartTargetPage() {
  const now = getCurrentFactoryShift();
  const [date, setDate] = useState(now.sessionDate);
  const [shift, setShift] = useState<ShiftType>(now.shiftCode === "day" ? "DAY" : "NIGHT");
  const { catalogue, isLoading: skusLoading } = useSkuCatalogue();

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["smart_target_inputs", date],
    queryFn: async () => {
      const { data: sessions, error: sErr } = await supabase
        .from("production_sessions")
        .select("id, line, session_date, shift, started_at")
        .eq("session_date", date);
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
      lines: inputs.lines.map((l) => ({ ...l, result: forecastShift(l.input) })),
    };
  }, [data, date, shift, catalogue]);

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
          badge={<Badge variant="outline">Diagnostic</Badge>}
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
                ? "No line has a plan for this shift. Plans come from the iTouch import in Production Control."
                : `${planned.length} of 6 lines have a plan. ${forecast.length} can be forecast.`}
            </p>
            <div className="space-y-3">
              {built.lines.map(({ line, result, notes }) => (
                <LineCard key={line} line={line} result={result} notes={notes} />
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
              {MISSING_INPUTS.map((m) => (
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
