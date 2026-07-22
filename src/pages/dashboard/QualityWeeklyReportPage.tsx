import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  format,
  addDays,
  addMonths,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  getISOWeek,
} from "date-fns";
import {
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  Loader2,
  Save,
  ExternalLink,
  FileDown,
  FileSpreadsheet,
} from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useRole } from "@/hooks/useRole";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  exportQualityPdf,
  exportQualityExcel,
  type QualityLineRow,
  type QualityExportInput,
} from "@/lib/qualityExports";

type CheckField = "batches" | "qas_checks" | "ccp_checks" | "toolbox_checks";
type ViewMode = "week" | "month";

interface WeeklyStat {
  line: string;
  batches: number;
  qas_checks: number;
  ccp_checks: number;
  toolbox_checks: number;
  week_start?: string;
}

interface QualityAction {
  id: string;
  line: string | null;
  description: string | null;
  recorded_at: string;
}

const FIELDS: { key: CheckField; label: string }[] = [
  { key: "batches", label: "Batches" },
  { key: "qas_checks", label: "QAS21.0a" },
  { key: "ccp_checks", label: "CCP" },
  { key: "toolbox_checks", label: "Toolbox" },
];

/** Error rate: lower is better. */
function errorColor(pct: number): string {
  if (pct <= 2) return "text-green-600 dark:text-green-400";
  if (pct <= 5) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

function useLines() {
  return useQuery({
    queryKey: ["lines"],
    queryFn: async () => {
      const { data } = await supabase
        .from("lines")
        .select("name, display_order")
        .order("display_order", { ascending: true, nullsFirst: false })
        .order("name");
      return (data ?? []) as { name: string; display_order: number | null }[];
    },
  });
}

// ============================================================
// Week editor (Phase 1)
// ============================================================
function QualityWeekEditor({ canManage }: { canManage: boolean }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [weekStart, setWeekStart] = useState<Date>(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 }),
  );
  const [edits, setEdits] = useState<Record<string, Partial<Record<CheckField, string>>>>({});

  const weekStartStr = format(weekStart, "yyyy-MM-dd");
  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });
  const weekEndStr = format(weekEnd, "yyyy-MM-dd");
  const isoWeek = getISOWeek(weekStart);

  const shiftWeek = (dir: 1 | -1) => {
    setEdits({});
    setWeekStart((w) => addDays(w, dir * 7));
  };

  const { data: lines = [] } = useLines();

  const { data: stats = [] } = useQuery({
    queryKey: ["qws", weekStartStr],
    queryFn: async () => {
      const { data, error } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not in generated types yet
        .from("quality_weekly_stats" as any)
        .select("line, batches, qas_checks, ccp_checks, toolbox_checks")
        .eq("week_start", weekStartStr);
      if (error) throw error;
      return (data ?? []) as unknown as WeeklyStat[];
    },
  });

  const { data: actions = [] } = useQuery({
    queryKey: ["q_actions_week", weekStartStr, weekEndStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quality_actions")
        .select("id, line, description, recorded_at")
        .gte("recorded_at", `${weekStartStr}T00:00:00`)
        .lte("recorded_at", `${weekEndStr}T23:59:59`)
        .order("recorded_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as QualityAction[];
    },
  });

  const savedMap = useMemo(() => new Map(stats.map((s) => [s.line, s])), [stats]);
  const actionsByLine = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of actions) {
      if (!a.line) continue;
      m.set(a.line, (m.get(a.line) ?? 0) + 1);
    }
    return m;
  }, [actions]);

  const cellValue = (line: string, field: CheckField): string => {
    const e = edits[line]?.[field];
    if (e !== undefined) return e;
    const s = savedMap.get(line);
    return s ? String(s[field] ?? 0) : "0";
  };
  const numVal = (line: string, field: CheckField) =>
    Math.max(0, Math.round(Number(cellValue(line, field)) || 0));
  const setCell = (line: string, field: CheckField, v: string) =>
    setEdits((p) => ({ ...p, [line]: { ...p[line], [field]: v } }));

  const rows = useMemo(() => {
    return lines.map((l) => {
      const checks =
        numVal(l.name, "qas_checks") + numVal(l.name, "ccp_checks") + numVal(l.name, "toolbox_checks");
      const acts = actionsByLine.get(l.name) ?? 0;
      return {
        line: l.name,
        batches: numVal(l.name, "batches"),
        checks,
        actions: acts,
        errorPct: checks > 0 ? (acts / checks) * 100 : 0,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, edits, savedMap, actionsByLine]);

  const totals = useMemo(() => {
    const t = { batches: 0, checks: 0, actions: 0 };
    for (const r of rows) {
      t.batches += r.batches;
      t.checks += r.checks;
      t.actions += r.actions;
    }
    return { ...t, errorPct: t.checks > 0 ? (t.actions / t.checks) * 100 : 0 };
  }, [rows]);

  const save = useMutation({
    mutationFn: async () => {
      const touched = Object.keys(edits);
      if (touched.length === 0) return;
      const payload = touched.map((line) => ({
        week_start: weekStartStr,
        line,
        batches: numVal(line, "batches"),
        qas_checks: numVal(line, "qas_checks"),
        ccp_checks: numVal(line, "ccp_checks"),
        toolbox_checks: numVal(line, "toolbox_checks"),
        created_by: user?.id ?? null,
      }));
      const { error } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not in generated types yet
        .from("quality_weekly_stats" as any)
        .upsert(payload as unknown as never, { onConflict: "week_start,line" });
      if (error) throw error;
    },
    onSuccess: () => {
      setEdits({});
      qc.invalidateQueries({ queryKey: ["qws", weekStartStr] });
      toast.success("Weekly quality data saved");
    },
    onError: (e: unknown) =>
      toast.error(`Failed to save: ${(e as Error)?.message ?? "unknown error"}`),
  });

  const dirty = Object.keys(edits).length > 0;

  return (
    <div className="space-y-6">
      {/* Week nav */}
      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" size="icon" onClick={() => shiftWeek(-1)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-[190px] text-center text-sm">
          <div className="font-semibold">
            {format(weekStart, "dd MMM")} – {format(weekEnd, "dd MMM yyyy")}
          </div>
          <div className="text-xs text-muted-foreground">ISO week {isoWeek}</div>
        </div>
        <Button variant="outline" size="icon" onClick={() => shiftWeek(1)}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Actions Opened</div><div className="text-2xl font-bold">{totals.actions}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Batches</div><div className="text-2xl font-bold">{totals.batches}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Checks</div><div className="text-2xl font-bold">{totals.checks}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">% Error</div><div className={cn("text-2xl font-bold", errorColor(totals.errorPct))}>{totals.errorPct.toFixed(2)}%</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
          <CardTitle className="text-base">By line</CardTitle>
          {canManage && (
            <Button size="sm" onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
              {save.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
              Save
            </Button>
          )}
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs uppercase text-muted-foreground">
                  <th className="px-3 py-2 text-left font-medium">Line</th>
                  {FIELDS.map((f) => (
                    <th key={f.key} className="px-2 py-2 text-right font-medium">{f.label}</th>
                  ))}
                  <th className="px-2 py-2 text-right font-medium">Actions</th>
                  <th className="px-3 py-2 text-right font-medium">% Error</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.line} className="border-b last:border-0">
                    <td className="px-3 py-1.5 font-medium">{r.line}</td>
                    {FIELDS.map((f) => (
                      <td key={f.key} className="px-2 py-1.5 text-right">
                        <Input
                          type="number"
                          min={0}
                          value={cellValue(r.line, f.key)}
                          disabled={!canManage}
                          onChange={(e) => setCell(r.line, f.key, e.target.value)}
                          className="ml-auto h-8 w-20 text-right"
                        />
                      </td>
                    ))}
                    <td className="px-2 py-1.5 text-right tabular-nums">{r.actions}</td>
                    <td className={cn("px-3 py-1.5 text-right font-semibold tabular-nums", errorColor(r.errorPct))}>
                      {r.errorPct.toFixed(2)}%
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={FIELDS.length + 3} className="px-3 py-6 text-center text-muted-foreground">No lines found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
          <CardTitle className="text-base">Actions opened this week ({actions.length})</CardTitle>
          <Button asChild variant="outline" size="sm">
            <Link to="/dashboard/quality">Manage actions <ExternalLink className="ml-1 h-3.5 w-3.5" /></Link>
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {actions.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">No quality actions recorded this week.</p>
          ) : (
            <div className="divide-y">
              {actions.map((a) => (
                <div key={a.id} className="flex items-start gap-3 px-4 py-2">
                  <span className="w-16 shrink-0 text-xs text-muted-foreground">{format(new Date(a.recorded_at), "dd/MM")}</span>
                  <span className="w-24 shrink-0 text-xs font-medium">{a.line ?? "—"}</span>
                  <span className="min-w-0 flex-1 text-sm">{a.description || "—"}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================
// Month report (Phase 2) — read-only + export
// ============================================================
function weeksOfMonth(monthDate: Date): Date[] {
  const mEnd = endOfMonth(monthDate);
  const weeks: Date[] = [];
  let w = startOfWeek(startOfMonth(monthDate), { weekStartsOn: 1 });
  while (w <= mEnd) {
    weeks.push(w);
    w = addDays(w, 7);
  }
  return weeks;
}

interface MonthLineRow extends QualityLineRow {
  checks: number;
  errorPct: number;
}

function QualityMonthReport() {
  const { profile, user } = useAuth();
  const [monthDate, setMonthDate] = useState<Date>(() => startOfMonth(new Date()));

  const weeks = useMemo(() => weeksOfMonth(monthDate), [monthDate]);
  const weekStrs = useMemo(() => weeks.map((w) => format(w, "yyyy-MM-dd")), [weeks]);
  const spanStart = weeks[0];
  const spanEnd = addDays(weeks[weeks.length - 1], 6);
  const spanStartStr = format(spanStart, "yyyy-MM-dd");
  const spanEndStr = format(spanEnd, "yyyy-MM-dd");

  const { data: lines = [] } = useLines();

  const { data: stats = [] } = useQuery({
    queryKey: ["qws_month", weekStrs.join(",")],
    queryFn: async () => {
      const { data, error } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not in generated types yet
        .from("quality_weekly_stats" as any)
        .select("week_start, line, batches, qas_checks, ccp_checks, toolbox_checks")
        .in("week_start", weekStrs);
      if (error) throw error;
      return (data ?? []) as unknown as WeeklyStat[];
    },
  });

  const { data: actions = [] } = useQuery({
    queryKey: ["q_actions_month", spanStartStr, spanEndStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quality_actions")
        .select("id, line, description, recorded_at")
        .gte("recorded_at", `${spanStartStr}T00:00:00`)
        .lte("recorded_at", `${spanEndStr}T23:59:59`)
        .order("recorded_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as QualityAction[];
    },
  });

  // stats keyed by week|line
  const statMap = useMemo(() => {
    const m = new Map<string, WeeklyStat>();
    for (const s of stats) m.set(`${s.week_start}|${s.line}`, s);
    return m;
  }, [stats]);

  // actions bucketed by week index + line
  const actionCount = useMemo(() => {
    const m = new Map<string, number>(); // `${weekIdx}|${line}`
    for (const a of actions) {
      if (!a.line) continue;
      const d = new Date(a.recorded_at);
      const idx = Math.min(
        weeks.length - 1,
        Math.max(0, Math.floor((d.getTime() - spanStart.getTime()) / (7 * 86400000))),
      );
      const k = `${idx}|${a.line}`;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [actions, weeks, spanStart]);

  // per-week rows
  const weekBlocks = useMemo(() => {
    return weeks.map((w, i) => {
      const wStr = format(w, "yyyy-MM-dd");
      const rows: QualityLineRow[] = lines.map((l) => {
        const s = statMap.get(`${wStr}|${l.name}`);
        return {
          line: l.name,
          batches: Number(s?.batches ?? 0),
          qas: Number(s?.qas_checks ?? 0),
          ccp: Number(s?.ccp_checks ?? 0),
          toolbox: Number(s?.toolbox_checks ?? 0),
          actions: actionCount.get(`${i}|${l.name}`) ?? 0,
        };
      });
      return {
        label: `Week ${i + 1} · ${format(w, "dd MMM")}–${format(addDays(w, 6), "dd MMM")}`,
        rows,
      };
    });
  }, [weeks, lines, statMap, actionCount]);

  // monthly totals per line
  const monthly: MonthLineRow[] = useMemo(() => {
    return lines.map((l) => {
      let batches = 0, qas = 0, ccp = 0, toolbox = 0, acts = 0;
      weekBlocks.forEach((wb) => {
        const r = wb.rows.find((x) => x.line === l.name);
        if (!r) return;
        batches += r.batches; qas += r.qas; ccp += r.ccp; toolbox += r.toolbox; acts += r.actions;
      });
      const checks = qas + ccp + toolbox;
      return {
        line: l.name, batches, qas, ccp, toolbox, actions: acts, checks,
        errorPct: checks > 0 ? (acts / checks) * 100 : 0,
      };
    });
  }, [lines, weekBlocks]);

  const grand = useMemo(() => {
    const t = monthly.reduce(
      (a, r) => ({ batches: a.batches + r.batches, checks: a.checks + r.checks, actions: a.actions + r.actions }),
      { batches: 0, checks: 0, actions: 0 },
    );
    const most = monthly.reduce((best, r) => (r.actions > best.actions ? r : best), { line: "—", actions: -1 } as { line: string; actions: number });
    return { ...t, errorPct: t.checks > 0 ? (t.actions / t.checks) * 100 : 0, most: most.actions > 0 ? most.line : "—" };
  }, [monthly]);

  const monthActions = useMemo(
    () => actions.filter((a) => {
      const d = format(new Date(a.recorded_at), "yyyy-MM-dd");
      return d >= spanStartStr && d <= spanEndStr;
    }),
    [actions, spanStartStr, spanEndStr],
  );

  const buildExportInput = (): QualityExportInput => ({
    title: "Quality Actions Report",
    periodLabel: format(monthDate, "MMMM yyyy"),
    generatedBy: profile?.name || user?.email || "—",
    monthly: monthly.map((r) => ({ line: r.line, batches: r.batches, qas: r.qas, ccp: r.ccp, toolbox: r.toolbox, actions: r.actions })),
    weeks: weekBlocks,
    actions: monthActions.map((a) => ({
      date: format(new Date(a.recorded_at), "dd/MM/yyyy"),
      line: a.line ?? "—",
      problem: a.description ?? "",
    })),
    fileBase: `Quality-${format(monthDate, "yyyy-MM")}`,
  });

  const [exporting, setExporting] = useState(false);
  const doPdf = async () => {
    setExporting(true);
    try { await exportQualityPdf(buildExportInput()); } catch (e) { toast.error(`PDF failed: ${(e as Error)?.message}`); } finally { setExporting(false); }
  };
  const doXlsx = () => {
    try { exportQualityExcel(buildExportInput()); } catch (e) { toast.error(`Excel failed: ${(e as Error)?.message}`); }
  };

  return (
    <div className="space-y-6">
      {/* Month nav + export */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setMonthDate((m) => addMonths(m, -1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-[140px] text-center text-sm font-semibold">{format(monthDate, "MMMM yyyy")}</div>
          <Button variant="outline" size="icon" onClick={() => setMonthDate((m) => addMonths(m, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={doPdf} disabled={exporting}>
            {exporting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FileDown className="mr-1 h-4 w-4" />} PDF
          </Button>
          <Button variant="outline" size="sm" onClick={doXlsx}>
            <FileSpreadsheet className="mr-1 h-4 w-4" /> Excel
          </Button>
        </div>
      </div>

      {/* KPI header */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Actions Opened</div><div className="text-2xl font-bold">{grand.actions}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Batches</div><div className="text-2xl font-bold">{grand.batches}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Checks</div><div className="text-2xl font-bold">{grand.checks}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">% Error</div><div className={cn("text-2xl font-bold", errorColor(grand.errorPct))}>{grand.errorPct.toFixed(2)}%</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Most Actions</div><div className="text-2xl font-bold">{grand.most}</div></CardContent></Card>
      </div>

      {/* Monthly totals by line */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Monthly totals by line</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs uppercase text-muted-foreground">
                  <th className="px-3 py-2 text-left font-medium">Line</th>
                  <th className="px-2 py-2 text-right font-medium">Batches</th>
                  <th className="px-2 py-2 text-right font-medium">Checks</th>
                  <th className="px-2 py-2 text-right font-medium">Actions</th>
                  <th className="px-3 py-2 text-right font-medium">% Error</th>
                </tr>
              </thead>
              <tbody>
                {monthly.map((r) => (
                  <tr key={r.line} className="border-b last:border-0">
                    <td className="px-3 py-1.5 font-medium">{r.line}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{r.batches}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{r.checks}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{r.actions}</td>
                    <td className={cn("px-3 py-1.5 text-right font-semibold tabular-nums", errorColor(r.errorPct))}>{r.errorPct.toFixed(2)}%</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 font-semibold">
                  <td className="px-3 py-2">TOTAL</td>
                  <td className="px-2 py-2 text-right tabular-nums">{grand.batches}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{grand.checks}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{grand.actions}</td>
                  <td className={cn("px-3 py-2 text-right tabular-nums", errorColor(grand.errorPct))}>{grand.errorPct.toFixed(2)}%</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Weekly breakdown */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Weekly breakdown</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {weekBlocks.map((wb) => (
            <div key={wb.label}>
              <div className="mb-1 text-xs font-semibold text-muted-foreground">{wb.label}</div>
              <div className="overflow-x-auto rounded border">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-muted/40 uppercase text-muted-foreground">
                      <th className="px-2 py-1 text-left font-medium">Line</th>
                      <th className="px-2 py-1 text-right font-medium">Batches</th>
                      <th className="px-2 py-1 text-right font-medium">QAS</th>
                      <th className="px-2 py-1 text-right font-medium">CCP</th>
                      <th className="px-2 py-1 text-right font-medium">Toolbox</th>
                      <th className="px-2 py-1 text-right font-medium">Actions</th>
                      <th className="px-2 py-1 text-right font-medium">% Err</th>
                    </tr>
                  </thead>
                  <tbody>
                    {wb.rows.map((r) => {
                      const checks = r.qas + r.ccp + r.toolbox;
                      const err = checks > 0 ? (r.actions / checks) * 100 : 0;
                      return (
                        <tr key={r.line} className="border-b last:border-0">
                          <td className="px-2 py-1 font-medium">{r.line}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{r.batches}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{r.qas}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{r.ccp}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{r.toolbox}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{r.actions}</td>
                          <td className={cn("px-2 py-1 text-right tabular-nums", errorColor(err))}>{err.toFixed(1)}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Actions list */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
          <CardTitle className="text-base">Actions opened ({monthActions.length})</CardTitle>
          <Button asChild variant="outline" size="sm">
            <Link to="/dashboard/quality">Manage actions <ExternalLink className="ml-1 h-3.5 w-3.5" /></Link>
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {monthActions.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">No quality actions recorded this month.</p>
          ) : (
            <div className="divide-y">
              {monthActions.map((a) => (
                <div key={a.id} className="flex items-start gap-3 px-4 py-2">
                  <span className="w-16 shrink-0 text-xs text-muted-foreground">{format(new Date(a.recorded_at), "dd/MM")}</span>
                  <span className="w-24 shrink-0 text-xs font-medium">{a.line ?? "—"}</span>
                  <span className="min-w-0 flex-1 text-sm">{a.description || "—"}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================
// Page shell + mode toggle
// ============================================================
export default function QualityWeeklyReportPage() {
  const { can } = useRole();
  const canManage = can("quality.manage");
  const [mode, setMode] = useState<ViewMode>("week");

  return (
    <DashboardLayout>
      <div className="space-y-6 p-4 md:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-primary" />
            <h1 className="text-xl font-bold md:text-2xl">Quality Report</h1>
          </div>
          <div className="inline-flex rounded-md border p-0.5">
            <button
              type="button"
              onClick={() => setMode("week")}
              className={cn("rounded px-3 py-1 text-sm font-medium transition-colors", mode === "week" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              Week
            </button>
            <button
              type="button"
              onClick={() => setMode("month")}
              className={cn("rounded px-3 py-1 text-sm font-medium transition-colors", mode === "month" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              Month
            </button>
          </div>
        </div>

        {mode === "week" ? <QualityWeekEditor canManage={canManage} /> : <QualityMonthReport />}
      </div>
    </DashboardLayout>
  );
}
