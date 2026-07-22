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
  Loader2,
  Save,
  ExternalLink,
  FileDown,
  FileSpreadsheet,
  Pencil,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Cell } from "recharts";
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
type ViewMode = "day" | "week" | "month";

interface DailyStat {
  stat_date?: string;
  line: string;
  batches: number;
  qas_checks: number;
  ccp_checks: number;
  toolbox_checks: number;
}

interface QualityAction {
  id: string;
  line: string | null;
  description: string | null;
  recorded_at: string;
}

interface AggRow extends QualityLineRow {
  checks: number;
  errorPct: number;
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

/** Chart fill for an error rate (green/amber/red). */
function errorFill(pct: number): string {
  if (pct <= 2) return "hsl(142 76% 36%)";
  if (pct <= 5) return "hsl(38 92% 50%)";
  return "hsl(0 84% 60%)";
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

/** Load daily stats within an inclusive date range. */
function useDailyStats(fromStr: string, toStr: string) {
  return useQuery({
    queryKey: ["qds", fromStr, toStr],
    queryFn: async () => {
      const { data, error } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not in generated types yet
        .from("quality_daily_stats" as any)
        .select("stat_date, line, batches, qas_checks, ccp_checks, toolbox_checks")
        .gte("stat_date", fromStr)
        .lte("stat_date", toStr);
      if (error) throw error;
      return (data ?? []) as unknown as DailyStat[];
    },
  });
}

/** Load quality actions within an inclusive date range. */
function useActions(fromStr: string, toStr: string) {
  return useQuery({
    queryKey: ["q_actions_range", fromStr, toStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quality_actions")
        .select("id, line, description, recorded_at")
        .gte("recorded_at", `${fromStr}T00:00:00`)
        .lte("recorded_at", `${toStr}T23:59:59`)
        .order("recorded_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as QualityAction[];
    },
  });
}

function aggregate(
  lines: { name: string }[],
  daily: DailyStat[],
  actions: QualityAction[],
): AggRow[] {
  const byLine = new Map<string, { batches: number; qas: number; ccp: number; toolbox: number }>();
  for (const d of daily) {
    const c = byLine.get(d.line) ?? { batches: 0, qas: 0, ccp: 0, toolbox: 0 };
    c.batches += Number(d.batches ?? 0);
    c.qas += Number(d.qas_checks ?? 0);
    c.ccp += Number(d.ccp_checks ?? 0);
    c.toolbox += Number(d.toolbox_checks ?? 0);
    byLine.set(d.line, c);
  }
  const actByLine = new Map<string, number>();
  for (const a of actions) {
    if (!a.line) continue;
    actByLine.set(a.line, (actByLine.get(a.line) ?? 0) + 1);
  }
  return lines.map((l) => {
    const s = byLine.get(l.name) ?? { batches: 0, qas: 0, ccp: 0, toolbox: 0 };
    const checks = s.qas + s.ccp + s.toolbox;
    const acts = actByLine.get(l.name) ?? 0;
    return {
      line: l.name,
      batches: s.batches,
      qas: s.qas,
      ccp: s.ccp,
      toolbox: s.toolbox,
      actions: acts,
      checks,
      errorPct: checks > 0 ? (acts / checks) * 100 : 0,
    };
  });
}

function totalsOf(rows: AggRow[]) {
  const t = rows.reduce(
    (a, r) => ({ batches: a.batches + r.batches, checks: a.checks + r.checks, actions: a.actions + r.actions }),
    { batches: 0, checks: 0, actions: 0 },
  );
  const most = rows.reduce((b, r) => (r.actions > b.actions ? r : b), { line: "—", actions: -1 } as { line: string; actions: number });
  return { ...t, errorPct: t.checks > 0 ? (t.actions / t.checks) * 100 : 0, most: most.actions > 0 ? most.line : "—" };
}

function KpiCards({ t, showMost }: { t: ReturnType<typeof totalsOf>; showMost?: boolean }) {
  return (
    <div className={cn("grid grid-cols-2 gap-3", showMost ? "sm:grid-cols-5" : "sm:grid-cols-4")}>
      <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Actions Opened</div><div className="text-2xl font-bold">{t.actions}</div></CardContent></Card>
      <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Batches</div><div className="text-2xl font-bold">{t.batches}</div></CardContent></Card>
      <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Checks</div><div className="text-2xl font-bold">{t.checks}</div></CardContent></Card>
      <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">% Error</div><div className={cn("text-2xl font-bold", errorColor(t.errorPct))}>{t.errorPct.toFixed(2)}%</div></CardContent></Card>
      {showMost && <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Most Actions</div><div className="text-2xl font-bold">{t.most}</div></CardContent></Card>}
    </div>
  );
}

function ActionsList({ actions, period }: { actions: QualityAction[]; period: string }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
        <CardTitle className="text-base">Actions opened ({actions.length})</CardTitle>
        <Button asChild variant="outline" size="sm">
          <Link to="/dashboard/quality">Manage actions <ExternalLink className="ml-1 h-3.5 w-3.5" /></Link>
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        {actions.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">No quality actions recorded this {period}.</p>
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
  );
}

/** Read-only per-line totals table (Batches / Checks / Actions / % Error). */
function TotalsTable({ rows, t }: { rows: AggRow[]; t: ReturnType<typeof totalsOf> }) {
  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-base">Totals by line</CardTitle></CardHeader>
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
              {rows.map((r) => (
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
                <td className="px-2 py-2 text-right tabular-nums">{t.batches}</td>
                <td className="px-2 py-2 text-right tabular-nums">{t.checks}</td>
                <td className="px-2 py-2 text-right tabular-nums">{t.actions}</td>
                <td className={cn("px-3 py-2 text-right tabular-nums", errorColor(t.errorPct))}>{t.errorPct.toFixed(2)}%</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================
// DAY — editable entry
// ============================================================
function QualityDayEditor({ canManage }: { canManage: boolean }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [date, setDate] = useState<Date>(() => new Date());
  const [edits, setEdits] = useState<Record<string, Partial<Record<CheckField, string>>>>({});
  const dateStr = format(date, "yyyy-MM-dd");

  const shiftDay = (dir: 1 | -1) => { setEdits({}); setDate((d) => addDays(d, dir)); };

  const { data: lines = [] } = useLines();
  const { data: daily = [] } = useDailyStats(dateStr, dateStr);
  const { data: actions = [] } = useActions(dateStr, dateStr);

  const savedMap = useMemo(() => new Map(daily.map((s) => [s.line, s])), [daily]);
  const actionsByLine = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of actions) if (a.line) m.set(a.line, (m.get(a.line) ?? 0) + 1);
    return m;
  }, [actions]);

  const cellValue = (line: string, field: CheckField): string => {
    const e = edits[line]?.[field];
    if (e !== undefined) return e;
    const s = savedMap.get(line);
    return s ? String(s[field] ?? 0) : "0";
  };
  const numVal = (line: string, field: CheckField) => Math.max(0, Math.round(Number(cellValue(line, field)) || 0));
  const setCell = (line: string, field: CheckField, v: string) =>
    setEdits((p) => ({ ...p, [line]: { ...p[line], [field]: v } }));

  const rows = useMemo(() => lines.map((l) => {
    const checks = numVal(l.name, "qas_checks") + numVal(l.name, "ccp_checks") + numVal(l.name, "toolbox_checks");
    const acts = actionsByLine.get(l.name) ?? 0;
    return { line: l.name, checks, actions: acts, errorPct: checks > 0 ? (acts / checks) * 100 : 0 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [lines, edits, savedMap, actionsByLine]);

  const save = useMutation({
    mutationFn: async () => {
      const touched = Object.keys(edits);
      if (touched.length === 0) return;
      const payload = touched.map((line) => ({
        stat_date: dateStr,
        line,
        batches: numVal(line, "batches"),
        qas_checks: numVal(line, "qas_checks"),
        ccp_checks: numVal(line, "ccp_checks"),
        toolbox_checks: numVal(line, "toolbox_checks"),
        created_by: user?.id ?? null,
      }));
      const { error } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not in generated types yet
        .from("quality_daily_stats" as any)
        .upsert(payload as unknown as never, { onConflict: "stat_date,line" });
      if (error) throw error;
    },
    onSuccess: () => { setEdits({}); qc.invalidateQueries({ queryKey: ["qds", dateStr, dateStr] }); toast.success("Daily quality data saved"); },
    onError: (e: unknown) => toast.error(`Failed to save: ${(e as Error)?.message ?? "unknown error"}`),
  });

  const dirty = Object.keys(edits).length > 0;
  const t = totalsOf(aggregate(lines, daily, actions));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => shiftDay(-1)}><ChevronLeft className="h-4 w-4" /></Button>
          <Input type="date" value={dateStr} onChange={(e) => { setEdits({}); if (e.target.value) setDate(new Date(e.target.value + "T00:00:00")); }} className="w-40" />
          <Button variant="outline" size="icon" onClick={() => shiftDay(1)}><ChevronRight className="h-4 w-4" /></Button>
        </div>
        {canManage && (
          <Button size="sm" onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
            {save.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}Save
          </Button>
        )}
      </div>

      <KpiCards t={t} />

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">By line · {format(date, "EEE dd MMM yyyy")}</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs uppercase text-muted-foreground">
                  <th className="px-3 py-2 text-left font-medium">Line</th>
                  {FIELDS.map((f) => <th key={f.key} className="px-2 py-2 text-right font-medium">{f.label}</th>)}
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
                        <Input type="number" min={0} value={cellValue(r.line, f.key)} disabled={!canManage}
                          onChange={(e) => setCell(r.line, f.key, e.target.value)} className="ml-auto h-8 w-20 text-right" />
                      </td>
                    ))}
                    <td className="px-2 py-1.5 text-right tabular-nums">{r.actions}</td>
                    <td className={cn("px-3 py-1.5 text-right font-semibold tabular-nums", errorColor(r.errorPct))}>{r.errorPct.toFixed(2)}%</td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={FIELDS.length + 3} className="px-3 py-6 text-center text-muted-foreground">No lines found.</td></tr>}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <ActionsList actions={actions} period="day" />
    </div>
  );
}

// ============================================================
// WEEK — read-only rollup of the daily rows
// ============================================================
function weeksOfMonth(monthDate: Date): Date[] {
  const mEnd = endOfMonth(monthDate);
  const weeks: Date[] = [];
  let w = startOfWeek(startOfMonth(monthDate), { weekStartsOn: 1 });
  while (w <= mEnd) { weeks.push(w); w = addDays(w, 7); }
  return weeks;
}

export function QualityReportView() {
  const { profile, user } = useAuth();
  const { can } = useRole();
  const canManage = can("quality.manage");
  const [entryOpen, setEntryOpen] = useState(false);
  const [monthDate, setMonthDate] = useState<Date>(() => startOfMonth(new Date()));

  const weeks = useMemo(() => weeksOfMonth(monthDate), [monthDate]);
  const spanStart = weeks[0];
  const spanEnd = addDays(weeks[weeks.length - 1], 6);
  const fromStr = format(spanStart, "yyyy-MM-dd");
  const toStr = format(spanEnd, "yyyy-MM-dd");

  const { data: lines = [] } = useLines();
  const { data: daily = [] } = useDailyStats(fromStr, toStr);
  const { data: actions = [] } = useActions(fromStr, toStr);

  const monthly = useMemo(() => aggregate(lines, daily, actions), [lines, daily, actions]);
  const t = totalsOf(monthly);

  // Chart data (real numbers only — lines that had activity)
  const byLine = useMemo(
    () => monthly.filter((r) => r.actions > 0 || r.batches > 0).map((r) => ({ line: r.line, actions: r.actions, errorPct: Number(r.errorPct.toFixed(1)) })),
    [monthly],
  );
  const trend = useMemo(() => {
    const m = new Map<string, { key: string; day: string; actions: number }>();
    for (const a of actions) {
      const d = new Date(a.recorded_at);
      const key = format(d, "yyyy-MM-dd");
      const cur = m.get(key) ?? { key, day: format(d, "dd/MM"), actions: 0 };
      cur.actions += 1;
      m.set(key, cur);
    }
    return Array.from(m.values()).sort((x, y) => x.key.localeCompare(y.key));
  }, [actions]);

  // weekly breakdown built from the daily rows
  const weekBlocks = useMemo(() => weeks.map((w, i) => {
    const wStart = format(w, "yyyy-MM-dd");
    const wEnd = format(addDays(w, 6), "yyyy-MM-dd");
    const dSub = daily.filter((d) => (d.stat_date ?? "") >= wStart && (d.stat_date ?? "") <= wEnd);
    const aSub = actions.filter((a) => { const dd = format(new Date(a.recorded_at), "yyyy-MM-dd"); return dd >= wStart && dd <= wEnd; });
    const rows = aggregate(lines, dSub, aSub);
    return { label: `Week ${i + 1} · ${format(w, "dd MMM")}–${format(addDays(w, 6), "dd MMM")}`, rows };
  }), [weeks, lines, daily, actions]);

  const buildExport = (): QualityExportInput => ({
    title: "Quality Actions Report",
    periodLabel: format(monthDate, "MMMM yyyy"),
    generatedBy: profile?.name || user?.email || "—",
    monthly: monthly.map((r) => ({ line: r.line, batches: r.batches, qas: r.qas, ccp: r.ccp, toolbox: r.toolbox, actions: r.actions })),
    weeks: weekBlocks.map((wb) => ({ label: wb.label, rows: wb.rows.map((r) => ({ line: r.line, batches: r.batches, qas: r.qas, ccp: r.ccp, toolbox: r.toolbox, actions: r.actions })) })),
    actions: actions.map((a) => ({ date: format(new Date(a.recorded_at), "dd/MM/yyyy"), line: a.line ?? "—", problem: a.description ?? "" })),
    fileBase: `Quality-${format(monthDate, "yyyy-MM")}`,
  });

  const [exporting, setExporting] = useState(false);
  const doPdf = async () => { setExporting(true); try { await exportQualityPdf(buildExport()); } catch (e) { toast.error(`PDF failed: ${(e as Error)?.message}`); } finally { setExporting(false); } };
  const doXlsx = () => { try { exportQualityExcel(buildExport()); } catch (e) { toast.error(`Excel failed: ${(e as Error)?.message}`); } };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setMonthDate((m) => addMonths(m, -1))}><ChevronLeft className="h-4 w-4" /></Button>
          <div className="min-w-[140px] text-center text-sm font-semibold">{format(monthDate, "MMMM yyyy")}</div>
          <Button variant="outline" size="icon" onClick={() => setMonthDate((m) => addMonths(m, 1))}><ChevronRight className="h-4 w-4" /></Button>
        </div>
        <div className="flex gap-2">
          {canManage && <Button variant="outline" size="sm" onClick={() => setEntryOpen(true)}><Pencil className="mr-1 h-4 w-4" /> Enter data</Button>}
          <Button variant="outline" size="sm" onClick={doPdf} disabled={exporting}>{exporting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FileDown className="mr-1 h-4 w-4" />} PDF</Button>
          <Button variant="outline" size="sm" onClick={doXlsx}><FileSpreadsheet className="mr-1 h-4 w-4" /> Excel</Button>
        </div>
      </div>

