import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";
import { invokeFunction } from "@/lib/invokeFunction";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { EmptyState } from "@/components/EmptyState";
import { BarChart3, Sparkles, Loader2, Info, Clock } from "lucide-react";
import { format, parseISO, subDays } from "date-fns";
import { toast } from "@/hooks/use-toast";

interface Row {
  sku_id: string;
  sku_code: string;
  sku_name: string;
  line: string;
  sessions: number;
  actual: number;
  planned: number;
  eff: number;
}

interface AiResult {
  available: boolean;
  days_recorded: number;
  distinct_days?: number;
  days_remaining?: number;
  min_days: number;
  first_date?: string | null;
  last_date?: string | null;
  summary?: unknown;
  analysis?: string;
}

const MIN_DAYS = 90;

export default function SKUPerformancePage() {
  const today = format(new Date(), "yyyy-MM-dd");
  const [dateFrom, setDateFrom] = useState(format(subDays(new Date(), 30), "yyyy-MM-dd"));
  const [dateTo, setDateTo] = useState(today);
  const [lineFilter, setLineFilter] = useState<string>("__all__");
  const [skuFilter, setSkuFilter] = useState<string>("__all__");

  const [aiSelection, setAiSelection] = useState<{ sku_id: string; line: string } | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<AiResult | null>(null);

  const { data: lines = [] } = useQuery({
    queryKey: ["lines"],
    queryFn: async () => {
      const { data } = await supabase.from("lines").select("name").order("name");
      return (data ?? []) as { name: string }[];
    },
  });

  const { data: skus = [] } = useQuery({
    queryKey: ["sku_products_min"],
    queryFn: async () => {
      // Paginate past the ~1000-row PostgREST cap so SKUs beyond 1000 resolve.
      const pageSize = 1000;
      const rows: { id: string; code: string; name: string }[] = [];
      for (let offset = 0; ; offset += pageSize) {
        const { data } = await supabase.from("sku_products").select("id, code, name").order("code").range(offset, offset + pageSize - 1);
        const page = (data ?? []) as { id: string; code: string; name: string }[];
        rows.push(...page);
        if (page.length < pageSize) break;
      }
      return rows;
    },
  });
  const skuMap = useMemo(() => new Map(skus.map((s) => [s.id, s])), [skus]);

  const { data: rows = [], isLoading } = useQuery<Row[]>({
    queryKey: ["sku_perf", dateFrom, dateTo, lineFilter, skuFilter],
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      let q = supabase.from("production_sessions")
        .select("id, session_date, line, production_items(sku_id, sku_code_text, planned_qty, target_qty, actual_qty)")
        .gte("session_date", dateFrom).lte("session_date", dateTo);
      if (lineFilter !== "__all__") q = q.eq("line", lineFilter);
      const { data, error } = await q;
      if (error) throw error;

      const agg = new Map<string, Row>();
      for (const s of (data ?? []) as Array<{
        id: string; session_date: string; line: string;
        production_items: Array<{ sku_id: string | null; sku_code_text: string | null; planned_qty: number | null; target_qty: number | null; actual_qty: number | null }>;
      }>) {
        for (const it of s.production_items ?? []) {
          // Catalog SKUs resolve by id; free-text SKUs (logged as typed) fall back to
          // sku_code_text so they aren't silently dropped from the breakdown.
          const codeText = (it.sku_code_text ?? "").trim();
          const idKey = it.sku_id ?? (codeText ? `text:${codeText}` : "");
          if (!idKey) continue; // no SKU reference at all
          if (skuFilter !== "__all__" && it.sku_id !== skuFilter) continue;
          const key = `${idKey}|${s.line}`;
          const sku = it.sku_id ? skuMap.get(it.sku_id) : undefined;
          const cur = agg.get(key) ?? {
            sku_id: idKey,
            sku_code: sku?.code ?? codeText ?? "—",
            sku_name: sku?.name ?? "",
            line: s.line,
            sessions: 0,
            actual: 0,
            planned: 0,
            eff: 0,
          };
          cur.sessions += 1;
          cur.actual += Number(it.actual_qty ?? 0);
          cur.planned += Number(it.planned_qty ?? it.target_qty ?? 0);
          agg.set(key, cur);
        }
      }
      return Array.from(agg.values())
        .map((r) => ({ ...r, eff: r.planned > 0 ? (r.actual / r.planned) * 100 : 0 }))
        .sort((a, b) => b.actual - a.actual);
    },
  });

  const totals = useMemo(() => {
    const actual = rows.reduce((a, r) => a + r.actual, 0);
    const planned = rows.reduce((a, r) => a + r.planned, 0);
    return { actual, planned, eff: planned > 0 ? (actual / planned) * 100 : 0 };
  }, [rows]);

  const ragBadge = (e: number) => {
    if (e >= 100) return "bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/40";
    if (e >= 80) return "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/40";
    return "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/40";
  };

  const runAi = async (sku_id: string, line: string) => {
    setAiSelection({ sku_id, line });
    setAiLoading(true);
    setAiResult(null);
    const { data, error } = await invokeFunction<AiResult>("analyze-sku-performance", { sku_id, line });
    setAiLoading(false);
    if (error) {
      toast({ title: "AI analysis failed", description: error.message ?? String(error), variant: "destructive" });
      return;
    }
    setAiResult(data);
  };

  const lineRank = (name: string) => {
    const n = (name ?? "").toLowerCase();
    const m = n.match(/line\s*(\d+)/);
    if (m) return parseInt(m[1], 10);
    if (n.includes("capsule")) return 100;
    if (n.includes("gel")) return 200;
    return 999;
  };
  const sortedLines = useMemo(
    () => [...lines].sort((a, b) => lineRank(a.name) - lineRank(b.name) || a.name.localeCompare(b.name)),
    [lines],
  );

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-6">
        <div className="space-y-3">
          <h1 className="text-xl md:text-2xl font-bold">SKU Performance</h1>
          <p className="text-sm text-muted-foreground">
            Actual vs planned production, broken down by SKU and line. AI analysis becomes available once a SKU-and-line combination has {MIN_DAYS} days of historical data.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:flex-wrap">
            <div className="flex items-center gap-2">
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" />
              <span className="text-xs text-muted-foreground shrink-0">to</span>
              <Input type="date" value={dateTo} min={dateFrom} onChange={(e) => setDateTo(e.target.value)} className="w-40" />
            </div>
            <div className="grid grid-cols-2 sm:flex sm:items-center gap-2">
              <Select value={lineFilter} onValueChange={setLineFilter}>
                <SelectTrigger className="w-full sm:w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All lines</SelectItem>
                  {sortedLines.map((l) => <SelectItem key={l.name} value={l.name}>{l.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={skuFilter} onValueChange={setSkuFilter}>
                <SelectTrigger className="w-full sm:w-56"><SelectValue placeholder="All SKUs" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All SKUs</SelectItem>
                  {skus.map((s) => <SelectItem key={s.id} value={s.id}>{s.code} — {s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <span className="text-xs text-muted-foreground whitespace-nowrap sm:ml-auto">
              {format(parseISO(dateFrom), "dd MMM")} → {format(parseISO(dateTo), "dd MMM yyyy")}
            </span>
          </div>
        </div>

        <Card>
          <CardContent className="p-6 flex items-center gap-6 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <div className="text-xs uppercase text-muted-foreground">Overall (filtered)</div>
              <div className="text-2xl font-bold">{totals.actual.toLocaleString("en-US")} / {totals.planned.toLocaleString("en-US")}</div>
              <div className="text-sm text-muted-foreground">
                {rows.length} SKU-line combinations · {totals.eff.toFixed(1)}% efficiency
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Badge className="bg-green-500/15 text-green-600 dark:text-green-400 border border-green-500/40">≥100% Green</Badge>
              <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/40">≥80% Amber</Badge>
              <Badge className="bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/40">&lt;80% Red</Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Breakdown by SKU & Line</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-6 text-sm text-muted-foreground">Loading…</div>
            ) : rows.length === 0 ? (
              <EmptyState
                icon={BarChart3}
                title="No SKU production data for this period"
                description="No production items match the current filters. Try adjusting the date range, line or SKU filter."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[720px]">
                  <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="p-2 text-left">SKU</th>
                      <th className="p-2 text-left">Line</th>
                      <th className="p-2 text-right">Sessions</th>
                      <th className="p-2 text-right">Actual</th>
                      <th className="p-2 text-right">Planned</th>
                      <th className="p-2 text-right">Efficiency</th>
                      <th className="p-2 text-right">AI Analysis</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={`${r.sku_id}|${r.line}`} className="border-t">
                        <td className="p-2">
                          <div className="font-medium">{r.sku_code}</div>
                          <div className="text-xs text-muted-foreground">{r.sku_name}</div>
                        </td>
                        <td className="p-2">{r.line}</td>
                        <td className="p-2 text-right">{r.sessions}</td>
                        <td className="p-2 text-right">{r.actual.toLocaleString("en-US")}</td>
                        <td className="p-2 text-right">{r.planned.toLocaleString("en-US")}</td>
                        <td className="p-2 text-right">
                          <Badge className={`${ragBadge(r.eff)} border`}>{r.eff.toFixed(1)}%</Badge>
                        </td>
                        <td className="p-2 text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => runAi(r.sku_id, r.line)}
                            disabled={aiLoading && aiSelection?.sku_id === r.sku_id && aiSelection?.line === r.line}
                          >
                            {aiLoading && aiSelection?.sku_id === r.sku_id && aiSelection?.line === r.line ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Sparkles className="h-3.5 w-3.5" />
                            )}
                            <span className="ml-1.5">Analyze</span>
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {aiSelection && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                AI Analysis · {skuMap.get(aiSelection.sku_id)?.code ?? aiSelection.sku_id} on {aiSelection.line}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {aiLoading && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Generating analysis…
                </div>
              )}
              {!aiLoading && aiResult && !aiResult.available && (
                <Alert>
                  <Clock className="h-4 w-4" />
                  <AlertTitle>AI analysis not yet available</AlertTitle>
                  <AlertDescription>
                    This SKU-and-line combination has {aiResult.days_recorded} day(s) of historical data
                    ({aiResult.distinct_days ?? 0} distinct production days). AI analysis unlocks after {MIN_DAYS} days.
                    <div className="mt-1 font-medium text-foreground">
                      {aiResult.days_remaining ?? Math.max(0, MIN_DAYS - aiResult.days_recorded)} day(s) remaining.
                    </div>
                  </AlertDescription>
                </Alert>
              )}
              {!aiLoading && aiResult && aiResult.available && (
                <>
                  <Alert>
                    <Info className="h-4 w-4" />
                    <AlertTitle>Based on {aiResult.days_recorded} days of historical data</AlertTitle>
                    <AlertDescription>Generated by AI · verify recommendations before acting.</AlertDescription>
                  </Alert>
                  <div className="whitespace-pre-wrap text-sm leading-relaxed">{aiResult.analysis}</div>
                </>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
