import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/DashboardLayout";
import { PageHeader } from "@/components/ui/PageHeader";
import { DashboardWelcome } from "@/components/DashboardWelcome";
import { LeaderScorecard } from "@/components/LeaderScorecard";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight, Medal, BarChart3, Printer, AlertTriangle, Download } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { generatePerformanceReportPDF } from "@/lib/performanceReport";
import { getCurrentFactoryShift } from "@/lib/shifts";
import { EmptyState } from "@/components/EmptyState";
import { format, parseISO, addDays, subDays, addWeeks, addMonths, addQuarters, addYears, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfQuarter, endOfQuarter, startOfYear, endOfYear } from "date-fns";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, LineChart, Line } from "recharts";
import { CircularProgress } from "@/components/ui/circular-progress";
import { ShiftLock } from "@/components/ShiftLock";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

type Period = "day" | "week" | "month" | "quarter" | "year" | "custom";

interface SessionAgg {
  id: string; session_date: string; shift: string; line: string;
  leader_name: string | null; locked: boolean;
  target: number; actual: number; eff: number;
  items: { sku_id: string; actual: number }[];
}

export default function ProductionPerformancePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { profile } = useAuth();
  // Open on the CURRENT factory shift, not just the calendar day — at 02:00 the
  // running shift is the previous day's NIGHT, so getCurrentFactoryShift() gives
  // the right session_date + shift.
  const [date, setDate] = useState(() => getCurrentFactoryShift().sessionDate);
  const [endDate, setEndDate] = useState(() => getCurrentFactoryShift().sessionDate);
  const [period, setPeriod] = useState<Period>("day");
  const [shift, setShift] = useState<"all" | "DAY" | "NIGHT">(() => getCurrentFactoryShift().shiftCode === "night" ? "NIGHT" : "DAY");
  const [lineFilter, setLineFilter] = useState<string>("__all__");
  const [leaderFilter, setLeaderFilter] = useState<string>("__all__");
  const [savingLeaderFor, setSavingLeaderFor] = useState<string | null>(null);
  const [addingLeaderFor, setAddingLeaderFor] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const previewFrame = useRef<HTMLIFrameElement>(null);
  const [newLeaderName, setNewLeaderName] = useState("");
  const [scorecardFor, setScorecardFor] = useState<string | null>(null);

  const addNewLeader = async (lineName: string, hasSession: boolean) => {
    const name = newLeaderName.trim();
    if (!name) {
      toast.error("Leader name required");
      return;
    }
    setSavingLeaderFor(lineName);
    try {
      const { error } = await supabase.from("line_leaders").insert({ name, shift: "BOTH", active: true });
      if (error && !/duplicate|unique/i.test(error.message)) throw error;
      await qc.invalidateQueries({ queryKey: ["line_leaders_active"] });
      setAddingLeaderFor(null);
      setNewLeaderName("");
      await setLeaderForLine(lineName, name, hasSession);
      toast.success(`Leader "${name}" added`);
    } catch (e: any) {
      toast.error(e?.message || "Failed to add leader");
      setSavingLeaderFor(null);
    }
  };

  const setLeaderForLine = async (lineName: string, leaderName: string | null, hasSession: boolean) => {
    setSavingLeaderFor(lineName);
    try {
      if (hasSession) {
        let q = supabase.from("production_sessions")
          .update({ leader_name: leaderName })
          .eq("line", lineName)
          .gte("session_date", range.from)
          .lte("session_date", range.to);
        if (shift !== "all") q = q.eq("shift", shift);
        const { error } = await q;
        if (error) throw error;
      } else {
        // No session exists yet for this line/range — create one so the leader assignment sticks.
        const sessionShift = shift === "all" ? "DAY" : shift;
        const { error } = await supabase.from("production_sessions").insert({
          line: lineName,
          session_date: range.from,
          shift: sessionShift,
          leader_name: leaderName,
        });
        if (error) throw error;
      }
      toast.success(leaderName ? `Leader set to ${leaderName} for ${lineName}` : `Leader cleared for ${lineName}`);
      qc.invalidateQueries({ queryKey: ["oee"] });
    } catch (e: any) {
      toast.error(e?.message || "Failed to update leader");
    } finally {
      setSavingLeaderFor(null);
    }
  };


  const range = useMemo(() => {
    const d = parseISO(date);
    if (period === "day") return { from: date, to: date };
    if (period === "week") return { from: format(startOfWeek(d, { weekStartsOn: 1 }), "yyyy-MM-dd"), to: format(endOfWeek(d, { weekStartsOn: 1 }), "yyyy-MM-dd") };
    if (period === "month") return { from: format(startOfMonth(d), "yyyy-MM-dd"), to: format(endOfMonth(d), "yyyy-MM-dd") };
    if (period === "quarter") return { from: format(startOfQuarter(d), "yyyy-MM-dd"), to: format(endOfQuarter(d), "yyyy-MM-dd") };
    if (period === "year") return { from: format(startOfYear(d), "yyyy-MM-dd"), to: format(endOfYear(d), "yyyy-MM-dd") };
    // custom
    const from = date <= endDate ? date : endDate;
    const to = date <= endDate ? endDate : date;
    return { from, to };
  }, [date, endDate, period]);

  const { data: lines = [] } = useQuery({
    queryKey: ["lines"],
    queryFn: async () => {
      const { data, error } = await supabase.from("lines").select("name").order("name");
      if (error) throw error;
      return (data ?? []) as { name: string }[];
    },
  });

  const { data: leaders = [] } = useQuery({
    queryKey: ["line_leaders_active"],
    queryFn: async () => {
      const { data, error } = await supabase.from("line_leaders").select("name").eq("active", true).order("name");
      if (error) throw error;
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
        const { data, error } = await supabase.from("sku_products").select("id, code, name").order("code").range(offset, offset + pageSize - 1);
        if (error) throw error;
        const page = (data ?? []) as { id: string; code: string; name: string }[];
        rows.push(...page);
        if (page.length < pageSize) break;
      }
      return rows;
    },
  });
  const skuMap = useMemo(() => new Map(skus.map((s) => [s.id, s])), [skus]);

  type RagRow = { entry_date: string; line: string; shift: string; plan_qty: number; actual_qty: number };

  // Quality actions still open (todo / in progress) in the same period + shift +
  // line, so the floor sees what's outstanding right on the performance screen.
  // All quality actions in the period (any status) — the report lists them all
  // with a Status column, so completed actions still show.
  const { data: periodActions = [] } = useQuery({
    queryKey: ["perf-quality-actions", range.from, range.to, shift, lineFilter],
    // Live feed: keep the panel current as actions are opened/closed elsewhere.
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      let q = supabase.from("quality_actions")
        .select("id, action_no, recorded_at, line, shift, status, severity, description")
        .gte("recorded_at", range.from).lte("recorded_at", `${range.to}T23:59:59`)
        .order("recorded_at", { ascending: false });
      if (shift !== "all") q = q.eq("shift", shift);
      if (lineFilter !== "__all__") q = q.eq("line", lineFilter);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
  // The live dashboard card keeps showing only still-open actions.
  const openActions = periodActions.filter((a) => a.status === "todo" || a.status === "in_progress");

  const { data: queryResult } = useQuery<{ sessions: SessionAgg[]; ragRows: RagRow[] }>({
    queryKey: ["oee", range.from, range.to, shift, lineFilter, leaderFilter],
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      let q = supabase.from("production_sessions")
        .select("id, session_date, shift, line, leader_name, locked, production_items(sku_id, target_qty, planned_qty, actual_qty)")
        .gte("session_date", range.from).lte("session_date", range.to);
      if (shift !== "all") q = q.eq("shift", shift);
      if (lineFilter !== "__all__") q = q.eq("line", lineFilter);
      if (leaderFilter !== "__all__") q = q.eq("leader_name", leaderFilter);

      // Target comes from RAG Weekly (plan_qty), NOT from SKU per-item targets.
      let rq = supabase.from("rag_weekly_entries")
        .select("entry_date, line, shift, plan_qty, actual_qty")
        .gte("entry_date", range.from).lte("entry_date", range.to);
      if (shift !== "all") rq = rq.eq("shift", shift);
      if (lineFilter !== "__all__") rq = rq.eq("line", lineFilter);

      const [{ data, error }, { data: ragData, error: ragErr }] = await Promise.all([q, rq]);
      if (error) throw error;
      if (ragErr) throw ragErr;

      const ragRows: RagRow[] = ((ragData ?? []) as { entry_date: string; line: string; shift: string; plan_qty: number | null; actual_qty: number | null }[])
        .map((r) => ({ entry_date: r.entry_date, line: r.line, shift: r.shift, plan_qty: Number(r.plan_qty ?? 0), actual_qty: Number(r.actual_qty ?? 0) }));

      const ragPlanMap = new Map<string, number>();
      const ragActualMap = new Map<string, number>();
      for (const r of ragRows) {
        const k = `${r.entry_date}|${r.line}|${r.shift}`;
        ragPlanMap.set(k, r.plan_qty);
        ragActualMap.set(k, r.actual_qty);
      }

      const sessions: SessionAgg[] = (data ?? []).map((s: { id: string; session_date: string; shift: string; line: string; leader_name: string | null; locked: boolean; production_items: { sku_id: string; target_qty: number | null; planned_qty: number | null; actual_qty: number | null }[] }) => {
        const items = s.production_items ?? [];
        const key = `${s.session_date}|${s.line}|${s.shift}`;
        const target = ragPlanMap.get(key) ?? 0;
        const itemsActual = items.reduce((a, i) => a + Number(i.actual_qty ?? 0), 0);
        const ragActual = ragActualMap.get(key) ?? 0;
        const actual = ragActual > 0 ? ragActual : itemsActual;
        return { id: s.id, session_date: s.session_date, shift: s.shift, line: s.line, leader_name: s.leader_name, locked: s.locked, target, actual, eff: target > 0 ? (actual / target) * 100 : 0, items: items.map((i) => ({ sku_id: i.sku_id, actual: Number(i.actual_qty ?? 0) })) };
      });

      return { sessions, ragRows };
    },
  });

  const sessions = useMemo(() => queryResult?.sessions ?? [], [queryResult]);
  const ragRows = useMemo(() => queryResult?.ragRows ?? [], [queryResult]);

  const topSkus = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of sessions) for (const i of s.items) {
      if (!i.sku_id) continue;
      m.set(i.sku_id, (m.get(i.sku_id) ?? 0) + i.actual);
    }
    return Array.from(m.entries())
      .map(([sku_id, actual]) => ({ label: skuMap.get(sku_id)?.code ?? "?", name: skuMap.get(sku_id)?.name ?? "", actual }))
      .sort((a, b) => b.actual - a.actual).slice(0, 10);
  }, [sessions, skuMap]);

  const byLeader = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of sessions) {
      if (!s.leader_name) continue;
      m.set(s.leader_name, (m.get(s.leader_name) ?? 0) + s.actual);
    }
    return Array.from(m.entries()).map(([leader, actual]) => ({ leader, actual }))
      .sort((a, b) => b.actual - a.actual).slice(0, 10);
  }, [sessions]);

  // Build byLine from the UNION of RAG Weekly plan rows and production_sessions,
  // so lines with a plan but no session yet still appear (Actual = 0).
  // When leaderFilter is active, RAG-only lines are excluded (RAG has no leader info).
  const byLine = useMemo(() => {
    type Agg = { line: string; target: number; ragActual: number; sessionActual: number; leader: string | null; hasSession: boolean; ragLines: Set<string> };
    const map = new Map<string, Agg>();
    const ragLineSet = new Set<string>();

    if (leaderFilter === "__all__") {
      for (const r of ragRows) {
        ragLineSet.add(r.line);
        const cur = map.get(r.line) ?? { line: r.line, target: 0, ragActual: 0, sessionActual: 0, leader: null, hasSession: false, ragLines: ragLineSet };
        cur.target += r.plan_qty;
        cur.ragActual += r.actual_qty;
        map.set(r.line, cur);
      }
    }

    for (const s of sessions) {
      const cur = map.get(s.line) ?? { line: s.line, target: 0, ragActual: 0, sessionActual: 0, leader: null, hasSession: false, ragLines: ragLineSet };
      // Only add session target if this line wasn't already seeded from RAG (avoid double count).
      if (!ragLineSet.has(s.line)) cur.target += s.target;
      const itemsActual = s.items.reduce((a, i) => a + i.actual, 0);
      cur.sessionActual += itemsActual;
      cur.leader = s.leader_name ?? cur.leader;
      cur.hasSession = true;
      map.set(s.line, cur);
    }

    return Array.from(map.values()).map((x) => {
      const actual = x.ragActual > 0 ? x.ragActual : x.sessionActual;
      // A line that was planned to run but has nothing logged on the floor.
      //
      // This used to look for a RAG figure with no matching shift record — the way
      // Line 1 read 96% and 99% on 29/07 with zero entries on either shift. RAG
      // actual is now derived from the same entries, so the two can no longer
      // disagree and that test can never fire. What still needs flagging the same
      // day is the case it was really catching: a planned line nobody logged.
      const notLogged = x.target > 0 && actual === 0;
      return { line: x.line, target: x.target, actual, leader: x.leader, hasSession: x.hasSession, notLogged, eff: x.target > 0 ? (actual / x.target) * 100 : 0 };
    })
      // Hide empty placeholder lines: no RAG target AND no production (e.g. a session
      // created just by assigning a leader, or an operator opening My Production).
      .filter((x) => x.target > 0 || x.actual > 0)
      .sort((a, b) => b.eff - a.eff);
  }, [sessions, ragRows, leaderFilter]);

  const trend = useMemo(() => {
    const map = new Map<string, { date: string; target: number; actual: number }>();
    for (const s of sessions) {
      const cur = map.get(s.session_date) ?? { date: s.session_date, target: 0, actual: 0 };
      cur.target += s.target; cur.actual += s.actual;
      map.set(s.session_date, cur);
    }
    return Array.from(map.values()).map((x) => ({ ...x, eff: x.target > 0 ? (x.actual / x.target) * 100 : 0 })).sort((a, b) => a.date.localeCompare(b.date));
  }, [sessions]);

  const leaderboard = useMemo(() => {
    const map = new Map<string, { leader: string; sessions: number; target: number; actual: number }>();
    for (const s of sessions) {
      if (!s.leader_name) continue;
      const cur = map.get(s.leader_name) ?? { leader: s.leader_name, sessions: 0, target: 0, actual: 0 };
      cur.sessions += 1; cur.target += s.target; cur.actual += s.actual;
      map.set(s.leader_name, cur);
    }
    return Array.from(map.values()).map((x) => ({ ...x, eff: x.target > 0 ? (x.actual / x.target) * 100 : 0 })).sort((a, b) => b.eff - a.eff).slice(0, 10);
  }, [sessions]);

  const lineRank = (name: string) => {
    const n = (name ?? "").toLowerCase();
    const m = n.match(/line\s*(\d+)/);
    if (m) return parseInt(m[1], 10);
    if (n.includes("capsule")) return 100;
    if (n.includes("gel")) return 200;
    return 999;
  };
  const sortedByLine = useMemo(() => [...byLine].sort((a, b) => lineRank(a.line) - lineRank(b.line) || a.line.localeCompare(b.line)), [byLine]);
  const sortedLines = useMemo(() => [...lines].sort((a, b) => lineRank(a.name) - lineRank(b.name) || a.name.localeCompare(b.name)), [lines]);

  const ragFill = (e: number) => e >= 100 ? "hsl(142 76% 36%)" : e >= 80 ? "hsl(38 92% 50%)" : "hsl(0 84% 60%)";
  const medal = (i: number) => i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : null;

  const buildReport = (output: "save" | "dataurl" | "bloburl") => {
    const scored = sortedByLine.filter((l) => l.target > 0);
    const totalTarget = scored.reduce((a, l) => a + l.target, 0);
    const totalActual = scored.reduce((a, l) => a + l.actual, 0);
    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
    return generatePerformanceReportPDF({
      periodLabel: `${cap(period)} · ${format(parseISO(range.from), "dd/MM/yyyy")} – ${format(parseISO(range.to), "dd/MM/yyyy")}`,
      filtersLabel: `Shift: ${shift === "all" ? "All" : cap(shift.toLowerCase())} · Line: ${lineFilter === "__all__" ? "All" : lineFilter} · Leader: ${leaderFilter === "__all__" ? "All" : leaderFilter}`,
      lines: sortedByLine.map((l) => ({ line: l.line, leader: l.leader, target: l.target, actual: l.actual, eff: l.eff })),
      totalTarget, totalActual,
      openActions: periodActions.map((a) => ({ recorded_at: a.recorded_at, action_no: a.action_no, line: a.line, shift: a.shift, severity: a.severity, description: a.description, status: a.status })),
      generatedBy: profile?.name || "—",
    }, { output });
  };
  // Preview first: a data: URI renders in the iframe even inside a sandboxed
  // frame (the Lovable editor), where a blob: URL is blocked by Chrome.
  const printReport = async () => {
    try {
      const url = await buildReport("dataurl");
      if (url) setPreviewUrl(url as string);
    } catch { toast.error("Could not generate the performance report"); }
  };
  const downloadReport = async () => { try { await buildReport("save"); } catch { toast.error("Could not download the report"); } };
  // Printing: open the PDF in a new tab (top-level blob nav is allowed and the
  // browser's PDF viewer has a print button). Falls back to download if pop-ups
  // are blocked.
  const printInTab = async () => {
    try {
      const url = await buildReport("bloburl");
      const w = url ? window.open(url as string, "_blank") : null;
      if (!w) { await buildReport("save"); toast.info("Pop-up blocked — the report was downloaded instead"); }
    } catch { toast.error("Could not open the report for printing"); }
  };


  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Landing screen for supervisors and the production office — same opening. */}
        <DashboardWelcome />

        <LeaderScorecard
          leaderName={scorecardFor}
          from={range.from}
          to={range.to}
          shift={shift}
          onClose={() => setScorecardFor(null)}
        />

        <div className="space-y-3">
          <PageHeader
            title="Production Performance"
            description="Output against target by line, leader and shift."
            icon={<BarChart3 className="h-5 w-5" />}
            actions={<Button variant="outline" size="sm" onClick={printReport}><Printer className="h-4 w-4 mr-1" />Print report</Button>}
          />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:flex-wrap">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" className="shrink-0" onClick={() => {
                if (period === "custom") {
                  const from = parseISO(date), to = parseISO(endDate);
                  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86400000) + 1);
                  setDate(format(subDays(from, days), "yyyy-MM-dd"));
                  setEndDate(format(subDays(to, days), "yyyy-MM-dd"));
                  return;
                }
                const d = parseISO(date);
                const step = period === "week" ? subDays(d, 7) : period === "month" ? addMonths(d, -1) : period === "quarter" ? addQuarters(d, -1) : period === "year" ? addYears(d, -1) : subDays(d, 1);
                setDate(format(step, "yyyy-MM-dd"));
              }}><ChevronLeft className="h-4 w-4" /></Button>
              <Input type="date" value={date} onChange={(e) => {
                setDate(e.target.value);
                if (period !== "custom") { setPeriod("custom"); if (endDate < e.target.value) setEndDate(e.target.value); }
              }} className="flex-1 sm:w-40 sm:flex-none min-w-0" />
              <span className="text-xs text-muted-foreground shrink-0">to</span>
              <Input type="date" value={endDate} min={date} onChange={(e) => {
                setEndDate(e.target.value);
                if (period !== "custom") setPeriod("custom");
              }} className="flex-1 sm:w-40 sm:flex-none min-w-0" />
              <Button variant="outline" size="icon" className="shrink-0" onClick={() => {
                if (period === "custom") {
                  const from = parseISO(date), to = parseISO(endDate);
                  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86400000) + 1);
                  setDate(format(addDays(from, days), "yyyy-MM-dd"));
                  setEndDate(format(addDays(to, days), "yyyy-MM-dd"));
                  return;
                }
                const d = parseISO(date);
                const step = period === "week" ? addDays(d, 7) : period === "month" ? addMonths(d, 1) : period === "quarter" ? addQuarters(d, 1) : period === "year" ? addYears(d, 1) : addDays(d, 1);
                setDate(format(step, "yyyy-MM-dd"));
              }}><ChevronRight className="h-4 w-4" /></Button>
            </div>
            <div className="grid grid-cols-2 sm:flex sm:items-center gap-2">
              <Select value={period} onValueChange={(v) => {
                const p = v as Period;
                if (p === "custom" && endDate < date) setEndDate(date);
                if (p !== "custom") setEndDate(date);
                setPeriod(p);
              }}>
                <SelectTrigger className="w-full sm:w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="day">Day</SelectItem>
                  <SelectItem value="week">Week</SelectItem>
                  <SelectItem value="month">Month</SelectItem>
                  <SelectItem value="quarter">Quarter</SelectItem>
                  <SelectItem value="year">Year</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
              <Select value={shift} onValueChange={(v) => setShift(v as "all" | "DAY" | "NIGHT")}>
                <SelectTrigger className="w-full sm:w-28"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">All</SelectItem><SelectItem value="DAY">Day</SelectItem><SelectItem value="NIGHT">Night</SelectItem></SelectContent>
              </Select>
              <Select value={lineFilter} onValueChange={setLineFilter}>
                <SelectTrigger className="w-full sm:w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All lines</SelectItem>
                  {sortedLines.map((l) => <SelectItem key={l.name} value={l.name}>{l.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={leaderFilter} onValueChange={setLeaderFilter}>
                <SelectTrigger className="w-full sm:w-44"><SelectValue placeholder="All leaders" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All leaders</SelectItem>
                  {leaders.map((l) => <SelectItem key={l.name} value={l.name}>{l.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {/* The scorecard belongs here: production runs the leaders, and this is
                  the screen where their lines, shifts and output already are. It used
                  to open from Quality, which only ever saw one third of the score. */}
              {leaderFilter !== "__all__" && (
                <Button variant="outline" size="sm" className="gap-1" onClick={() => setScorecardFor(leaderFilter)}>
                  <Medal className="h-4 w-4" /> Scorecard
                </Button>
              )}
            </div>
            <span className="text-xs text-muted-foreground whitespace-nowrap sm:ml-auto">
              {range.from === range.to ? format(parseISO(range.from), "dd MMM yyyy") : `${format(parseISO(range.from), "dd MMM")} → ${format(parseISO(range.to), "dd MMM yyyy")}`}
            </span>
          </div>
        </div>


        {/* Overall OEE Panel — excludes lines with no RAG Weekly target for the period (#9) */}
        {(() => {
          const scored = byLine.filter((l) => l.target > 0);
          const totalTarget = scored.reduce((a, l) => a + l.target, 0);
          const totalActual = scored.reduce((a, l) => a + l.actual, 0);
          const overall = totalTarget > 0 ? (totalActual / totalTarget) * 100 : 0;
          const excludedCount = byLine.length - scored.length;
          return (
            <Card>
              <CardContent className="p-6 flex items-center gap-6 flex-wrap">
                <CircularProgress value={overall} size={120} strokeWidth={10} sublabel="Overall" />
                <div className="flex-1 min-w-[200px]">
                  <div className="text-xs uppercase text-muted-foreground">Overall Performance</div>
                  <div className="text-2xl font-bold">{totalActual.toLocaleString("en-US")} / {totalTarget.toLocaleString("en-US")}</div>
                  <div className="text-sm text-muted-foreground">
                    {scored.length} {scored.length === 1 ? "line" : "lines"} scored · {sessions.length} sessions
                    {excludedCount > 0 && (
                      <span className="ml-1 text-amber-600 dark:text-amber-400">· {excludedCount} without RAG target excluded</span>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Badge className="bg-green-500/15 text-green-600 dark:text-green-400 border border-green-500/40">≥100% Green</Badge>
                  <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/40">≥80% Amber</Badge>
                  <Badge className="bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/40">&lt;80% Red</Badge>
                </div>
              </CardContent>
            </Card>
          );
        })()}

        {/* Open quality actions for the same period + shift + line. */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Open Quality Actions
              <Badge variant="outline" className="ml-1">{openActions.length}</Badge>
              <span className="ml-auto inline-flex items-center gap-1.5 text-2xs font-medium text-emerald-600 dark:text-emerald-400">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
                Live
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {openActions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No open quality actions in this period.</p>
            ) : (
              <div className="divide-y">
                {openActions.slice(0, 8).map((a) => (
                  <button key={a.id} type="button" onClick={() => navigate("/dashboard/quality")}
                    className="flex w-full items-center gap-3 py-1.5 text-left hover:bg-accent/40 rounded px-1">
                    <span className="font-mono text-xs text-muted-foreground w-14 shrink-0">{a.action_no ?? "—"}</span>
                    <span className="text-xs text-muted-foreground w-16 shrink-0">{format(new Date(a.recorded_at), "dd/MM")}{a.shift ? ` · ${a.shift === "DAY" ? "D" : "N"}` : ""}</span>
                    <span className="text-xs w-20 shrink-0 truncate">{a.line ?? "—"}</span>
                    {a.severity && <Badge variant="outline" className="text-2xs shrink-0">{a.severity}</Badge>}
                    <span className="text-sm truncate flex-1">{a.description ?? "—"}</span>
                  </button>
                ))}
                {openActions.length > 8 && (
                  <button type="button" onClick={() => navigate("/dashboard/quality")}
                    className="w-full py-2 text-center text-xs text-primary hover:underline">
                    View all {openActions.length} in Quality →
                  </button>
                )}
              </div>
            )}
          </CardContent>
        </Card>


        {/* Line status cards — gated behind the per-shift password */}
        <ShiftLock shifts={shift === "all" ? ["DAY", "NIGHT"] : [shift]}>
        {sortedByLine.length === 0 ? (
          <Card>
            <CardContent className="p-0">
              <EmptyState
                icon={BarChart3}
                title="No production data for this period"
                description="No line sessions match the current filters. Try adjusting the date range, shift or line filter."
              />
            </CardContent>
          </Card>
        ) : (
        <>
        {(() => {
          const missing = sortedByLine.filter((l) => l.notLogged);
          if (missing.length === 0) return null;
          return (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <b>{missing.length} {missing.length === 1 ? "line has" : "lines have"} a plan but no production logged for this shift.</b>{" "}
                {missing.map((l) => l.line).join(", ")} {missing.length === 1 ? "reads" : "read"} 0% because nothing was
                entered on My Production, not necessarily because nothing was made.
              </div>
            </div>
          );
        })()}

        {/* Leaders — the way into each leader's scorecard.
            It used to open only from the leader filter, so anyone who did not think
            to filter first never found it. The scorecard is the point of this
            screen's leader data; it should be one click from the names themselves. */}
        {leaderboard.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Medal className="h-4 w-4" /> Leaders
                <span className="text-xs font-normal text-muted-foreground">· click a name for the scorecard</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="divide-y">
                {leaderboard.map((l, i) => (
                  <button
                    key={l.leader}
                    type="button"
                    onClick={() => setScorecardFor(l.leader)}
                    className="flex w-full items-center justify-between gap-3 py-2 text-left text-sm transition-colors hover:bg-accent/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="w-6 shrink-0 text-xs text-muted-foreground">{medal(i) ?? i + 1}</span>
                      <span className="truncate font-medium">{l.leader}</span>
                      <span className="shrink-0 text-2xs text-muted-foreground">{l.sessions} session{l.sessions === 1 ? "" : "s"}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-3 tabular-nums">
                      <span className="text-muted-foreground">{l.actual.toLocaleString("en-GB")}</span>
                      {l.target > 0 ? (
                        <Badge variant="outline" className={l.eff >= 100
                          ? "border-emerald-500/40 bg-emerald-500/15 text-success-strong"
                          : l.eff >= 80
                            ? "border-amber-500/40 bg-amber-500/15 text-warning-strong"
                            : "border-red-500/40 bg-red-500/15 text-destructive-strong"}>
                          {l.eff.toFixed(0)}%
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground" title="No RAG plan for this leader's sessions">no plan</Badge>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {sortedByLine.map((l) => {

            // Industrial Andon panel — high-contrast dark, readable from across
            // the floor / on a line TV. Status colours: green on-target, amber
            // setup/near, red below-target (pulsing).
            const gap = l.actual - l.target;
            const status = l.eff >= 100 ? "ON TARGET" : l.eff >= 80 ? "SETUP" : "BELOW TARGET";
            // Theme-consistent panel (matches the rest of the app); status is
            // carried by a strong border + accent colours, numbers stay high
            // contrast in both light and dark.
            const ring = l.eff >= 100 ? "border-emerald-500" : l.eff >= 80 ? "border-amber-500" : "border-red-500";
            const chip = l.eff >= 100 ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30" : l.eff >= 80 ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30" : "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30";
            const effColor = l.eff >= 100 ? "text-emerald-600 dark:text-emerald-400" : l.eff >= 80 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400";
            const gapColor = gap >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400";
            const barColor = l.eff >= 100 ? "bg-emerald-500" : l.eff >= 80 ? "bg-amber-500" : "bg-red-500";
            const handleClick = () => navigate("/dashboard/shift-history");
            const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleClick();
              }
            };
            return (
              <div
                key={l.line}
                role="button"
                tabIndex={0}
                onClick={handleClick}
                onKeyDown={handleKeyDown}
                className={`cursor-pointer rounded-xl border-2 ${ring} bg-card p-4 shadow-sm transition-transform hover:scale-[1.01] focus:outline-none focus:ring-2 focus:ring-primary`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="text-xl font-black uppercase tracking-wide text-foreground truncate">{l.line}</div>
                  <span className={`shrink-0 rounded-full border px-2.5 py-1 text-2xs font-bold uppercase tracking-wider ${chip} ${l.eff < 80 ? "animate-pulse" : ""}`}>● {status}</span>
                </div>
                {l.notLogged && (
                  <div
                    className="mt-1 flex items-center gap-1.5 text-2xs font-semibold text-amber-700 dark:text-amber-400"
                    title="This line was planned to run but nothing was logged on My Production, so it reads 0%."
                  >
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Not logged on the line
                  </div>
                )}
                <div
                  className="mt-2"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                    <Select
                      value={l.leader ?? "__none__"}
                      disabled={savingLeaderFor === l.line}
                      onValueChange={(v) => {
                        if (v === "__new__") {
                          setAddingLeaderFor(l.line);
                          setNewLeaderName("");
                        } else {
                          setLeaderForLine(l.line, v === "__none__" ? null : v, l.hasSession);
                        }
                      }}
                    >
                      <SelectTrigger className="h-10 w-full text-xs bg-background/60">
                        <SelectValue placeholder="— Assign leader —" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— None —</SelectItem>
                        {/* Keep the assigned leader selectable even if deactivated/renamed. */}
                        {l.leader && !leaders.some((ld) => ld.name === l.leader) && (
                          <SelectItem value={l.leader}>{l.leader} (inactive)</SelectItem>
                        )}
                        {leaders.map((ld) => (
                          <SelectItem key={ld.name} value={ld.name}>{ld.name}</SelectItem>
                        ))}
                        <SelectItem value="__new__">+ Add new leader…</SelectItem>
                      </SelectContent>
                    </Select>
                    {addingLeaderFor === l.line && (
                      <div className="flex items-center gap-1 mt-1">
                        <Input
                          autoFocus
                          value={newLeaderName}
                          onChange={(e) => setNewLeaderName(e.target.value)}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === "Enter") addNewLeader(l.line, l.hasSession);
                            if (e.key === "Escape") { setAddingLeaderFor(null); setNewLeaderName(""); }
                          }}
                          placeholder="Leader name"
                          className="h-9 w-36 text-xs"
                        />
                        <Button
                          size="sm"
                          className="h-9 px-2 text-xs"
                          disabled={savingLeaderFor === l.line || !newLeaderName.trim()}
                          onClick={() => addNewLeader(l.line, l.hasSession)}
                        >
                          Add
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-9 px-2 text-xs"
                          onClick={() => { setAddingLeaderFor(null); setNewLeaderName(""); }}
                        >
                          Cancel
                        </Button>
                      </div>
                    )}
                  </div>
                <div className="mt-4 flex items-end justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-2xs font-bold uppercase tracking-wider text-muted-foreground">Actual</div>
                    <div className="font-mono text-4xl font-bold leading-none text-foreground tabular-nums">{l.actual.toLocaleString("en-US")}</div>
                    <div className="mt-1 text-xs text-muted-foreground tabular-nums">/ {l.target.toLocaleString("en-US")} target</div>
                  </div>
                  <div className={`text-right ${effColor}`}>
                    <div className="text-2xs font-bold uppercase tracking-wider text-muted-foreground">Perf</div>
                    <div className="font-mono text-3xl font-bold leading-none tabular-nums">{Math.round(l.eff)}%</div>
                  </div>
                </div>
                <div className="mt-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold uppercase tracking-wider text-muted-foreground">Gap</span>
                    <span className={`font-mono text-lg font-bold tabular-nums ${gapColor}`}>{gap >= 0 ? "+" : ""}{gap.toLocaleString("en-US")}</span>
                  </div>
                  <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div className={`h-full ${barColor}`} style={{ width: `${Math.min(100, Math.max(0, l.eff))}%` }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        </>
        )}
        </ShiftLock>
      </div>

      {/* Print preview — look before printing/downloading. */}
      <Dialog open={!!previewUrl} onOpenChange={(o) => { if (!o) setPreviewUrl(null); }}>
        <DialogContent className="max-w-4xl w-[95vw] h-[90vh] flex flex-col p-0 gap-0">
          <DialogHeader className="flex-row items-center justify-between gap-2 border-b px-4 py-3 space-y-0">
            <DialogTitle className="text-base">Report preview</DialogTitle>
            <div className="flex items-center gap-2 pr-6">
              <Button size="sm" variant="outline" onClick={downloadReport}><Download className="h-4 w-4 mr-1" />Download</Button>
              <Button size="sm" onClick={printInTab}><Printer className="h-4 w-4 mr-1" />Print</Button>
            </div>
          </DialogHeader>
          {previewUrl && (
            <iframe ref={previewFrame} src={previewUrl} title="Report preview" className="flex-1 w-full rounded-b-lg" />
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>

  );
}
