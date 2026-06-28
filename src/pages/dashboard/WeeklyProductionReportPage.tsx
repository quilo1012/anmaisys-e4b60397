import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { format, subDays } from "date-fns";
import { Brain, TrendingUp, TrendingDown, AlertCircle, CheckCircle2, Target, Sparkles, ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

type Row = {
  entry_date: string;
  line: string;
  shift: string;
  predicted_target: number | null;
  applied_target: number | null;
  actual_qty: number | null;
  error_pct: number | null;
  resolved: boolean | null;
};

type LineStat = {
  line: string;
  count: number;
  acc: number;
  avgErr: number;
  bias: number; // signed mean error
};

const fmtPct = (n: number) => `${n.toFixed(1)}%`;

export default function WeeklyProductionReportPage() {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    (async () => {
      const since = format(subDays(new Date(), 90), "yyyy-MM-dd");
      const { data } = await supabase
        .from("prediction_log")
        .select("entry_date,line,shift,predicted_target,applied_target,actual_qty,error_pct,resolved")
        .gte("entry_date", since)
        .eq("resolved", true)
        .order("entry_date", { ascending: false });
      setRows((data ?? []) as Row[]);
    })();
  }, []);

  const overall = useMemo(() => {
    if (!rows || rows.length === 0) return { acc: 68, count: 0, baseline: true };
    const errs = rows.map((r) => Math.abs(Number(r.error_pct ?? 0)));
    const avg = errs.reduce((a, b) => a + b, 0) / errs.length;
    return { acc: Math.max(0, 100 - avg), count: rows.length, baseline: false };
  }, [rows]);

  const byLine: LineStat[] = useMemo(() => {
    if (!rows) return [];
    const map = new Map<string, Row[]>();
    rows.forEach((r) => {
      if (!r.line) return;
      const arr = map.get(r.line) ?? [];
      arr.push(r);
      map.set(r.line, arr);
    });
    const out: LineStat[] = [];
    map.forEach((arr, line) => {
      const errs = arr.map((r) => Number(r.error_pct ?? 0));
      const absErr = errs.map(Math.abs);
      const avgAbs = absErr.reduce((a, b) => a + b, 0) / errs.length;
      const bias = errs.reduce((a, b) => a + b, 0) / errs.length;
      out.push({ line, count: arr.length, acc: Math.max(0, 100 - avgAbs), avgErr: avgAbs, bias });
    });
    return out.sort((a, b) => b.acc - a.acc);
  }, [rows]);

  const weekly = useMemo(() => {
    if (!rows) return [];
    const map = new Map<string, number[]>();
    rows.forEach((r) => {
      const d = new Date(r.entry_date);
      const monday = new Date(d);
      monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      const key = format(monday, "dd MMM");
      const arr = map.get(key) ?? [];
      arr.push(Math.abs(Number(r.error_pct ?? 0)));
      map.set(key, arr);
    });
    return Array.from(map.entries())
      .map(([week, errs]) => ({
        week,
        accuracy: Math.max(0, 100 - errs.reduce((a, b) => a + b, 0) / errs.length),
      }))
      .slice(-8)
      .reverse();
  }, [rows]);

  const best = byLine[0];
  const worst = byLine.length > 1 ? byLine.slice(-2) : [];

  const roadmap = [
    { label: "Baseline", value: 68, current: overall.acc < 73 },
    { label: "+ Carry-over + MTBF", value: 75, current: overall.acc >= 73 && overall.acc < 80 },
    { label: "+ 3 months data", value: 82, current: overall.acc >= 80 && overall.acc < 87 },
    { label: "+ Continuous learning", value: 90, current: overall.acc >= 87 },
  ];

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Brain className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-semibold">Weekly Production Report</h1>
        <Badge variant="secondary" className="ml-2">Continuous learning</Badge>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Overall accuracy (90d)</CardTitle></CardHeader>
          <CardContent>
            {rows === null ? <Skeleton className="h-10 w-24" /> : (
              <>
                <div className="text-4xl font-bold">{fmtPct(overall.acc)}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  {overall.baseline ? "Baseline estimate · awaiting data" : `n=${overall.count} predictions`}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground flex items-center gap-1">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Best line
            </CardTitle>
          </CardHeader>
          <CardContent>
            {best ? (
              <>
                <div className="text-2xl font-bold">{best.line}</div>
                <p className="text-xs text-emerald-500 mt-1">{fmtPct(best.acc)} accuracy · n={best.count}</p>
              </>
            ) : <p className="text-sm text-muted-foreground">No data yet</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground flex items-center gap-1">
              <AlertCircle className="h-4 w-4 text-amber-500" /> Lines needing attention
            </CardTitle>
          </CardHeader>
          <CardContent>
            {worst.length ? (
              <div className="space-y-1">
                {worst.map((l) => (
                  <div key={l.line} className="flex justify-between text-sm">
                    <span className="font-medium">{l.line}</span>
                    <span className="text-amber-500">{fmtPct(l.acc)}</span>
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-muted-foreground">No data yet</p>}
          </CardContent>
        </Card>
      </div>

      {/* Roadmap */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-5 w-5 text-primary" /> Model maturity roadmap
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            {roadmap.map((step, i) => (
              <div
                key={step.label}
                className={`p-3 rounded-lg border ${step.current ? "border-primary bg-primary/5" : "border-border/50"}`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-muted-foreground">Phase {i + 1}</span>
                  {step.current && <Badge variant="default" className="text-xs">You are here</Badge>}
                </div>
                <div className="text-2xl font-bold">{step.value}%</div>
                <p className="text-xs text-muted-foreground mt-1">{step.label}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Weekly trend */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Weekly accuracy trend</CardTitle>
        </CardHeader>
        <CardContent>
          {rows === null ? (
            <Skeleton className="h-48 w-full" />
          ) : weekly.length === 0 ? (
            <p className="text-sm text-muted-foreground">No resolved predictions yet. Apply Smart Targets and the trend builds automatically.</p>
          ) : (
            <ChartContainer config={{ accuracy: { label: "Accuracy", color: "hsl(var(--primary))" } }} className="h-48 w-full">
              <BarChart data={weekly}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="week" />
                <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="accuracy" fill="var(--color-accuracy)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      {/* Per-line breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Accuracy by line</CardTitle>
        </CardHeader>
        <CardContent>
          {byLine.length === 0 ? (
            <p className="text-sm text-muted-foreground">No resolved predictions yet.</p>
          ) : (
            <div className="space-y-3">
              {byLine.map((l) => {
                const color = l.acc >= 75 ? "text-emerald-500" : l.acc >= 60 ? "text-amber-500" : "text-red-500";
                const biasLabel = Math.abs(l.bias) > 5
                  ? l.bias > 0 ? "actuals run above target" : "actuals run below target"
                  : null;
                return (
                  <div key={l.line} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium flex items-center gap-2">
                        {l.line}
                        {biasLabel && (
                          <Badge variant="outline" className="text-xs">
                            {l.bias > 0 ? <TrendingUp className="h-3 w-3 mr-1" /> : <TrendingDown className="h-3 w-3 mr-1" />}
                            {biasLabel}
                          </Badge>
                        )}
                      </span>
                      <span className={`font-mono ${color}`}>{fmtPct(l.acc)} · n={l.count}</span>
                    </div>
                    <Progress value={l.acc} className="h-2" />
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* How to improve */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Target className="h-5 w-5 text-primary" /> How to improve accuracy
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm">
            <li className="flex justify-between border-b border-border/40 pb-2">
              <span>Apply Smart Target every shift (feeds the learning loop)</span>
              <Badge variant="secondary">+5-8%</Badge>
            </li>
            <li className="flex justify-between border-b border-border/40 pb-2">
              <span>Close PMs before they go overdue (reduces MTBF risk noise)</span>
              <Badge variant="secondary">+3-5%</Badge>
            </li>
            <li className="flex justify-between border-b border-border/40 pb-2">
              <span>Record actual_qty before end of shift (resolves predictions same-day)</span>
              <Badge variant="secondary">+2-4%</Badge>
            </li>
            <li className="flex justify-between border-b border-border/40 pb-2">
              <span>Map all iTouching stop codes (improves downtime attribution)</span>
              <Badge variant="secondary">+2-3%</Badge>
            </li>
            <li className="flex justify-between">
              <span>Accumulate 3 months of data (model self-corrects bias)</span>
              <Badge variant="secondary">+7-10%</Badge>
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
