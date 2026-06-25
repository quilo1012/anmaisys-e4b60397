import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronLeft, ChevronRight, Printer } from "lucide-react";
import { format, startOfWeek, endOfWeek, addDays, addWeeks, parseISO } from "date-fns";
import { useLines, useSkuProducts } from "@/hooks/useProductionPlanner";

interface Row { id: string; session_date: string; shift: string; line: string; production_items: { sku_id: string; target_qty: number | null; planned_qty: number | null; actual_qty: number | null }[] }

export default function WeeklyProductionReportPage() {
  const { data: lines = [] } = useLines();
  const { data: skus = [] } = useSkuProducts(false);
  const skuMap = useMemo(() => new Map(skus.map((s) => [s.id, s])), [skus]);

  const [anchor, setAnchor] = useState(new Date());
  const [line, setLine] = useState<string>("");
  const [shift, setShift] = useState<"all" | "DAY" | "NIGHT">("all");

  const weekStart = startOfWeek(anchor, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(anchor, { weekStartsOn: 1 });
  const from = format(weekStart, "yyyy-MM-dd");
  const to = format(weekEnd, "yyyy-MM-dd");

  // "" means all lines
  const activeLine = line;

  const { data: rows = [] } = useQuery({
    queryKey: ["weekly_report", from, to, activeLine, shift],
    queryFn: async () => {
      let q = supabase.from("production_sessions")
        .select("id, session_date, shift, line, production_items(sku_id, target_qty, planned_qty, actual_qty)")
        .gte("session_date", from).lte("session_date", to);
      if (activeLine) q = q.eq("line", activeLine);
      if (shift !== "all") q = q.eq("shift", shift);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  const daily = useMemo(() => days.map((d) => {
    const ds = format(d, "yyyy-MM-dd");
    const dayRows = rows.filter((r) => r.session_date === ds);
    const target = dayRows.reduce((a, r) => a + r.production_items.reduce((x, i) => x + Number(i.target_qty ?? i.planned_qty ?? 0), 0), 0);
    const actual = dayRows.reduce((a, r) => a + r.production_items.reduce((x, i) => x + Number(i.actual_qty ?? 0), 0), 0);
    return { date: ds, label: format(d, "EEE dd/MM"), target, actual, eff: target > 0 ? (actual / target) * 100 : 0 };
  }), [days, rows]);

  const totals = useMemo(() => {
    const t = daily.reduce((a, d) => a + d.target, 0);
    const a = daily.reduce((acc, d) => acc + d.actual, 0);
    return { target: t, actual: a, eff: t > 0 ? (a / t) * 100 : 0 };
  }, [daily]);

  const bySku = useMemo(() => {
    const m = new Map<string, { id: string; target: number; actual: number }>();
    for (const r of rows) for (const i of r.production_items) {
      const cur = m.get(i.sku_id) ?? { id: i.sku_id, target: 0, actual: 0 };
      cur.target += Number(i.target_qty ?? i.planned_qty ?? 0);
      cur.actual += Number(i.actual_qty ?? 0);
      m.set(i.sku_id, cur);
    }
    return Array.from(m.values()).map((x) => ({ ...x, eff: x.target > 0 ? (x.actual / x.target) * 100 : 0 })).sort((a, b) => b.actual - a.actual);
  }, [rows]);

  const effClass = (e: number) => e >= 100 ? "text-green-500" : e >= 80 ? "text-amber-500" : "text-red-500";

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-6 print:p-0">
        <div className="flex items-center justify-between flex-wrap gap-3 print:hidden">
          <h1 className="text-2xl font-bold">Weekly Production Report</h1>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="icon" onClick={() => setAnchor(addWeeks(anchor, -1))}><ChevronLeft className="h-4 w-4" /></Button>
            <div className="text-sm font-medium px-3">{format(weekStart, "dd MMM")} – {format(weekEnd, "dd MMM yyyy")}</div>
            <Button variant="outline" size="icon" onClick={() => setAnchor(addWeeks(anchor, 1))}><ChevronRight className="h-4 w-4" /></Button>
            <Select value={line || "__all__"} onValueChange={(v) => setLine(v === "__all__" ? "" : v)}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Line" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All lines</SelectItem>
                {lines.map((l) => <SelectItem key={l.id} value={l.name}>{l.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={shift} onValueChange={(v) => setShift(v as "all" | "DAY" | "NIGHT")}>
              <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">All shifts</SelectItem><SelectItem value="DAY">Day</SelectItem><SelectItem value="NIGHT">Night</SelectItem></SelectContent>
            </Select>
            <Button onClick={() => window.print()}><Printer className="h-4 w-4 mr-1" />Print / PDF</Button>
          </div>
        </div>

        <div className="hidden print:block mb-4">
          <h1 className="text-2xl font-bold">Weekly Production Report</h1>
          <p className="text-sm">Line: <strong>{activeLine}</strong> • Week: {format(weekStart, "dd MMM")} – {format(weekEnd, "dd MMM yyyy")} • Shift: {shift}</p>
        </div>

        <Card>
          <CardHeader><CardTitle>Daily breakdown</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Day</TableHead><TableHead className="text-right">Target</TableHead><TableHead className="text-right">Actual</TableHead><TableHead className="text-right">Eff %</TableHead></TableRow></TableHeader>
              <TableBody>
                {daily.map((d) => (
                  <TableRow key={d.date}>
                    <TableCell>{d.label}</TableCell>
                    <TableCell className="text-right">{d.target}</TableCell>
                    <TableCell className="text-right">{d.actual}</TableCell>
                    <TableCell className={`text-right font-semibold ${effClass(d.eff)}`}>{d.target > 0 ? `${d.eff.toFixed(0)}%` : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="font-bold">Total</TableCell>
                  <TableCell className="text-right font-bold">{totals.target}</TableCell>
                  <TableCell className="text-right font-bold">{totals.actual}</TableCell>
                  <TableCell className={`text-right font-bold ${effClass(totals.eff)}`}>{totals.target > 0 ? `${totals.eff.toFixed(0)}%` : "—"}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>SKU breakdown</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>SKU</TableHead><TableHead>Name</TableHead><TableHead className="text-right">Target</TableHead><TableHead className="text-right">Actual</TableHead><TableHead className="text-right">Eff %</TableHead></TableRow></TableHeader>
              <TableBody>
                {bySku.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No SKUs</TableCell></TableRow>}
                {bySku.map((s) => {
                  const sku = skuMap.get(s.id);
                  return (
                    <TableRow key={s.id}>
                      <TableCell className="font-mono text-xs">{sku?.code ?? "?"}</TableCell>
                      <TableCell>{sku?.name ?? "Unknown"}</TableCell>
                      <TableCell className="text-right">{s.target}</TableCell>
                      <TableCell className="text-right">{s.actual}</TableCell>
                      <TableCell className={`text-right font-semibold ${effClass(s.eff)}`}>{s.target > 0 ? `${s.eff.toFixed(0)}%` : "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
