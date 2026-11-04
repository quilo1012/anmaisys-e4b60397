import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Target } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useSkuCatalogue } from "@/hooks/useSkuCatalogue";
import { getCurrentFactoryShift } from "@/lib/shifts";
import { forecastShift, type ShiftForecast, type ShiftType } from "@/lib/smartTargetEngine";
import {
  buildShiftInputs,
  MISSING_INPUTS,
  type SmartTargetItem,
  type SmartTargetSession,
} from "@/lib/smartTargetInput";

/**
 * Smart Target, as a diagnostic: what the engine can forecast for each line and
 * shift today, and, line by line, why it cannot forecast the rest.
 *
 * Read-only. It writes nothing, and no target anywhere changes because of it.
 * Most cells will read "—" until the inputs listed at the top arrive. That is
 * the point of the page: the gaps are the work left to do, and a stand-in number
 * would hide them.
 */

const STATUS_LABEL: Record<ShiftForecast["status"], string> = {
  ok: "Forecast",
  partial: "Partial",
  insufficient_data: "Not enough data",
  invalid_input: "Invalid input",
};

const TRANSITION_LABEL = {
  first_unknown: "Start · previous SKU unknown",
  first_empty: "Start · line empty",
  sku_change: "SKU change",
  same_sku: "Same SKU",
} as const;

// Shown once at the top, so not repeated on every line.
const GLOBAL_WARNINGS = new Set(["PREVIOUS_SKU_UNKNOWN", "NO_JOBS"]);

const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toLocaleString());

export default function SmartTargetPage() {
  const now = getCurrentFactoryShift();
  const [date, setDate] = useState(now.sessionDate);
  const [shift, setShift] = useState<ShiftType>(now.shiftCode === "day" ? "DAY" : "NIGHT");
  const { catalogue, isLoading: skusLoading } = useSkuCatalogue();

  const { data, isLoading, error } = useQuery({
    queryKey: ["smart_target_inputs", date],
    queryFn: async () => {
      const { data: sessions, error: sErr } = await supabase
        .from("production_sessions")
        .select("id, line, session_date, shift")
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
  const assumptions = built?.lines.find((l) => l.result.assumptions.length)?.result.assumptions ?? [];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <PageHeader
          module="Production"
          title="Smart Target"
          description="Expected containers per line and shift, and what is still missing to forecast them"
          icon={<Target className="h-5 w-5" />}
          badge={<Badge variant="outline">Diagnostic · v1</Badge>}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Input type="date" aria-label="Shift date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="h-9 w-40" />
              {(["DAY", "NIGHT"] as const).map((s) => (
                <Button key={s} size="sm" variant={shift === s ? "default" : "outline"} onClick={() => setShift(s)} aria-pressed={shift === s}>
                  {s === "DAY" ? "Day" : "Night"}
                </Button>
              ))}
            </div>
          }
        />

        <Card>
          <CardHeader>
            <CardTitle className="text-base">What the forecast still needs</CardTitle>
            <CardDescription>
              Until these arrive, the page shows "—" instead of a number. It never fills a gap with a default or an estimate.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {MISSING_INPUTS.map((m) => (
                <li key={m.key} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:gap-4">
                  <span className="font-medium sm:w-56 sm:shrink-0">{m.label}</span>
                  <span className="text-muted-foreground sm:flex-1">{m.why}</span>
                  <span className="text-xs text-muted-foreground sm:w-56 sm:shrink-0 sm:text-right">{m.owner}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {error ? (
          <Card><CardContent className="py-6 text-sm text-destructive">Could not load the production plan: {(error as Error).message}</CardContent></Card>
        ) : loading || !built ? (
          <div className="grid gap-4 lg:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-48" />)}</div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {built.lines.map(({ line, result, notes }) => {
              const lineWarnings = [
                ...notes,
                ...result.warnings.filter((w) => !GLOBAL_WARNINGS.has(w.code) && !w.jobId).map((w) => w.message),
              ];
              return (
                <Card key={line}>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <CardTitle className="text-base">Line {line}</CardTitle>
                        <CardDescription>
                          {result.jobs.length ? `${result.jobs.length} job${result.jobs.length === 1 ? "" : "s"} planned` : "No plan for this shift"}
                        </CardDescription>
                      </div>
                      <div className="text-right">
                        <Badge variant={result.status === "ok" ? "default" : "secondary"}>{STATUS_LABEL[result.status]}</Badge>
                        <div className="mt-1 text-2xl font-semibold tabular-nums">{fmt(result.expectedTotal)}</div>
                        <div className="text-xs text-muted-foreground">expected containers</div>
                      </div>
                    </div>
                  </CardHeader>
                  {result.jobs.length > 0 && (
                    <CardContent className="space-y-3">
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-8">#</TableHead>
                              <TableHead>SKU</TableHead>
                              <TableHead className="text-right">Order</TableHead>
                              <TableHead>Change</TableHead>
                              <TableHead className="text-right">Expected</TableHead>
                              <TableHead>Why not</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {result.jobs.map((j) => (
                              <TableRow key={j.jobId}>
                                <TableCell className="tabular-nums">{j.sequence}</TableCell>
                                <TableCell className="font-mono text-xs">{j.sku ?? "—"}</TableCell>
                                <TableCell className="text-right tabular-nums">{fmt(j.orderQty)}</TableCell>
                                <TableCell className="text-xs">
                                  {TRANSITION_LABEL[j.transition]}
                                  {(j.changeoverMinutes > 0 || j.mixingMinutes > 0) && (
                                    <span className="block text-muted-foreground">
                                      {j.changeoverMinutes > 0 && `changeover ${j.changeoverMinutes} min`}
                                      {j.changeoverMinutes > 0 && j.mixingMinutes > 0 && " · "}
                                      {j.mixingMinutes > 0 && `mixing ${j.mixingMinutes} min`}
                                    </span>
                                  )}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">{fmt(j.expectedContainers)}</TableCell>
                                <TableCell className="text-xs text-muted-foreground">{j.reasons.join(" ") || "—"}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                      {lineWarnings.length > 0 && (
                        <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                          {lineWarnings.map((w) => <li key={w}>{w}</li>)}
                        </ul>
                      )}
                    </CardContent>
                  )}
                </Card>
              );
            })}
          </div>
        )}

        {built && built.otherLines.length > 0 && (
          <p className="text-sm text-muted-foreground">
            Not forecast in v1 (Lines 1–6 only): {built.otherLines.join(", ")}.
          </p>
        )}

        {assumptions.length > 0 && (
          <details className="rounded-md border p-4 text-sm">
            <summary className="cursor-pointer font-medium">Assumptions applied (provisional, awaiting Production)</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
              {assumptions.map((a) => <li key={a}>{a}</li>)}
            </ul>
          </details>
        )}
      </div>
    </DashboardLayout>
  );
}
