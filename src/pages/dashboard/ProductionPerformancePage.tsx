import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/DashboardLayout";
import { SectionErrorBoundary } from "@/components/SectionErrorBoundary";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusRail, type RailState } from "@/components/ui/StatusRail";
import { LeaderScorecard } from "@/components/LeaderScorecard";
import { LineIndicators } from "@/components/production/LineIndicators";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight, Medal, BarChart3, Printer, AlertTriangle, Download } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { generatePerformanceReportPDF } from "@/lib/performanceReport";
import { getCurrentFactoryShift, getCurrentShiftStart, shiftDateFetchRange, shiftSessionDate } from "@/lib/shifts";
import { classifyLive, formatStopDuration, LIVE_TONE, type LiveReading } from "@/lib/lineLiveStatus";
import { computePace, PACE_MESSAGES } from "@/lib/linePerformance";
import { EmptyState } from "@/components/EmptyState";
import { format, parseISO, addDays, subDays, addWeeks, addMonths, addQuarters, addYears, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfQuarter, endOfQuarter, startOfYear, endOfYear } from "date-fns";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, LineChart, Line } from "recharts";
import { CircularProgress } from "@/components/ui/circular-progress";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

type Period = "day" | "week" | "month" | "quarter" | "year" | "custom";

interface SessionAgg {
  id: string; session_date: string; shift: string; line: string;
  leader_name: string | null; locked: boolean;
  target: number; actual: number; eff: number;
  items: { sku_id: string; actual: number; started_at: string | null; finished_at: string | null }[];
}

type RagRowT = { entry_date: string; line: string; shift: string; plan_qty: number; actual_qty: number };

/**
 * Target and actual per line, from RAG where it exists and the floor's own sessions
 * where it does not.
 *
 * Lifted out of the component so the same arithmetic can be run over one shift's
 * rows as easily as over the period's. A report that summed both shifts printed one
 * row per line for work that happened on two, and a line that made target on days
 * and lost it on nights read as an average that happened on neither.
 */
