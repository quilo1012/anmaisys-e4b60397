import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Trophy, AlertTriangle, Download, Search } from "lucide-react";

type Row = {
  sku_id: string;
  sku_code: string;
  sku_name: string;
  category: string | null;
  upm_standard: number;
  line: string;
  target: number;
  actual: number;
  runs: number;
};

const RANGE_DAYS = [7, 30, 60, 90] as const;

function badgeForEff(eff: number) {
  if (eff >= 100) return <Badge className="bg-emerald-600 hover:bg-emerald-600">{eff.toFixed(1)}%</Badge>;
  if (eff >= 85) return <Badge className="bg-amber-500 hover:bg-amber-500">{eff.toFixed(1)}%</Badge>;
  return <Badge className="bg-red-600 hover:bg-red-600">{eff.toFixed(1)}%</Badge>;
}

export default function SKUEfficiencyPage() {
  const [days, setDays] = useState<number>(30);
  const [line, setLine] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"eff_asc" | "eff_desc" | "gap_desc" | "runs_desc">("eff_asc");
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["sku-efficiency", days],
    queryFn: async () => {
      const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
      const { data: sessions, error: sErr } = await supabase
        .from("production_sessions")
        .select("id, line, session_date")
        .gte("session_date", since);
      if (sErr) throw sErr;
      const sessionMap = new Map((sessions ?? []).map((s) => [s.id, s]));
      const ids = Array.from(sessionMap.keys());
      if (ids.length === 0) return [] as Row[];

      const { data: items, error: iErr } = await supabase
        .from("production_items")
        .select("session_id, sku_id, target_qty, planned_qty, actual_qty, sku_products(code,name,category,target_per_hour)")
        .in("session_id", ids);
      if (iErr) throw iErr;

      const agg = new Map<string, Row>();
      for (const it of items ?? []) {
        const s = sessionMap.get(it.session_id);
        if (!s) continue;
        const sku = (it as any).sku_products;
        if (!sku) continue;
        const key = `${it.sku_id}|${s.line}`;
        const target = Number(it.target_qty ?? it.planned_qty ?? 0);
        const actual = Number(it.actual_qty ?? 0);
        const prev = agg.get(key);
        if (prev) {
          prev.target += target;
          prev.actual += actual;
          prev.runs += 1;
        } else {
          agg.set(key, {
            sku_id: it.sku_id,
            sku_code: sku.code,
            sku_name: sku.name,
            category: sku.category,
            upm_standard: Number(sku.target_per_hour ?? 0),
            line: s.line,
            target,
            actual,
            runs: 1,
          });
        }
      }
      return Array.from(agg.values());
    },
  });

  const lines = useMemo(() => {
    const set = new Set<string>();
    (data ?? []).forEach((r) => set.add(r.line));
    return Array.from(set).sort();
  }, [data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = (data ?? [])
      .filter((r) => (line === "all" ? true : r.line === line))
      .filter((r) => r.target > 0)
      .filter((r) =>
        q ? r.sku_code.toLowerCase().includes(q) || r.sku_name.toLowerCase().includes(q) : true,
      )
      .map((r) => ({
        ...r,
        eff: (r.actual / r.target) * 100,
        gap: r.actual - r.target,
      }));
    rows.sort((a, b) => {
      switch (sortBy) {
        case "eff_asc": return a.eff - b.eff;
        case "eff_desc": return b.eff - a.eff;
        case "gap_desc": return a.gap - b.gap;
        case "runs_desc": return b.runs - a.runs;
      }
    });
    return rows;
  }, [data, line, search, sortBy]);

  const worst = useMemo(
    () => [...filtered].filter((r) => r.eff < 85).sort((a, b) => a.eff - b.eff).slice(0, 5),
    [filtered],
  );
  const best = useMemo(
    () => [...filtered].filter((r) => r.eff >= 100).sort((a, b) => b.eff - a.eff).slice(0, 5),
    [filtered],
  );

  const exportCsv = () => {
    const headers = ["SKU", "Product", "Category", "Line", "Target", "Actual", "Gap", "Efficiency %", "Runs", "UPM Standard"];
    const rows = filtered.map((r) => [
      r.sku_code, `"${r.sku_name.replace(/"/g, '""')}"`, r.category ?? "", r.line,
      r.target, r.actual, r.gap, r.eff.toFixed(1), r.runs, r.upm_standard,
    ].join(","));
    const blob = new Blob([[headers.join(","), ...rows].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `sku-efficiency-${days}d.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">SKU Efficiency Ranking</h1>
            <p className="text-sm text-muted-foreground">Actual vs target by SKU and line over the selected window.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                {RANGE_DAYS.map((d) => <SelectItem key={d} value={String(d)}>{d} days</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={line} onValueChange={setLine}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Line" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All lines</SelectItem>
                {lines.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={sortBy} onValueChange={(v: typeof sortBy) => setSortBy(v)}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="eff_asc">Efficiency ↑</SelectItem>
                <SelectItem value="eff_desc">Efficiency ↓</SelectItem>
                <SelectItem value="gap_desc">Biggest gap</SelectItem>
                <SelectItem value="runs_desc">Most runs</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={exportCsv} disabled={!filtered.length}>
              <Download className="h-4 w-4 mr-2" /> Export CSV
            </Button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base text-red-600">
                <AlertTriangle className="h-4 w-4" /> Bottom 5 — below 85%
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {worst.length === 0 && <p className="text-sm text-muted-foreground">No SKUs below target.</p>}
              {worst.map((r) => (
                <div key={`${r.sku_id}-${r.line}`} className="flex items-center justify-between gap-2 border-b last:border-b-0 pb-2 last:pb-0">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{r.sku_code} — {r.sku_name}</div>
                    <div className="text-xs text-muted-foreground">{r.line} • {r.runs} run{r.runs > 1 ? "s" : ""}</div>
                  </div>
                  {badgeForEff(r.eff)}
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base text-emerald-600">
                <Trophy className="h-4 w-4" /> Top 5 — at or above target
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {best.length === 0 && <p className="text-sm text-muted-foreground">No SKUs hitting 100%+ yet.</p>}
              {best.map((r) => (
                <div key={`${r.sku_id}-${r.line}`} className="flex items-center justify-between gap-2 border-b last:border-b-0 pb-2 last:pb-0">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{r.sku_code} — {r.sku_name}</div>
                    <div className="text-xs text-muted-foreground">{r.line} • {r.runs} run{r.runs > 1 ? "s" : ""}</div>
                  </div>
                  {badgeForEff(r.eff)}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-base">All SKUs ({filtered.length})</CardTitle>
            <div className="relative w-64">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search SKU or product..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8"
              />
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No data in this range.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Line</TableHead>
                    <TableHead className="text-right">Target</TableHead>
                    <TableHead className="text-right">Actual</TableHead>
                    <TableHead className="text-right">Gap</TableHead>
                    <TableHead className="text-right">Eff.</TableHead>
                    <TableHead className="text-right">Runs</TableHead>
                    <TableHead className="text-right">UPM std</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => (
                    <TableRow key={`${r.sku_id}-${r.line}`}>
                      <TableCell className="font-mono text-xs">{r.sku_code}</TableCell>
                      <TableCell className="max-w-[280px] truncate">{r.sku_name}</TableCell>
                      <TableCell>{r.line}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.target.toLocaleString()}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.actual.toLocaleString()}</TableCell>
                      <TableCell className={`text-right tabular-nums ${r.gap < 0 ? "text-red-600" : "text-emerald-600"}`}>
                        {r.gap > 0 ? "+" : ""}{r.gap.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">{badgeForEff(r.eff)}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.runs}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.upm_standard}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
