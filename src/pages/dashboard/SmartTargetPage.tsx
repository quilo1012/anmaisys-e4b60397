import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { Calendar as CalendarIcon, Brain, TrendingUp, AlertTriangle, Check, Sparkles, ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Info } from "lucide-react";

type ComputeResult = {
  base_target: number;
  prev_target: number;
  prev_actual: number;
  deficit: number;
  carryover_adj: number;
  overdue_pms: number;
  mtbf_pct: number;
  mtbf_adj: number;
  predicted_target: number;
};

const fmt = (n: number | null | undefined) =>
  Number(n ?? 0).toLocaleString("en-GB", { maximumFractionDigits: 0 });

export default function SmartTargetPage() {
  const { role } = useAuth();
  const navigate = useNavigate();
  const canApply = role === "admin" || role === "manager";

  const [date, setDate] = useState<Date>(new Date());
  const [shift, setShift] = useState<"DAY" | "NIGHT">(
    new Date().getHours() >= 6 && new Date().getHours() < 18 ? "DAY" : "NIGHT"
  );
  const [lines, setLines] = useState<string[]>([]);
  const [line, setLine] = useState<string>("");

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ComputeResult | null>(null);
  const [override, setOverride] = useState<string>("");
  const [accuracy, setAccuracy] = useState<{ avgErr: number; count: number; acc: number } | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [baseline, setBaseline] = useState<{ avg: number; p90: number; days: number; period: string } | null>(null);
  const [hasPlan, setHasPlan] = useState<boolean | null>(null);
  const [latestPlanDate, setLatestPlanDate] = useState<string | null>(null);

  const entryDate = useMemo(() => format(date, "yyyy-MM-dd"), [date]);

  // Load distinct lines
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("rag_weekly_entries")
        .select("line")
        .order("line");
      const uniq = Array.from(new Set((data ?? []).map((r: any) => r.line).filter(Boolean))).sort();
      setLines(uniq);
      if (!line && uniq.length) setLine(uniq[0]);
    })();
  }, []);

  // Load line baseline (Apr-Jun 2026 import) whenever the selected line changes
  useEffect(() => {
    if (!line) { setBaseline(null); return; }
    (async () => {
      const { data } = await (supabase as any)
        .from("line_production_baselines")
        .select("daily_avg_units, daily_p90_units, active_days, data_period")
        .eq("line_name", line)
        .maybeSingle();
      if (data) {
        setBaseline({
          avg: Number(data.daily_avg_units) || 0,
          p90: Number(data.daily_p90_units) || 0,
          days: Number(data.active_days) || 0,
          period: data.data_period || "",
        });
      } else {
        setBaseline(null);
      }
    })();
  }, [line]);


  // Compute Smart Target
  async function compute() {
    if (!line) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("compute_smart_target", {
        _entry_date: entryDate,
        _line: line,
        _shift: shift,
      });
      if (error) throw error;
      const r = data as unknown as ComputeResult;
      setResult(r);
      setOverride(String(Math.round(r.predicted_target)));
    } catch (e: any) {
      toast.error(e.message ?? "Failed to compute");
    } finally {
      setLoading(false);
    }
  }

  // Load accuracy (last 30 days)
  async function loadAccuracy() {
    const since = format(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), "yyyy-MM-dd");
    const { data } = await supabase
      .from("prediction_log")
      .select("error_pct, entry_date, line, shift, predicted_target, applied_target, actual_qty, resolved")
      .gte("entry_date", since)
      .eq("resolved", true)
      .order("entry_date", { ascending: false });
    const rows = data ?? [];
    if (rows.length === 0) {
      setAccuracy({ avgErr: 0, count: 0, acc: 0 });
      setHistory([]);
      return;
    }
    const errs = rows.map((r: any) => Math.abs(Number(r.error_pct ?? 0)));
    const avg = errs.reduce((a, b) => a + b, 0) / errs.length;
    setAccuracy({ avgErr: avg, count: rows.length, acc: Math.max(0, 100 - avg) });
    setHistory(rows.slice(0, 10));
  }

  useEffect(() => {
    compute();
    loadAccuracy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryDate, shift, line]);

  async function applyTarget() {
    if (!result || !line) return;
    const applied = Number(override);
    if (!Number.isFinite(applied) || applied < 0) {
      toast.error("Invalid target value");
      return;
    }
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user?.id ?? null;

      // Upsert prediction_log
      const { error: pErr } = await supabase
        .from("prediction_log")
        .upsert(
          {
            entry_date: entryDate,
            line,
            shift,
            base_target: result.base_target,
            carryover_adj: result.carryover_adj,
            mtbf_adj: result.mtbf_adj,
            predicted_target: result.predicted_target,
            applied_target: applied,
            created_by: uid,
            notes: {
              overdue_pms: result.overdue_pms,
              mtbf_pct: result.mtbf_pct,
              prev_target: result.prev_target,
              prev_actual: result.prev_actual,
            },
          },
          { onConflict: "entry_date,line,shift" }
        );
      if (pErr) throw pErr;

      // Update rag_weekly_entries plan_qty (cascades to production_items via trigger)
      const { data: existing } = await supabase
        .from("rag_weekly_entries")
        .select("id")
        .eq("entry_date", entryDate)
        .eq("line", line)
        .eq("shift", shift)
        .maybeSingle();

      if (existing?.id) {
        const { error } = await supabase
          .from("rag_weekly_entries")
          .update({ plan_qty: applied })
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("rag_weekly_entries")
          .insert({ entry_date: entryDate, line, shift, plan_qty: applied, actual_qty: 0 });
        if (error) throw error;
      }

      toast.success(`Smart Target applied: ${fmt(applied)}`);
      loadAccuracy();
    } catch (e: any) {
      toast.error(e.message ?? "Failed to apply");
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Brain className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-semibold">Smart Target</h1>
          <Badge variant="secondary" className="ml-2">AI-assisted</Badge>
        </div>
        <Button variant="outline" size="sm" onClick={() => navigate("/dashboard")}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to menu
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4 flex flex-wrap gap-3 items-end">
          <div className="space-y-1">
            <Label>Date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-[180px] justify-start">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {format(date, "dd MMM yyyy")}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={date} onSelect={(d) => d && setDate(d)} />
              </PopoverContent>
            </Popover>
          </div>
          <div className="space-y-1">
            <Label>Shift</Label>
            <Select value={shift} onValueChange={(v) => setShift(v as any)}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="DAY">DAY</SelectItem>
                <SelectItem value="NIGHT">NIGHT</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Line</Label>
            <Select value={line} onValueChange={setLine}>
              <SelectTrigger className="w-[180px]"><SelectValue placeholder="Select line" /></SelectTrigger>
              <SelectContent>
                {lines.map((l) => (<SelectItem key={l} value={l}>{l}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={compute} disabled={loading}>Recompute</Button>
        </CardContent>
      </Card>

      {/* Baseline reference (Apr-Jun 2026 historical) */}
      {baseline && (
        <Card className="border-primary/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Historical baseline — {line} ({baseline.period}, {baseline.days} active days)
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-4 items-end">
            <div>
              <div className="text-xs text-muted-foreground">Smart Target (daily avg)</div>
              <div className="text-2xl font-bold">{fmt(baseline.avg)}</div>
              <Button
                size="sm"
                variant="outline"
                className="mt-1"
                onClick={() => setOverride(String(baseline.avg))}
                disabled={!canApply}
              >
                Use as target
              </Button>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Stretch Target (daily P90)</div>
              <div className="text-2xl font-bold text-emerald-500">{fmt(baseline.p90)}</div>
              <Button
                size="sm"
                variant="outline"
                className="mt-1"
                onClick={() => setOverride(String(baseline.p90))}
                disabled={!canApply}
              >
                Use as stretch
              </Button>
            </div>
          </CardContent>
        </Card>
      )}


      {/* Result */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Base target</CardTitle></CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-8 w-24" /> :
              <div className="text-3xl font-bold">{fmt(result?.base_target)}</div>}
            <p className="text-xs text-muted-foreground mt-1">From RAG Weekly plan</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground flex items-center gap-1">
              <TrendingUp className="h-4 w-4" /> Carry-over (+)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-8 w-24" /> :
              <div className="text-3xl font-bold text-emerald-500">+{fmt(result?.carryover_adj)}</div>}
            <p className="text-xs text-muted-foreground mt-1">
              Prev shift deficit: {fmt(result?.deficit)} · 50% rolled forward
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground flex items-center gap-1">
              <AlertTriangle className="h-4 w-4" /> MTBF risk (−)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-8 w-24" /> :
              <div className="text-3xl font-bold text-amber-500">{fmt(result?.mtbf_adj)}</div>}
            <p className="text-xs text-muted-foreground mt-1">
              {result?.overdue_pms ?? 0} PM overdue → {Math.round(((result?.mtbf_pct ?? 0) * 100))}% risk reduction
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Suggested + Apply */}
      <Card className="border-primary/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" /> Suggested target
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-4xl font-bold text-primary">
            {fmt(result?.predicted_target)}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label>Apply target (you can override)</Label>
              <Input
                type="number"
                value={override}
                onChange={(e) => setOverride(e.target.value)}
                className="w-[180px]"
                disabled={!canApply}
              />
            </div>
            <Button onClick={applyTarget} disabled={!canApply || !result}>
              <Check className="h-4 w-4 mr-1" /> Apply to RAG Weekly
            </Button>
            {!canApply && (
              <span className="text-xs text-muted-foreground">Admin / manager only</span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Accuracy */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Model accuracy — last 30 days</CardTitle>
        </CardHeader>
        <CardContent>
          {accuracy === null ? (
            <Skeleton className="h-10 w-40" />
          ) : accuracy.count === 0 ? (
            <p className="text-sm text-muted-foreground">No resolved predictions yet. Apply a target and wait for the shift actual to be recorded.</p>
          ) : (
            <div className="flex flex-wrap items-center gap-6">
              <div>
                <div className="text-3xl font-bold">{accuracy.acc.toFixed(1)}%</div>
                <p className="text-xs text-muted-foreground">Avg |error|: {accuracy.avgErr.toFixed(1)}% · n={accuracy.count}</p>
              </div>
              <div className="flex-1 min-w-[260px]">
                <div className="space-y-1">
                  {history.map((h: any) => (
                    <div key={`${h.entry_date}-${h.line}-${h.shift}`} className="flex items-center justify-between text-xs border-b border-border/40 py-1">
                      <span className="font-mono">{h.entry_date} · {h.line} · {h.shift}</span>
                      <span>
                        pred {fmt(h.applied_target ?? h.predicted_target)} → actual {fmt(h.actual_qty)}
                        <Badge variant={Math.abs(h.error_pct) <= 5 ? "default" : "secondary"} className="ml-2">
                          {Number(h.error_pct).toFixed(1)}%
                        </Badge>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