function aggregateLines(sessions: SessionAgg[], ragRows: RagRowT[], leaderFilter: string) {

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

  /**
   * What iTouching says each line is doing right now.
   *
   * Read from `v_line_live_status`, not from `intouch_machine_map`: that table is
   * readable by four roles and this page by seven, so a supervisor — who lands
   * here — would otherwise get an empty pill on every card and no reason why.
   *
   * Deliberately independent of the period filters above. The pace is about the
   * shift being reported on; this is about the minute you are standing in, and a
   * line can be behind for the shift and running perfectly right now.
   */
  const { data: liveRows = [] } = useQuery({
    queryKey: ["line-live-status"],
    refetchInterval: 20_000,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the view is newer than the generated types
      const { data, error } = await (supabase as any)
        .from("v_line_live_status")
        .select("line, machine, status, reason, planned, seen_at, stop_since");
      if (error) throw error;
      return (data ?? []) as { line: string; machine: string | null; status: number | null; reason: string | null; planned: boolean | null; seen_at: string | null; stop_since: string | null }[];
    },
  });

  // The board's own second hand. The live read arrives every 20s; a stop counter
  // that jumped twenty seconds at a time would read as broken, and this is the one
  // number on the page that has to move to be believed.
  const [, setSecond] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSecond((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const liveByLine = useMemo(() => {
    const norm = (s: string | null | undefined) => String(s ?? "").trim().toLowerCase();
    const m = new Map<string, LiveReading>();
    for (const r of liveRows) {
      m.set(norm(r.line), {
        status: r.status,
        reason: r.reason,
        planned: r.planned,
        seenAt: r.seen_at ? new Date(r.seen_at) : null,
        stopSince: r.stop_since ? new Date(r.stop_since) : null,
      });
    }
    return m;
  }, [liveRows]);

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
      const rows: { id: string; code: string; name: string; target_per_hour: number | null }[] = [];
      for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await supabase.from("sku_products").select("id, code, name, target_per_hour").order("code").range(offset, offset + pageSize - 1);
        if (error) throw error;
        const page = (data ?? []) as { id: string; code: string; name: string; target_per_hour: number | null }[];
        rows.push(...page);
        if (page.length < pageSize) break;
      }
      return rows;
    },
  });
  const skuMap = useMemo(() => new Map(skus.map((s) => [s.id, s])), [skus]);

  type RagRow = { entry_date: string; line: string; shift: string; plan_qty: number; actual_qty: number };

  // Quality actions in the period — every status, so the report can list completed
  // ones with a Status column.
  //
  // Filtered by leader, never by line. An action belongs to whoever was leading the
  // shift: the same leader covers more than one line in a period, and the action's
  // own `line` is where it happened, not who answers for it. Filtering by line hid a
  // leader's actions the moment anyone narrowed the screen to a line.
  const { data: periodActions = [] } = useQuery({
    queryKey: ["perf-quality-actions", range.from, range.to, shift, leaderFilter],
    // Live feed: keep the panel current as actions are opened/closed elsewhere.
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const window = shiftDateFetchRange(range.from, range.to);
      let q = supabase.from("quality_actions")
        .select("id, action_no, recorded_at, line, shift, status, severity, description, leader_name")
        .gte("recorded_at", window.gte).lte("recorded_at", window.lte)
        .order("recorded_at", { ascending: false });
      if (shift !== "all") q = q.eq("shift", shift);
      if (leaderFilter !== "__all__") q = q.eq("leader_name", leaderFilter);
      const { data, error } = await q;
      if (error) throw error;
      return ((data ?? []) as any[]).filter((a) => {
        const day = shiftSessionDate(a.recorded_at, a.shift);
        return day >= range.from && day <= range.to;
      });
    },
  });

  const { data: queryResult } = useQuery<{ sessions: SessionAgg[]; ragRows: RagRow[] }>({
    queryKey: ["oee", range.from, range.to, shift, lineFilter, leaderFilter],
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      let q = supabase.from("production_sessions")
        .select("id, session_date, shift, line, leader_name, locked, production_items(sku_id, target_qty, planned_qty, actual_qty, started_at, finished_at)")
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

      const sessions: SessionAgg[] = (data ?? []).map((s: { id: string; session_date: string; shift: string; line: string; leader_name: string | null; locked: boolean; production_items: { sku_id: string; target_qty: number | null; planned_qty: number | null; actual_qty: number | null; started_at: string | null; finished_at: string | null }[] }) => {
        const items = s.production_items ?? [];
        const key = `${s.session_date}|${s.line}|${s.shift}`;
        const target = ragPlanMap.get(key) ?? 0;
        const itemsActual = items.reduce((a, i) => a + Number(i.actual_qty ?? 0), 0);
        const ragActual = ragActualMap.get(key) ?? 0;
        const actual = ragActual > 0 ? ragActual : itemsActual;
        return { id: s.id, session_date: s.session_date, shift: s.shift, line: s.line, leader_name: s.leader_name, locked: s.locked, target, actual, eff: target > 0 ? (actual / target) * 100 : 0, items: items.map((i) => ({ sku_id: i.sku_id, actual: Number(i.actual_qty ?? 0), started_at: i.started_at ?? null, finished_at: i.finished_at ?? null })) };
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
  const byLine = useMemo(
    () => aggregateLines(sessions, ragRows, leaderFilter),
    [sessions, ragRows, leaderFilter],
  );

  // The same figures, cut by shift, for a report that covers both.
  const byShift = useMemo(() => {
    const of = (sh: "DAY" | "NIGHT") => aggregateLines(
      sessions.filter((x) => (x.shift ?? "").toUpperCase() === sh),
      ragRows.filter((r) => (r.shift ?? "").toUpperCase() === sh),
      leaderFilter,
    );
    return { DAY: of("DAY"), NIGHT: of("NIGHT") };
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

  /**
   * Where each line SHOULD be by now, which is only a question worth asking about
   * the shift currently running.
   *
   * "Expected so far" over a week is meaningless — the week is over, the whole
   * plan was the target — so the mark on the scale appears for the running shift
   * and for nothing else. A board that draws it anyway is inventing precision.
   */
  const isCurrentShiftView = useMemo(() => {
    const cur = getCurrentFactoryShift();
    return (
      period === "day" &&
      range.from === range.to &&
      range.from === cur.sessionDate &&
      shift === (cur.shiftCode === "night" ? "NIGHT" : "DAY")
    );
  }, [period, range.from, range.to, shift]);

  const paceByLine = useMemo(() => {
    const out = new Map<string, ReturnType<typeof computePace>>();
    if (!isCurrentShiftView) return out;
    const now = new Date();
    const shiftStart = getCurrentShiftStart(now);
    const byLineSessions = new Map<string, SessionAgg[]>();
    for (const s of sessions) {
      const arr = byLineSessions.get(s.line) ?? [];
      arr.push(s);
      byLineSessions.set(s.line, arr);
    }
    for (const [line, ss] of byLineSessions) {
      const items = ss.flatMap((s) => s.items).map((i) => ({
        ratePerHour: skuMap.get(i.sku_id)?.target_per_hour ?? null,
        produced: i.actual,
        startedAt: i.started_at ? new Date(i.started_at) : null,
        finishedAt: i.finished_at ? new Date(i.finished_at) : null,
      }));
      out.set(line, computePace({
        items,
        shiftStart,
        now,
        hasSession: true,
        hasLeader: ss.some((s) => !!s.leader_name),
      }));
    }
    return out;
  }, [isCurrentShiftView, sessions, skuMap]);

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
      // Split only when the screen is not already filtered to one shift: asking for
      // Nights and being handed a Days table too would be answering a question
      // nobody asked.
      sections: shift !== "all" ? undefined : (["DAY", "NIGHT"] as const)
        .map((sh) => {
          const rows = [...byShift[sh]]
            .sort((a, b) => lineRank(a.line) - lineRank(b.line) || a.line.localeCompare(b.line))
            .filter((l) => l.target > 0);
          return {
            label: sh === "DAY" ? "Day shift  (06–18)" : "Night shift  (18–06)",
            lines: rows.map((l) => ({ line: l.line, leader: l.leader, target: l.target, actual: l.actual, eff: l.eff })),
            totalTarget: rows.reduce((a, l) => a + l.target, 0),
            totalActual: rows.reduce((a, l) => a + l.actual, 0),
          };
        })
        .filter((sec) => sec.lines.length > 0),
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

        <SectionErrorBoundary title="Leader scorecard">
        <LeaderScorecard
          leaderName={scorecardFor}
          from={range.from}
          to={range.to}
          shift={shift}
          onClose={() => setScorecardFor(null)}
        />
        </SectionErrorBoundary>

        <div className="space-y-3">
          <PageHeader
            module="Production"
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
                      <span className="ml-1 text-warning-strong">· {excludedCount} without RAG target excluded</span>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Badge className="bg-success/15 text-success-strong border border-success/40">≥100% Green</Badge>
                  <Badge className="bg-warning/15 text-warning-strong border border-warning/40">≥80% Amber</Badge>
                  <Badge className="bg-destructive/15 text-destructive-strong border border-destructive/40">&lt;80% Red</Badge>
                </div>
              </CardContent>
            </Card>
          );
        })()}

        {/* Line status cards. No longer behind a per-shift password: the page is
            already reachable only by roles that hold production.performance.view,
            and a second password on top of the login asked the same question twice
            — while locking out the admin who set it. */}
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
            <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning-strong">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <b>{missing.length} {missing.length === 1 ? "line has" : "lines have"} a plan but no production logged for this shift.</b>{" "}
                {missing.map((l) => l.line).join(", ")} {missing.length === 1 ? "reads" : "read"} 0% because nothing was
                entered on My Production, not necessarily because nothing was made.
              </div>
            </div>
          );
        })()}

        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {sortedByLine.map((l) => {

            // Industrial Andon panel — high-contrast dark, readable from across
            // the floor / on a line TV. Status colours: green on-target, amber
            // setup/near, red below-target (pulsing).
            const gap = l.actual - l.target;
            const status = (() => {
              const p = paceByLine.get(l.line);
              if (p && p.kind !== "PACE") return "No reading";
              const v = p?.kind === "PACE" ? p.pct : l.eff;
              if (p?.kind === "PACE") return v >= 95 ? "On pace" : v >= 75 ? "Behind" : "Critical";
              return v >= 100 ? "On target" : v >= 80 ? "Setup" : "Below target";
            })();
            // O estado vem da barra, uma vez.
            //
            // Estava dito cinco vezes no mesmo cartão — borda de 2 px a toda a volta,
            // um chip cheio, a eficiência colorida, o desvio colorido e a barra — e a
            // pulsar quando abaixo do alvo. Com nove linhas no ecrã isso é nove cartões
            // contornados a verde, âmbar e vermelho, com um a piscar em permanência: o
            // olho não pousa em lado nenhum e os números, que são o que o ecrã existe
            // para mostrar, ficam a competir com a própria moldura.
            //
            // Ficam dois portadores, e cada um faz um trabalho diferente: a barra diz
            // QUE estado é, de relance e de longe; a cor no número diz QUANTO, no sítio
            // onde já se está a ler. O `animate-pulse` sai — num painel, o que pisca
            // não se pode ignorar nem quando já foi visto, e não respeita quem pediu
            // menos movimento.
            // For the shift that is running, the verdict is the PACE — measured
            // against the time already worked. For a week or a month it stays the
            // plain comparison against the plan, which is the right question once
            // the period is over. 95/75 are the thresholds already on the floor.
            const pace = paceByLine.get(l.line);
            const score = pace?.kind === "PACE" ? pace.pct : l.eff;
            const scored = pace ? pace.kind === "PACE" : true;
            const railState: RailState = !scored ? "idle" : score >= 95 ? "go" : score >= 75 ? "hold" : "stop";
            const effColor = !scored
              ? "text-muted-foreground"
              : score >= 95 ? "text-success-strong" : score >= 75 ? "text-warning-strong" : "text-destructive-strong";
            const handleClick = () => navigate("/dashboard/shift-history");
            const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleClick();
              }
            };
            return (
              <StatusRail
                key={l.line}
                state={railState}
                role="button"
                tabIndex={0}
                onClick={handleClick}
                onKeyDown={handleKeyDown}
                className="cursor-pointer transition-colors hover:border-primary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-display text-xl font-bold uppercase tracking-[0.02em] text-foreground">{l.line}</div>
                    {/* O nome da máquina no iTouching, que é como a manutenção lhe
                        chama. Duas casas para a mesma linha só é confusão enquanto
                        uma delas estiver escondida. */}
                    {(() => {
                      const machine = liveRows.find((r) => r.line?.trim().toLowerCase() === l.line.trim().toLowerCase())?.machine;
                      return machine && machine.trim().toLowerCase() !== l.line.trim().toLowerCase() ? (
                        <div className="truncate text-2xs text-muted-foreground">{machine}</div>
                      ) : null;
                    })()}
                  </div>
                  {/* A etiqueta nomeia o estado; a barra ao lado é que o colore. Pintá-la
                      também seria dizer a mesma coisa duas vezes a três centímetros de
                      distância, e deixaria a percentagem sem ser a única coisa colorida
                      dentro do cartão — que é onde o olho deve pousar. Dito por extenso,
                      o estado também sobrevive a quem não distingue as três cores. */}
                  <span className="shrink-0 font-display text-2xs font-bold uppercase tracking-[0.1em] text-muted-foreground">{status}</span>
                </div>
                {/* Não repetido. Quando o ritmo já diz "no order" ou "nobody logged
                    in", este aviso é a mesma frase a dois centímetros da outra. */}
                {l.notLogged && (!pace || pace.kind === "PACE") && (
                  <div
                    className="mt-1 flex items-center gap-1.5 text-2xs font-semibold text-warning-strong"
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
                      <SelectTrigger className="h-8 w-full border-transparent bg-muted/50 text-xs hover:border-border focus:border-border">
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
                {/* What the line is doing RIGHT NOW, which is a different question
                    from how the shift has gone and is allowed to disagree with it:
                    a line can be behind on the shift because of a breakdown this
                    morning and be running perfectly at this minute. */}
                {(() => {
                  const live = classifyLive(liveByLine.get(l.line.trim().toLowerCase()), new Date());
                  return (
                    <div
                      className={`mt-2 flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 ${LIVE_TONE[live.state]}`}
                      title={
                        live.ageSeconds == null
                          ? "iTouching has never reported this machine"
                          : `iTouching, read ${live.ageSeconds}s ago${live.rawStatus != null ? ` · status ${live.rawStatus}` : ""}`
                      }
                    >
                      {/* Verbatim, and NOT uppercased. The stop reason is the name
                          iTouching itself holds for that code — "Deep Clean", "No
                          Planned Shift", "Electrical Stop" — and the person reading
                          this board reads the same words on the iTouching screen.
                          Case-shifting it here makes it a second name for the same
                          thing, which is exactly what a shared vocabulary is not. */}
                      <span className="truncate font-display text-2xs font-bold tracking-[0.1em]">
                        ● {live.label}
                      </span>
                      {/* How long the line has been in this stop, in iTouching's own
                          H:MM:SS, so the two screens can be read side by side without
                          anyone converting anything. It counts on the board's clock,
                          not on the poll's, because a stop counter that only moved
                          every twenty seconds would read as broken.

                          When there is no stop to time, the reading's own age takes
                          the slot — a state nobody has confirmed for ten minutes is
                          not a state. */}
                      {(() => {
                        const stopFor = formatStopDuration(live.stoppedForSeconds);
                        if (stopFor) {
                          return (
                            <span className="shrink-0 font-figure text-2xs font-bold" title="How long this stop has been running, as first seen by the poll">
                              {stopFor}
                            </span>
                          );
                        }
                        if (live.ageSeconds == null) return null;
                        return (
                          <span className="shrink-0 font-figure text-2xs opacity-70">
                            {live.ageSeconds < 90 ? `${live.ageSeconds}s` : `${Math.floor(live.ageSeconds / 60)}m`}
                          </span>
                        );
                      })()}
                    </div>
                  );
                })()}
                {(() => {
                  const paced = pace?.kind === "PACE" ? pace : null;
                  // Where the line should be by now, as a share of the shift's plan.
                  // This is the only new number on the card and it is the one the
                  // board was missing: without it, five hours into twelve, every
                  // line is compared against seven hours nobody has worked yet.
                  const tickPct = paced && l.target > 0
                    ? Math.min(100, Math.max(0, (paced.expected / l.target) * 100))
                    : null;
                  const donePct = l.target > 0 ? Math.min(100, Math.max(0, (l.actual / l.target) * 100)) : 0;
                  return (
                    <>
                      <div className="mt-4 flex items-end justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-2xs font-bold uppercase tracking-[0.12em] text-muted-foreground">Made</div>
                          <div className="font-figure text-[2.5rem] font-bold leading-none text-foreground">
                            {l.actual.toLocaleString("en-US")}
                          </div>
                          <div className="mt-1 font-figure text-xs text-muted-foreground">
                            {paced
                              ? `${Math.round(paced.expected).toLocaleString("en-US")} due by now`
                              : `${l.target.toLocaleString("en-US")} planned`}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-2xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
                            {paced ? "Pace" : "Of plan"}
                          </div>
                          {/* The one figure that carries colour. The rail says WHICH
                              state from across the room; this says HOW MUCH where the
                              eye has already landed. Everything else on the card is
                              foreground or muted — four colour carriers on one card is
                              how a board teaches people to stop looking at it. */}
                          <div className={`font-figure text-3xl font-bold leading-none ${effColor}`}>
                            {Math.round(paced ? paced.pct : l.eff)}%
                          </div>
                        </div>
                      </div>

                      {/* The scale. The fill is what the line has made; the notch is
                          where it should be. The distance between them IS the report,
                          and no other screen in this app draws it. */}
                      <div className="mt-3.5">
                        <div className="relative h-2.5 w-full overflow-hidden rounded-sm bg-muted">
                          <div className="h-full bg-foreground/25" style={{ width: `${donePct}%` }} />
                          {tickPct != null && (
                            <div
                              className="absolute inset-y-0 w-px bg-foreground"
                              style={{ left: `${tickPct}%` }}
                              aria-hidden
                            />
                          )}
                        </div>
                        <div className="mt-1.5 flex items-baseline justify-between font-figure text-2xs text-muted-foreground">
                          <span>
                            {paced ? (
                              <>
                                {gap >= 0 ? "+" : ""}{Math.round(paced.produced - paced.expected).toLocaleString("en-US")} vs due
                              </>
                            ) : (
                              <>{gap >= 0 ? "+" : ""}{gap.toLocaleString("en-US")} vs plan</>
                            )}
                          </span>
                          <span className="text-muted-foreground/70">{l.target.toLocaleString("en-US")}</span>
                        </div>
                      </div>

                      {/* Said once, at the bottom, in words. A line with no order and
                          a line that made nothing are different facts and the card
                          must not round them both to 0%. */}
                      {pace && pace.kind !== "PACE" && (
                        <div className="mt-2 font-display text-2xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
                          {PACE_MESSAGES[pace.kind]}
                        </div>
                      )}
                    </>
                  );
                })()}
              </StatusRail>
            );
          })}
        </div>
        {/* Below the lines, not above them.
            It is a key and a gap report — what the colours mean and which lines have
            no data — and both are read after the boards, not before. Above them it
            pushed the thing the screen exists for below the fold. */}
        <LineIndicators
          lines={sortedByLine.map((l) => ({ line: l.line, target: l.target, actual: l.actual, eff: l.eff }))}
          from={range.from}
          to={range.to}
          shift={shift === "all" ? "ALL" : shift}
          leader={leaderFilter === "__all__" ? null : leaderFilter}
        />
        </>
        )}
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