      <KpiCards t={t} showMost />

      {/* Analytics charts — real data */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Actions by line</CardTitle></CardHeader>
          <CardContent>
            {byLine.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No data</p> : (
              <ResponsiveContainer width="100%" height={Math.max(180, byLine.length * 34)}>
                <BarChart data={byLine} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} fontSize={11} tickLine={false} />
                  <YAxis type="category" dataKey="line" width={72} fontSize={11} tickLine={false} />
                  <Tooltip contentStyle={{ fontSize: 12 }} cursor={{ fill: "hsl(var(--muted))" }} />
                  <Bar dataKey="actions" name="Actions" fill="hsl(217 91% 60%)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">% Error by line</CardTitle></CardHeader>
          <CardContent>
            {byLine.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No data</p> : (
              <ResponsiveContainer width="100%" height={Math.max(180, byLine.length * 34)}>
                <BarChart data={byLine} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" fontSize={11} tickLine={false} unit="%" />
                  <YAxis type="category" dataKey="line" width={72} fontSize={11} tickLine={false} />
                  <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: number) => [`${v}%`, "% Error"]} cursor={{ fill: "hsl(var(--muted))" }} />
                  <Bar dataKey="errorPct" radius={[0, 4, 4, 0]}>
                    {byLine.map((r) => <Cell key={r.line} fill={errorFill(r.errorPct)} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Actions over time</CardTitle></CardHeader>
        <CardContent>
          {trend.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No actions in this period</p> : (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={trend} margin={{ top: 4, right: 12, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="day" fontSize={11} tickLine={false} />
                <YAxis allowDecimals={false} fontSize={11} tickLine={false} />
                <Tooltip contentStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="actions" name="Actions" stroke="hsl(217 91% 60%)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <TotalsTable rows={monthly} t={t} />
      <ActionsList actions={actions} period="month" />

      {canManage && (
        <Dialog open={entryOpen} onOpenChange={setEntryOpen}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Enter quality data — batches &amp; checks</DialogTitle></DialogHeader>
            <QualityDayEditor canManage={canManage} />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

