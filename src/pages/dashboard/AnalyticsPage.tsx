import { useState, useMemo } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { PageHeader } from "@/components/ui/PageHeader";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ClipboardList, LayoutDashboard, Users, Timer, Activity, Package, BarChart3, Trophy, Award, TrendingUp, TrendingDown, Printer, FileText, ArrowUp, ArrowDown, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWorkOrders } from "@/hooks/useWorkOrders";
import { useMachines, useLines } from "@/hooks/useMachines";
import { useEngineerScores } from "@/hooks/useEngineerScores";
import { useAllWoMetrics } from "@/hooks/useWoMetrics";
import { useMaintenanceKpis } from "@/hooks/useMaintenanceKpis";
import { differenceInMinutes, format, subDays, startOfDay, endOfDay } from "date-fns";
import { useDowntime } from "@/hooks/useDowntime";
import { reconcileMinutes } from "@/lib/downtimeReconcile";
import { formatMTBF } from "@/lib/formatDuration";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, LabelList } from "recharts";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMinutes } from "@/lib/formatDuration";
import { DateRangePreset, DateRange, getPresetRange } from "@/components/DateRangeFilter";
import { type ShiftValue } from "@/components/ShiftFilter";
import { Link } from "react-router-dom";
import { SLA_TARGETS } from "@/lib/sla";
import { resolveLine } from "@/lib/resolveLine";
import { ReportsFilterBar } from "@/components/reports/ReportsFilterBar";
import { KpiCard } from "@/components/reports/KpiCard";
import { QUALITY_STATUSES, actionPoints, isValidatedPaperwork } from "@/lib/qualityConstants";
import { rowMatchesShift } from "@/lib/shifts";
import { woStatusCounts, DONE_STATUSES } from "@/lib/woStatusCounts";
import { useLeaderAttribution } from "@/hooks/useLabelAttribution";
import { PointsPending } from "@/components/quality/PointsPending";
import { computeLeaderScore, displayScore, rankLeadersByScore, DEFAULT_WEIGHTS } from "@/lib/leaderScore";
import { canPrintReport } from "@/lib/permissions";
import { useLeaderScoreWeights } from "@/hooks/useLeaderScoreWeights";
import { ReportPrintHeader } from "@/components/reports/ReportPrintHeader";
import { printElementAsDocument } from "@/lib/printDocument";
import { EmptyState } from "@/components/EmptyState";
import { useOpsShift, OPS_RANGE_KEY } from "@/hooks/useOpsFilters";
import { resolveReportRange, reportPeriodLabel } from "@/lib/reportRange";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { selectOptionalDomain } from "@/lib/optionalDomain";

const COLORS = ["hsl(var(--primary))", "hsl(var(--accent))", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#10b981", "#6b7280"];

const truncLabel = (s: string, max = 20) => s.length > max ? s.slice(0, max - 1) + "…" : s;

/** Sortable columns of the Leader Performance table. */
type LeaderSortKey = "leader" | "sessions" | "lines" | "shifts" | "actual" | "target" | "eff" | "openActions" | "score" | "docErrors";
/** These sort A→Z on first click; the numeric ones sort high→low. */
const LEADER_TEXT_KEYS: LeaderSortKey[] = ["leader", "shifts"];

/** Sortable header cell for the Leader Performance table. */
function LeaderTh({
  sortKey, sort, onSort, align = "right", title, children,
}: {
  sortKey: LeaderSortKey;
  sort: { key: LeaderSortKey; dir: "asc" | "desc" };
  onSort: (key: LeaderSortKey) => void;
  align?: "left" | "right";
  /** What the column counts, for the columns whose name does not say it in full. */
  title?: string;
  children: React.ReactNode;
}) {
  const activeSort = sort.key === sortKey;
  const Icon = !activeSort ? ChevronsUpDown : sort.dir === "desc" ? ArrowDown : ArrowUp;
  return (
    <th title={title} className={`p-0 ${align === "left" ? "text-left" : "text-right"}`}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        aria-label={`Sort by ${String(children)}`}
        className={`flex w-full items-center gap-1 p-2 uppercase transition-colors hover:text-foreground ${align === "left" ? "justify-start" : "justify-end"} ${activeSort ? "text-foreground" : ""}`}
      >
        {children}
        <Icon className={`h-3 w-3 shrink-0 ${activeSort ? "opacity-100" : "opacity-40"}`} aria-hidden="true" />
      </button>
    </th>
  );
}

/** Show minutes as "N min" under 60, else "Xh Ym". */
const fmtMin = (m: number | null | undefined) => {
  if (m === null || m === undefined || Number.isNaN(Number(m))) return "—";
  const minutes = Math.max(0, Math.round(Number(m)));
  return minutes >= 60 ? formatMinutes(minutes) : `${minutes} min`;
};

/**
 * Which London shift a timestamp falls in. Day is 06:00–17:59, night is the rest.
 * Same rule useMaintenanceKpis applies, so a shift-filtered KPI and a shift-filtered
 * chart on this page can never disagree about where a record belongs.
 */
function londonShiftOf(iso: string | null | undefined): "DAY" | "NIGHT" | null {
  if (!iso) return null;
  try {
    const h = parseInt(
      new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hour12: false })
        .format(new Date(iso)),
      10,
    );
    if (Number.isNaN(h)) return null;
    return h >= 6 && h < 18 ? "DAY" : "NIGHT";
  } catch {
    return null;
  }
}

const EmptyChart = () => (
  <EmptyState
    icon={BarChart3}
    title="No data available"
    description="No records match the selected filters."
    className="py-8"
  />
);


export default function AnalyticsPage() {
  const { role } = useAuth();
  const { excluded, ready: attributionReady } = useLeaderAttribution();
  const { toast } = useToast();
  const [drPreset, setDrPreset] = useState<DateRangePreset>("30d");
  const [drRange, setDrRange] = useState<DateRange>(() => getPresetRange("30d"));
  const [shift, setShift] = useOpsShift();
  // "All time" is an open range — getPresetRange("all") returns {} on purpose. This
  // line used to read `drRange.from ?? subDays(new Date(), 30)`, so the chip said
  // "All time" and every figure below it was the last thirty days, with nothing on
  // screen to say so. The period is now whatever was asked for, and the report header
  // prints "All time" rather than the sentinel the queries actually use.
  const period = useMemo(() => resolveReportRange(drRange), [drRange]);
  const { startDate, endDate } = period;

  /**
   * Leader Performance ranks people over this range, so it is scored on the weights in
   * force at the end of it — the same date the scorecard behind each row resolves on.
   * Declared here rather than at the top of the component because it needs `endDate`.
   */
  const { data: weights = DEFAULT_WEIGHTS } = useLeaderScoreWeights(format(endDate, "yyyy-MM-dd"));

  // Range pushed server-side: without it the hook caps at the 200 newest orders
  // and every widget below silently reported on a truncated set.
  const { data: rawWOs, isLoading: woLoading } = useWorkOrders({ from: startDate, to: endDate });
  const { data: machines, isLoading: machinesLoading } = useMachines();
  const { data: linesData } = useLines();
  // The stored scores are no longer what ranks anybody — the ranking is computed
  // from the period below. Kept only for its loading flag, which still gates the
  // page spinner alongside the other queries.
  const { isLoading: scoresLoading } = useEngineerScores();
  const { data: woMetricsRange, isLoading: metricsLoading } = useAllWoMetrics({ from: startDate, to: endDate });

  // Quality actions in the selected date range → Quality Analytics section.
  const { data: qaRows = [] } = useQuery({
    queryKey: ["analytics-quality", startDate.toISOString(), endDate.toISOString()],
    // Paged. PostgREST caps a select at 1000 rows and reports nothing — the request
    // succeeds and the rest of the period is simply absent, which on this page reads
    // as "quality got quieter" rather than "the page stopped counting".
    queryFn: () => fetchAllRows<{ recorded_at: string; status: string | null; severity: string | null; line: string | null; department: string | null; shift: string | null }>({
      range: (a, b) => supabase
        .from("quality_actions")
        .select("recorded_at, status, severity, line, department, shift")
        .gte("recorded_at", startDate.toISOString())
        .lte("recorded_at", endDate.toISOString())
        .order("recorded_at", { ascending: true }).order("id", { ascending: true })
        .range(a, b),
    }),
  });

  const qa = useMemo(() => {
    // Filtered on the action's own shift column, not on the hour it was written at.
    // Guessing from `recorded_at` filed a night action typed up at 07:00 under DAY
    // here while the scorecard, which reads the column, called it NIGHT.
    const rows = qaRows.filter((r) => rowMatchesShift(r.shift, shift));
    const byStatus: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    const byLine: Record<string, number> = {};
    const byDept: Record<string, number> = {};
    const byDay: Record<string, number> = {};
    for (const r of rows) {
      byStatus[r.status || "unknown"] = (byStatus[r.status || "unknown"] || 0) + 1;
      if (r.severity) bySeverity[r.severity] = (bySeverity[r.severity] || 0) + 1;
      byLine[r.line || "—"] = (byLine[r.line || "—"] || 0) + 1;
      byDept[r.department || "—"] = (byDept[r.department || "—"] || 0) + 1;
      const day = (r.recorded_at || "").slice(0, 10);
      if (day) byDay[day] = (byDay[day] || 0) + 1;
    }
    const total = rows.length;
    const sevOrder = ["low", "medium", "high", "critical"];
    return {
      total,
      open: (byStatus["todo"] || 0) + (byStatus["in_progress"] || 0),
      completed: byStatus["complete"] || 0,
      critical: (bySeverity["high"] || 0) + (bySeverity["critical"] || 0),
      statusData: QUALITY_STATUSES.map((s) => ({ name: s.label, value: byStatus[s.value] || 0, color: s.color })),
      severityData: sevOrder.filter((s) => bySeverity[s]).map((s) => ({ name: s.charAt(0).toUpperCase() + s.slice(1), value: bySeverity[s] })),
      lineData: Object.entries(byLine).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, value]) => ({ name, value })),
      deptData: Object.entries(byDept).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, value]) => ({ name, value })),
      trendData: Object.entries(byDay).sort((a, b) => a[0].localeCompare(b[0])).map(([day, value]) => ({ name: format(new Date(day), "dd/MM"), value })),
    };
  }, [qaRows, shift]);

  // Production leader performance in range → Leader Performance section.
  const { data: leaderRows = [] } = useQuery({
    queryKey: ["analytics-leader-perf", startDate.toISOString(), endDate.toISOString(), shift],
    // Paged: ~120 sessions a month, so a long period clears the thousand-row cap and
    // every leader's output would quietly stop at whatever the first page held.
    queryFn: () => {
      const from = format(startDate, "yyyy-MM-dd");
      const to = format(endDate, "yyyy-MM-dd");
      return fetchAllRows<{
        session_date: string; shift: string | null; line: string | null; leader_name: string | null;
        production_items: { actual_qty: number | null }[];
      }>({
        range: (a, b) => {
          // production_sessions carries a real shift column, so this filters server-side
          // rather than inferring the shift from a timestamp.
          let q = supabase
            .from("production_sessions")
            .select("session_date, shift, line, leader_name, production_items(actual_qty)")
            .gte("session_date", from)
            .lte("session_date", to);
          if (shift !== "ALL") q = q.eq("shift", shift);
          return q.order("session_date", { ascending: true }).order("id", { ascending: true }).range(a, b);
        },
      });
    },
  });

  // Official target lives in the RAG Weekly plan (rag_weekly_entries.plan_qty),
  // per line+date+shift — NOT on production_items. Pull it for the same range so
  // every leader's target is populated, not just the odd session that happened
  // to carry a target_qty.
  const { data: ragTargetRows = [] } = useQuery({
    queryKey: ["analytics-leader-rag-targets", startDate.toISOString(), endDate.toISOString(), shift],
    // Paged, and for the sharper reason: the targets outnumber the sessions (~160 a
    // month against ~120). A truncated target set does not lose a row, it divides a
    // full period's output by a partial period's plan and prints the result as
    // efficiency — every leader reading well above what they ran.
    queryFn: () => {
      const from = format(startDate, "yyyy-MM-dd");
      const to = format(endDate, "yyyy-MM-dd");
      return fetchAllRows<{ entry_date: string; shift: string | null; line: string | null; plan_qty: number | null }>({
        range: (a, b) => {
          // Targets must be filtered the same way as the sessions, or efficiency would
          // divide one shift's output by both shifts' target.
          let q = (supabase as any)
            .from("rag_weekly_entries")
            .select("entry_date, shift, line, plan_qty")
            .gte("entry_date", from)
            .lte("entry_date", to);
          if (shift !== "ALL") q = q.eq("shift", shift);
          return q.order("entry_date", { ascending: true }).order("id", { ascending: true }).range(a, b);
        },
      });
    },
  });

  /**
   * Quality actions raised inside the page's period, per leader.
   *
   * One query feeds all three action figures of the card — the score's Quality and
   * Documentation halves, the doc-error breakdown, and the Open Actions column — so
   * they cannot disagree with each other or with the period the header prints.
   *
   * The open count used to come from a second query with no date bounds at all, on
   * the argument that "open" is a statement about today rather than about the period.
   * On a single production day it put 2 actions and 3 points against Ailton that had
   * been raised on 27 and 29 July, beside a Sessions column reading 1 — while his own
   * scorecard, which has always bounded actions by the period, showed none. The
   * backlog older than the period is a real question, and the Quality board is where
   * it is answered; a leader's card for a day cannot answer it without saying that the
   * numbers on it come from different months.
   */
  const { data: allPeriodActionRows = [] } = useQuery({
    queryKey: ["analytics-leader-period-actions", startDate.toISOString(), endDate.toISOString()],
    // Paged: this feeds the Quality and Documentation halves of every leader's score,
    // and a score computed off a partial set is a score that cannot be argued with.
    queryFn: () => fetchAllRows<{
      leader_name: string | null; severity: string | null; status: string | null;
      labels: string[] | null; validation_status: string | null;
      description: string | null; shift: string | null;
      /** 'quality' | 'safety' | undefined — see `actionPoints`. Without it here, a
       *  safety row prices like a quality one in this card's Quality/Documentation
       *  halves and its Open Actions column. */
      domain: string | null;
    }>({
      // `domain` is newer than the generated Postgrest types, hence the cast — see
      // `actionPoints()` for why the column has to be here at all.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- column newer than the generated types
      // Per page, not once: each `range` call is its own query, so each has to be able
      // to fall back on a base where `domain` has not been migrated yet — see
      // selectOptionalDomain.
      range: (a, b) => selectOptionalDomain(
        "leader_name, severity, status, labels, validation_status, recorded_at, description, shift, domain",
        (columns) => (supabase as any)
          .from("quality_actions")
          .select(columns)
          .gte("recorded_at", startDate.toISOString())
          .lte("recorded_at", endDate.toISOString())
          .order("recorded_at", { ascending: true }).order("id", { ascending: true })
          .range(a, b),
      ),
    }),
  });

  /**
   * The same rows, cut to the selected shift.
   *
   * This feeds the Quality and Documentation halves of every leader's score and the
   * documentation panel below. It used to feed them the whole period whatever the
   * filter said, while the production half beside it filtered server-side — so NIGHT
   * gave a leader their night's output against a month of everybody's quality points,
   * and the score mixed the two without saying so.
   *
   * Cut here rather than in the query on purpose: the fetch is paged for correctness
   * and the rows are already in hand, so switching shift re-cuts what is cached
   * instead of going back to the database for it.
   */
  const periodActionRows = useMemo(
    () => allPeriodActionRows.filter((a) => rowMatchesShift(a.shift, shift)),
    [allPeriodActionRows, shift],
  );

  const leaderPerf = useMemo(() => {
    const normLine = (v: string | null | undefined) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, "");
    const key = (date: string, shift: string | null, line: string | null) =>
      `${date}|${String(shift ?? "").trim().toUpperCase()}|${normLine(line)}`;
    // Sum plan_qty per (date, shift, line) — matches useLineShiftTarget's read.
    const ragMap = new Map<string, number>();
    for (const r of ragTargetRows) {
      const k = key(r.entry_date, r.shift, r.line);
      ragMap.set(k, (ragMap.get(k) ?? 0) + Number(r.plan_qty ?? 0));
    }
    type Agg = { leader: string; sessions: number; target: number; actual: number; lines: Set<string>; shifts: Set<string> };
    const map = new Map<string, Agg>();
    for (const s of leaderRows) {
      const leader = (s.leader_name || "").trim();
      if (!leader) continue;
      const cur = map.get(leader) ?? { leader, sessions: 0, target: 0, actual: 0, lines: new Set<string>(), shifts: new Set<string>() };
      cur.sessions += 1;
      if (s.line) cur.lines.add(s.line);
      if (s.shift) cur.shifts.add(s.shift);
      // One RAG target per session (line+date+shift), not per production item.
      cur.target += ragMap.get(key(s.session_date, s.shift, s.line)) ?? 0;
      for (const i of s.production_items ?? []) {
        cur.actual += Number(i.actual_qty ?? 0);
      }
      map.set(leader, cur);
    }
    // Open quality actions per leader, matched on the same trimmed name — counted off
    // the period's rows, so an action raised outside it is outside every column here.
    //
    // Two separate questions, kept separate on purpose. The status filter below is
    // THIS screen's, and answers "what is still on the board" — it is not part of what
    // an action is worth, so it stays here in the open rather than moving into
    // `actionPoints`. What an action is worth is `actionPoints`, and that is not this
    // screen's to decide.
    const openMap = new Map<string, { open: number; points: number; critical: number }>();
    for (const a of periodActionRows) {
      // The screen's own question: still on the working board.
      if (a.status !== "todo" && a.status !== "in_progress") continue;
      const leader = (a.leader_name || "").trim();
      if (!leader) continue;
      const cur = openMap.get(leader) ?? { open: 0, points: 0, critical: 0 };
      cur.open += 1;
      // The shared answer: rejected and not-theirs cost nothing, here as everywhere.
      cur.points += actionPoints(a, excluded);
      if (a.severity === "high" || a.severity === "critical") cur.critical += 1;
      openMap.set(leader, cur);
    }

    // Actions in the period, per leader — for the score's Quality and Documentation parts.
    const periodMap = new Map<string, Array<{ severity: string | null; labels: string[] | null; validation_status: string | null }>>();
    for (const a of periodActionRows) {
      const leader = (a.leader_name || "").trim();
      if (!leader) continue;
      periodMap.set(leader, [...(periodMap.get(leader) ?? []), a]);
    }

    const rows = Array.from(map.values())
      .map((a) => {
        const oa = openMap.get(a.leader);
        const acts = periodMap.get(a.leader) ?? [];
        const score = computeLeaderScore(
          { actual: a.actual, target: a.target, avgOEE: null, actions: acts, excludedLabels: excluded },
          weights,
        );
        return {
          leader: a.leader, sessions: a.sessions, target: a.target, actual: a.actual,
          score: score.final,
          docErrors: acts.filter(isValidatedPaperwork).length,
          // null (not 0) when there's no RAG plan for any of this leader's sessions —
          // "no target" is not the same as "0% efficiency" and must not rank as such.
          eff: a.target > 0 ? (a.actual / a.target) * 100 : null,
          lines: a.lines.size, shifts: Array.from(a.shifts).sort().join("/"),
          openActions: oa?.open ?? 0, openPoints: oa?.points ?? 0, openCritical: oa?.critical ?? 0,
        };
      });
    const totalActual = rows.reduce((s, r) => s + r.actual, 0);
    const totalTarget = rows.reduce((s, r) => s + r.target, 0);
    return {
      rows, totalActual, totalTarget,
      avgEff: totalTarget > 0 ? (totalActual / totalTarget) * 100 : 0,
      totalOpenActions: rows.reduce((s, r) => s + r.openActions, 0),
      totalOpenPoints: rows.reduce((s, r) => s + r.openPoints, 0),
    };
  }, [leaderRows, ragTargetRows, periodActionRows, weights, excluded]);

  /**
   * Where the documentation errors are coming from: the five commonest descriptions
   * and the day/night split, both counting validated paperwork only.
   *
   * A leader's score says who lost points; this says what to fix. Counting anything
   * other than validated actions would make it a list of accusations.
   */
  const docErrorSummary = useMemo(() => {
    const validated = periodActionRows.filter(isValidatedPaperwork);
    const byText = new Map<string, number>();
    for (const a of validated) {
      const k = ((a as { description?: string | null }).description || "Not described").trim().slice(0, 80);
      byText.set(k, (byText.get(k) ?? 0) + 1);
    }
    const top = Array.from(byText.entries())
      .map(([text, count]) => ({ text, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
    const byShift = { DAY: 0, NIGHT: 0, unknown: 0 };
    for (const a of validated) {
      const sh = String((a as { shift?: string | null }).shift ?? "").trim().toUpperCase();
      if (sh === "DAY") byShift.DAY += 1;
      else if (sh === "NIGHT") byShift.NIGHT += 1;
      else byShift.unknown += 1;
    }
    return { total: validated.length, top, byShift };
  }, [periodActionRows]);

  // Table sort — every column is sortable; Efficiency descending is the default,
  // so the best-performing leader is on top rather than the highest raw output.
  const [leaderSort, setLeaderSort] = useState<{ key: LeaderSortKey; dir: "asc" | "desc" }>({ key: "eff", dir: "desc" });
  const toggleLeaderSort = (key: LeaderSortKey) =>
    setLeaderSort((cur) =>
      cur.key === key
        ? { key, dir: cur.dir === "desc" ? "asc" : "desc" }
        : { key, dir: LEADER_TEXT_KEYS.includes(key) ? "asc" : "desc" },
    );

  const leaderRowsSorted = useMemo(() => {
    const { key, dir } = leaderSort;
    const sign = dir === "desc" ? -1 : 1;
    return [...leaderPerf.rows].sort((a, b) => {
      const x = a[key];
      const y = b[key];
      // Leaders with no RAG target always sink to the bottom, in both directions.
      if (x === null && y === null) return a.leader.localeCompare(b.leader);
      if (x === null) return 1;
      if (y === null) return -1;
      if (typeof x === "string" || typeof y === "string") {
        return sign * String(x).localeCompare(String(y), undefined, { numeric: true });
      }
      return x === y ? a.leader.localeCompare(b.leader) : sign * (x < y ? -1 : 1);
    });
  }, [leaderPerf.rows, leaderSort]);

  /**
   * Rank by score, computed once and independent of the table's current sort — the
   * medal belongs to the leader, not to whichever row floated to the top of whichever
   * column the reader last clicked.
   */
  const leaderRank = useMemo(() => rankLeadersByScore(leaderPerf.rows), [leaderPerf.rows]);

  const leaderTopByEff = useMemo(
    () =>
      leaderPerf.rows
        .filter((r) => r.eff !== null)
        .sort((a, b) => (b.eff as number) - (a.eff as number))
        .slice(0, 8)
        .map((r) => ({ name: truncLabel(r.leader, 14), value: Number((r.eff as number).toFixed(1)) })),
    [leaderPerf.rows],
  );

  // Range comes from the server now; this keeps the boundary exact and applies the
  // shift, so every WO-derived widget below sees the same set the KPIs do.
  const allWOs = useMemo(() => {
    if (!rawWOs) return undefined;
    return rawWOs.filter((w) => {
      const d = new Date(w.created_at);
      if (d < startDate || d > endDate) return false;
      if (shift !== "ALL" && londonShiftOf(w.created_at) !== shift) return false;
      return true;
    });
  }, [rawWOs, startDate, endDate, shift]);

  const { data: userCount } = useQuery({
    queryKey: ["user_count"],
    queryFn: async () => {
      // Try exact count first
      const { count, error } = await supabase
        .from("profiles")
        .select("id", { count: "exact", head: true });
      if (!error && count !== null) return count;
      // Fallback: fetch ids and count length (works around RLS/head quirks)
      const { data, error: fallbackError } = await supabase.from("profiles").select("id");
      if (fallbackError) {
        console.error("Total Users query failed:", fallbackError);
        return 0;
      }
      return data?.length ?? 0;
    },
  });

  // Three readings of one set — the work orders raised in the selected period — so the
  // row can be held against itself. "Completed Today" used to sit here counting the
  // calendar day instead: with the period on last month it printed 0 directly above
  // "No activity in selected period", which is two different claims in one card.
  const { open: openCount, inProgress: inProgressCount, completed: completedCount } =
    woStatusCounts(allWOs ?? []);
  const hasNoActivity = !woLoading && !!rawWOs && (allWOs?.length ?? 0) === 0;

  // Single source of truth for Response / MTTR / MTBF — shared with Executive Dashboard.
  const { avgResponseMin, avgMTTRMin, avgMTBFMin } = useMaintenanceKpis({ from: startDate, to: endDate, shift });
  const kpis = { avgResponse: avgResponseMin, avgMTTR: avgMTTRMin, avgMTBF: avgMTBFMin };


  // Compute days for the "WOs per Day" chart based on the selected range
  const rangeDays = useMemo(() => {
    const diffMs = endDate.getTime() - startDate.getTime();
    return Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  }, [startDate, endDate]);

  const wosPerDay = useMemo(() => {
    if (!allWOs) return [];
    const displayDays = Math.min(rangeDays, 30); // show at most 30 bars
    const days: { date: string; count: number }[] = [];
    for (let i = displayDays - 1; i >= 0; i--) {
      const d = subDays(endDate, i);
      days.push({ date: format(d, "dd/MM"), count: allWOs.filter((w) => new Date(w.created_at).toDateString() === d.toDateString()).length });
    }
    return days;
  }, [allWOs, endDate, rangeDays]);

  const ordersByStatus = useMemo(() => {
    if (!allWOs) return [];
    const sc: Record<string, number> = {};
    allWOs.forEach((w) => { sc[w.status] = (sc[w.status] || 0) + 1; });
    return Object.entries(sc).map(([status, count]) => ({ name: status, value: count }));
  }, [allWOs]);

  const lineProblems = useMemo(() => {
    if (!allWOs) return [];
    const lc: Record<string, number> = {};
    allWOs.forEach((w) => {
      const line = resolveLine(w, machines, "No Line");
      lc[line] = (lc[line] || 0) + 1;
    });
    return Object.entries(lc)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 7)
      .map(([line, count]) => ({ line, count }));
  }, [allWOs, machines]);

  const topProblems = useMemo(() => {
    if (!allWOs) return [];
    const pc: Record<string, number> = {};
    allWOs.forEach((w) => { pc[w.description] = (pc[w.description] || 0) + 1; });
    return Object.entries(pc).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([problem, count]) => ({ problem, count }));
  }, [allWOs]);

  const metricsById = useMemo(() => {
    const m = new Map<string, typeof woMetricsRange[number]>();
    (woMetricsRange ?? []).forEach((row) => { if (row.id) m.set(row.id, row); });
    return m;
  }, [woMetricsRange]);

  const slaCompliance = useMemo(() => {
    if (!allWOs) return { rate: 0, total: 0, met: 0 };
    const relevant = allWOs.filter((w) => DONE_STATUSES.includes(w.status));
    let met = 0;
    let counted = 0;
    relevant.forEach((wo) => {
      const m = metricsById.get(wo.id);
      if (!m || typeof m.response_time_sec !== "number") return;
      counted++;
      const target = SLA_TARGETS[wo.priority || "medium"] || 60;
      const responseMin = m.response_time_sec / 60;
      if (responseMin <= target) met++;
    });
    return { rate: counted ? Math.round((met / counted) * 100) : 0, total: counted, met };
  }, [allWOs, metricsById]);

  const ordersByPriority = useMemo(() => {
    if (!allWOs) return [];
    const pc: Record<string, number> = {};
    allWOs.forEach((w) => { pc[w.priority || "medium"] = (pc[w.priority || "medium"] || 0) + 1; });
    return Object.entries(pc).map(([priority, count]) => ({ priority, count }));
  }, [allWOs]);

  // Map line_id -> line name
  const lineNameById = useMemo(() => {
    const m = new Map<string, string>();
    (linesData ?? []).forEach((l: any) => m.set(l.id, l.name));
    return m;
  }, [linesData]);

  const { data: downtimeRecords } = useDowntime();

  // Aligned with Downtime page (parallel stoppages counted once).
  const totalDowntimeMinutes = useMemo(() => {
    const recs = downtimeRecords || [];
    const rangeStartMs = startOfDay(startDate).getTime();
    const rangeEndMs = Math.min(endOfDay(endDate).getTime(), Date.now());
    return reconcileMinutes(
      recs.map((r) => ({ start: r.started_at, end: r.ended_at })),
      rangeStartMs,
      rangeEndMs,
      Date.now(),
    );
  }, [downtimeRecords, startDate, endDate]);


  const mostAffectedLine = useMemo(() => {
    if (!allWOs) return null;
    const map: Record<string, number> = {};
    allWOs.filter((w) => DONE_STATUSES.includes(w.status)).forEach((wo: any) => {
      const m = metricsById.get(wo.id);
      if (!m || typeof m.active_repair_sec !== "number") return;
      const name = (wo.line_id && lineNameById.get(wo.line_id)) || "Unassigned";
      map[name] = (map[name] || 0) + m.active_repair_sec / 60;
    });
    const sorted = Object.entries(map).sort((a, b) => b[1] - a[1]);
    if (!sorted.length) return null;
    return { name: sorted[0][0], minutes: Math.round(sorted[0][1]) };
  }, [allWOs, metricsById, lineNameById]);

  // Most used machines (highest WO count)
  const mostUsedMachines = useMemo(() => {
    if (!allWOs) return [];
    const map: Record<string, number> = {};
    allWOs.forEach((w) => { map[w.machine] = (map[w.machine] || 0) + 1; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([machine, count]) => ({ machine, count }));
  }, [allWOs]);

  // Maintenance frequency: avg WOs per machine per month
  const maintenanceFrequency = useMemo(() => {
    if (!allWOs || !allWOs.length) return [];
    const map: Record<string, { count: number; firstWO: Date; lastWO: Date }> = {};
    allWOs.forEach((w) => {
      const d = new Date(w.created_at);
      if (!map[w.machine]) map[w.machine] = { count: 0, firstWO: d, lastWO: d };
      map[w.machine].count++;
      if (d < map[w.machine].firstWO) map[w.machine].firstWO = d;
      if (d > map[w.machine].lastWO) map[w.machine].lastWO = d;
    });
    return Object.entries(map).map(([machine, v]) => {
      const months = Math.max(1, differenceInMinutes(v.lastWO, v.firstWO) / (60 * 24 * 30));
      return { machine, avgPerMonth: Math.round((v.count / months) * 10) / 10 };
    }).sort((a, b) => b.avgPerMonth - a.avgPerMonth).slice(0, 8);
  }, [allWOs]);

  const engineerPerformance = useMemo(() => {
    if (!allWOs) return [];
    const engineers: Record<string, { name: string; completed: number; totalResp: number; totalMTTR: number; respCount: number; mttrCount: number }> = {};
    allWOs.filter((w) => DONE_STATUSES.includes(w.status) && w.engineer_id).forEach((wo) => {
      const eid = wo.engineer_id!;
      const name = wo.engineer_name || (wo as any).engineer?.name || "Unknown";
      if (!engineers[eid]) engineers[eid] = { name, completed: 0, totalResp: 0, totalMTTR: 0, respCount: 0, mttrCount: 0 };
      engineers[eid].completed++;
      const m = metricsById.get(wo.id);
      if (m && typeof m.response_time_sec === "number") {
        engineers[eid].totalResp += m.response_time_sec / 60;
        engineers[eid].respCount++;
      }
      if (m && typeof m.active_repair_sec === "number") {
        engineers[eid].totalMTTR += m.active_repair_sec / 60;
        engineers[eid].mttrCount++;
      }
    });
    return Object.values(engineers).map((e) => ({
      name: e.name,
      completed: e.completed,
      avgResponse: e.respCount ? Math.round(e.totalResp / e.respCount) : 0,
      avgMTTR: e.mttrCount ? Math.round(e.totalMTTR / e.mttrCount) : 0,
    })).sort((a, b) => b.completed - a.completed);
  }, [allWOs, metricsById]);


  /**
   * The ranking, scored on the period being looked at.
   *
   * `engineer_scores.score` used to decide this, and it is a lifetime accumulator
   * that is never recalculated: +10 for a fast response, +20 for a fast repair, −15
   * and −30 for missing the targets, clamped to 0–100. Because it accumulates and
   * stops at 100, everybody reaches the ceiling and stays there, where the rewards do
   * nothing and only the penalties still bite. On 04/08 seven engineers read exactly
   * 100 and Lucas Bombo read 85 — one missed response SLA, once, at some point since
   * he hit the cap. It ranked him last for it while telling nobody why, and it showed
   * all eight a score on a day none of them had completed anything.
   *
   * Scored from the same two numbers the maintenance KPIs use, over the same period,
   * so the ranking can be checked against the columns printed beside it.
   */
  const rankedEngineers = useMemo(() => {
    // Half the score for answering, half for fixing. Full marks at the target, none
    // at four times it, straight line between — a shape somebody can argue with,
    // which the old one was not.
    const band = (value: number, target: number) =>
      Math.max(0, Math.min(50, Math.round(50 * (1 - (value - target) / (target * 3)))));
    return engineerPerformance
      .map((e) => ({
        ...e,
        // No completed orders in the period is not a zero and not a hundred: there is
        // nothing to score, and saying so is more use than a number nobody earned.
        score: e.completed === 0 ? null : band(e.avgResponse, 30) + band(e.avgMTTR, 60),
      }))
      .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.completed - a.completed);
  }, [engineerPerformance]);

  return (
    <DashboardLayout>
      <div className="space-y-6 print-content" id="analytics-print">
        {/* Print Header — visible only when printing/exported */}
        {/* The header already accepted a shift label and never received one, so a
            printed day-shift report was indistinguishable from a night one. */}
        <ReportPrintHeader
          title="Analytics Report"
          periodLabel={reportPeriodLabel(period)}
          shift={shift === "ALL" ? "All shifts" : shift === "DAY" ? "Day (06–18)" : "Night (18–06)"}
        />
        <div className="hidden print:grid grid-cols-2 gap-4 text-sm mb-4">
          <div className="border rounded p-2">
            <p className="text-xs uppercase text-muted-foreground">Total Downtime (Period)</p>
            <p className="text-base font-bold">{fmtMin(totalDowntimeMinutes)}</p>
          </div>
          <div className="border rounded p-2">
            <p className="text-xs uppercase text-muted-foreground">Most Affected Line</p>
            <p className="text-base font-bold">
              {mostAffectedLine ? `${mostAffectedLine.name} — ${fmtMin(mostAffectedLine.minutes)}` : "—"}
            </p>
          </div>
        </div>


        <PageHeader
          className="print:hidden"
          title="Analytics"
          description="KPIs, charts and performance metrics for the selected period and shift."
          icon={<BarChart3 className="h-5 w-5" />}
          actions={
          <div className="flex gap-2">
            {/* Offered only to whoever may actually use it — a button that exists to
                refuse you is worse than no button. The click still checks, because
                can() reads the live permission overrides and an admin may revoke the
                action while this page is open. */}
            {canPrintReport(role) && (
            <Button variant="outline" size="sm" onClick={async () => {
              if (!canPrintReport(role)) {
                toast({ title: "Cannot print", description: "You don't have permission to print reports.", variant: "destructive" });
                return;
              }
              const el = document.getElementById("analytics-print");
              try {
                if (el) await printElementAsDocument(el, "Analytics Report");
              } catch (err: any) {
                toast({ title: "Could not print", description: err?.message ?? "The print dialog did not open.", variant: "destructive" });
              }
            }}>
              <Printer className="h-4 w-4 mr-1" /> Print
            </Button>
            )}
          </div>
          }
        />

        {/* Date Range Filters — off the paper. The period and shift they select are
            already stated in the report header; the controls themselves printed as
            empty boxes between the header and the KPIs. */}
        <ReportsFilterBar
          className="print:hidden"
          dateRange={drRange}
          datePreset={drPreset}
          onDateChange={(r, p) => { setDrRange(r); setDrPreset(p); }}
          shift={shift}
          onShiftChange={setShift}
          storageKey={OPS_RANGE_KEY}
        >
          <Badge variant="secondary" className="text-xs">{allWOs?.length ?? 0} WOs in range</Badge>
        </ReportsFilterBar>

        {(woLoading || machinesLoading || metricsLoading || scoresLoading) && !rawWOs && (
          <div className="space-y-6 print:hidden" aria-busy="true" aria-label="Loading analytics">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={`kpi-${i}`} className="h-28 w-full" />
              ))}
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={`chart-${i}`} className="h-72 w-full" />
              ))}
            </div>
            <Skeleton className="h-64 w-full" />
          </div>
        )}

        {/* KPI cards. The print columns are explicit: the responsive breakpoints are
            measured against the paper width, so the same report could come out four
            across or stacked one per row depending on the printer's page size. */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 print:grid-cols-4 print:gap-2">
          <KpiCard accent="blue" icon={<ClipboardList className="h-4 w-4" />} label="Open WOs" value={openCount} sublabel={hasNoActivity ? "No activity in selected period" : undefined} />
          <KpiCard accent="indigo" icon={<LayoutDashboard className="h-4 w-4" />} label="In Progress" value={inProgressCount} sublabel={hasNoActivity ? "No activity in selected period" : undefined} />
          <KpiCard accent="green" icon={<ClipboardList className="h-4 w-4" />} label="Completed" value={completedCount} sublabel={hasNoActivity ? "No activity in selected period" : undefined} />
          <KpiCard accent="muted" icon={<Users className="h-4 w-4" />} label="Total Users" value={userCount ?? 0} />
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 print:grid-cols-4 print:gap-2">
          <KpiCard accent="indigo" icon={<Timer className="h-4 w-4" />} label="Avg Response" value={fmtMin(kpis.avgResponse)} sublabel={hasNoActivity ? "No activity in selected period" : undefined} />
          <KpiCard accent="amber" icon={<Activity className="h-4 w-4" />} label="Avg MTTR" value={fmtMin(kpis.avgMTTR)} sublabel={hasNoActivity ? "No activity in selected period" : undefined} />
          <KpiCard accent="purple" icon={<Activity className="h-4 w-4" />} label="Avg MTBF" value={formatMTBF(kpis.avgMTBF / 60)} sublabel={hasNoActivity ? "No activity in selected period" : "Mean Time Between Failures"} />
          <KpiCard accent={slaCompliance.rate < 80 ? "red" : "green"} icon={<Timer className="h-4 w-4" />} label="SLA Compliance" value={`${slaCompliance.rate}%`} valueClassName={slaCompliance.rate < 80 ? "text-destructive-strong" : "text-success-strong"} sublabel={hasNoActivity ? "No activity in selected period" : undefined} />
        </div>
        {/* Leader Performance — production line leaders aggregated for the range */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Trophy className="h-5 w-5 text-warning-strong" /> Leader Performance
              <Badge variant="secondary" className="ml-1 text-xs font-normal">{leaderPerf.rows.length} leaders</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {leaderPerf.rows.length === 0 ? (
              <EmptyState icon={Users} title="No production leader data" description="No production sessions with an assigned leader in the selected period." className="py-8" />
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-lg border p-3"><div className="text-2xs text-muted-foreground uppercase tracking-wider">Avg Efficiency</div><div className={`text-2xl font-bold tabular-nums ${leaderPerf.avgEff >= 100 ? "text-success-strong" : leaderPerf.avgEff >= 80 ? "text-warning-strong" : "text-destructive-strong"}`}>{leaderPerf.avgEff.toFixed(1)}%</div></div>
                  <div className="rounded-lg border p-3" title="Actions raised in this period and still to do or in progress"><div className="text-2xs text-muted-foreground uppercase tracking-wider">Open Actions</div><div className={`text-2xl font-bold tabular-nums ${leaderPerf.totalOpenActions > 0 ? "text-warning-strong" : ""}`}>{leaderPerf.totalOpenActions.toLocaleString("en-US")}<span className="ml-1.5 text-sm font-medium text-muted-foreground">{attributionReady ? `${leaderPerf.totalOpenPoints.toLocaleString("en-US")} pts` : "— pts"}</span></div></div>
                  <div className="rounded-lg border p-3"><div className="text-2xs text-muted-foreground uppercase tracking-wider">Total Output</div><div className="text-2xl font-bold tabular-nums">{leaderPerf.totalActual.toLocaleString("en-US")}</div></div>
                  <div className="rounded-lg border p-3"><div className="text-2xs text-muted-foreground uppercase tracking-wider">Total Target</div><div className="text-2xl font-bold tabular-nums">{leaderPerf.totalTarget.toLocaleString("en-US")}</div></div>
                </div>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={leaderTopByEff} layout="vertical" margin={{ left: 8, right: 34 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11 }} unit="%" />
                      <YAxis type="category" dataKey="name" width={92} tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(v: number) => `${v.toFixed(1)}%`} />
                      <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                        {leaderTopByEff.map((r) => (
                          <Cell key={r.name} fill={r.value >= 100 ? "#22c55e" : r.value >= 80 ? "#f59e0b" : "#ef4444"} />
                        ))}
                        <LabelList dataKey="value" position="right" className="text-2xs" formatter={(v: number) => `${v.toFixed(1)}%`} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[720px]">
                    <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
                      <tr>
                        {/* "Rank", not "#": it is a position by score, not the row's
                            place in whatever column is currently sorted. */}
                        <th className="p-2 text-left" title="Position by score — does not change when you sort another column">Rank</th>
                        <LeaderTh sortKey="leader" align="left" sort={leaderSort} onSort={toggleLeaderSort}>Leader</LeaderTh>
                        <LeaderTh sortKey="score" sort={leaderSort} onSort={toggleLeaderSort}>Score</LeaderTh>
                        <LeaderTh sortKey="eff" sort={leaderSort} onSort={toggleLeaderSort}>Efficiency</LeaderTh>
                        <LeaderTh sortKey="docErrors" sort={leaderSort} onSort={toggleLeaderSort}>Doc errors</LeaderTh>
                        <LeaderTh sortKey="openActions" sort={leaderSort} onSort={toggleLeaderSort} title="Raised in this period and still to do or in progress — the Quality board holds the older backlog">Open Actions</LeaderTh>
                        <LeaderTh sortKey="sessions" sort={leaderSort} onSort={toggleLeaderSort}>Sessions</LeaderTh>
                        <LeaderTh sortKey="lines" sort={leaderSort} onSort={toggleLeaderSort}>Lines</LeaderTh>
                        <LeaderTh sortKey="shifts" align="left" sort={leaderSort} onSort={toggleLeaderSort}>Shifts</LeaderTh>
                        <LeaderTh sortKey="actual" sort={leaderSort} onSort={toggleLeaderSort}>Output</LeaderTh>
                        <LeaderTh sortKey="target" sort={leaderSort} onSort={toggleLeaderSort}>Target</LeaderTh>
                      </tr>
                    </thead>
                    <tbody>
                      {leaderRowsSorted.map((r) => {
                        const rank = leaderRank.get(r.leader) ?? null;
                        const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : null;
                        return (
                        <tr key={r.leader} className="border-t">
                          <td className="p-2 tabular-nums">
                            {rank === null ? (
                              <span className="text-muted-foreground" title="Nothing measurable in this period — unranked, not last">—</span>
                            ) : medal ? (
                              // The emoji is the whole cell, so it needs a name a screen
                              // reader can say. "🥇" on its own is announced as nothing.
                              <span role="img" aria-label={`Rank ${rank} by score`} title={`Rank ${rank} by score`}>{medal}</span>
                            ) : (
                              rank
                            )}
                          </td>
                          <td className="p-2 font-medium">{r.leader}</td>
                          <td className="p-2 text-right">
                            {!attributionReady ? (
                              /* The score subtracts quality points, so it moves when
                                 attribution lands. A leader must not watch their own
                                 percentage drop a second after the page paints. */
                              <PointsPending />
                            ) : r.score === null ? (
                              <span className="text-muted-foreground" title="Nothing measurable in this period">—</span>
                            ) : (
                              <span
                                className={`font-bold tabular-nums ${r.score >= 90 ? "text-success-strong" : r.score >= 75 ? "text-warning-strong" : "text-destructive-strong"}`}
                                title={`Production ${weights.production_pct}% · Quality ${weights.quality_pct}% · Documentation ${weights.documentation_pct}% — open the leader for the breakdown`}
                              >
                                {displayScore(r.score)}%
                              </span>
                            )}
                          </td>
                          <td className="p-2 text-right">
                            {r.eff === null ? (
                              <span className="text-muted-foreground" title="No RAG weekly plan for this leader's sessions in the period">—</span>
                            ) : (
                              <Badge className={`${r.eff >= 100 ? "bg-success/15 text-success-strong border-success/40" : r.eff >= 80 ? "bg-warning/15 text-warning-strong border-warning/40" : "bg-destructive/15 text-destructive-strong border-destructive/40"} border`}>{r.eff.toFixed(1)}%</Badge>
                            )}
                          </td>
                          <td className="p-2 text-right tabular-nums">
                            {r.docErrors === 0 ? (
                              <span className="text-muted-foreground" title="No validated paperwork error in this period">0</span>
                            ) : (
                              <Link
                                to="/dashboard/quality"
                                className="font-semibold text-destructive-strong hover:underline"
                                title={`${r.docErrors} validated paperwork error${r.docErrors === 1 ? "" : "s"} — −${r.docErrors * 5}% on the documentation score`}
                              >
                                {r.docErrors} <span className="text-2xs font-normal">−{r.docErrors * 5}%</span>
                              </Link>
                            )}
                          </td>
                          <td className="p-2 text-right tabular-nums">
                            {r.openActions === 0 ? (
                              <span className="text-muted-foreground">0</span>
                            ) : (
                              <Link
                                to="/dashboard/quality"
                                className="font-semibold text-warning-strong hover:underline dark:text-warning-strong"
                                title={`${r.openActions} action${r.openActions === 1 ? "" : "s"} raised in this period and still open`}
                              >
                                {r.openActions}
                                <span className="ml-1 text-2xs font-normal text-muted-foreground" title="Open points (Low 1 · Medium 2 · High 3 · Critical 4)">{attributionReady ? `${r.openPoints}p` : "—"}</span>
                                {r.openCritical > 0 && <span className="ml-1 text-2xs font-bold text-destructive-strong" title={`${r.openCritical} high/critical`}>⚠{r.openCritical}</span>}
                              </Link>
                            )}
                          </td>
                          <td className="p-2 text-right tabular-nums">{r.sessions}</td>
                          <td className="p-2 text-right tabular-nums">{r.lines}</td>
                          <td className="p-2">{r.shifts || "—"}</td>
                          <td className="p-2 text-right tabular-nums font-semibold">{r.actual.toLocaleString("en-US")}</td>
                          <td className="p-2 text-right tabular-nums text-muted-foreground">{r.target.toLocaleString("en-US")}</td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Where the documentation errors come from, and on which shift. */}
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="rounded-lg border p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Top documentation errors</p>
                    {docErrorSummary.total === 0 ? (
                      <p className="mt-1 text-sm text-muted-foreground">No validated paperwork error in this period.</p>
                    ) : (
                      <ol className="mt-1.5 space-y-1">
                        {docErrorSummary.top.map((t, i) => (
                          <li key={t.text} className="flex items-baseline justify-between gap-3 text-sm">
                            <span className="min-w-0"><span className="mr-1.5 text-2xs text-muted-foreground">{i + 1}</span>{t.text}</span>
                            <span className="shrink-0 font-semibold tabular-nums">{t.count}</span>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Validated by shift</p>
                    <div className="mt-1.5 grid grid-cols-3 gap-2 text-center">
                      {([["Day", docErrorSummary.byShift.DAY], ["Night", docErrorSummary.byShift.NIGHT], ["No shift", docErrorSummary.byShift.unknown]] as const).map(([label, n]) => (
                        <div key={label} className="rounded-md border p-2">
                          <p className="text-2xs uppercase tracking-wide text-muted-foreground">{label}</p>
                          <p className={`text-xl font-bold tabular-nums ${n > 0 ? "text-destructive-strong" : ""}`}>{n}</p>
                        </div>
                      ))}
                    </div>
                    <p className="mt-1 text-2xs text-muted-foreground">
                      Validated paperwork errors only — actions still under review are not counted.
                    </p>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 print:hidden">
          <Link to="/dashboard/downtime" className="block">
            <Card className="hover:border-primary transition-colors h-full">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Downtime & Reliability</CardTitle>
                <TrendingDown className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">Open the dedicated downtime page for totals, records and the heatmap.</p>
              </CardContent>
            </Card>
          </Link>
        </div>


        {/* Charts */}
        <div className="grid gap-6 md:grid-cols-2 print:grid-cols-2 print:gap-3">
          <Card>
            <CardHeader><CardTitle className="text-base">WOs per Day (Last {Math.min(rangeDays, 30)} Days)</CardTitle></CardHeader>
            <CardContent>
              {!wosPerDay.length || wosPerDay.every((d: any) => !d.count) ? (
                <EmptyChart />
              ) : (
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={wosPerDay}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" /><YAxis allowDecimals={false} /><Tooltip /><Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} /></BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Orders by Status</CardTitle></CardHeader>
            <CardContent>
              {!ordersByStatus.length ? (
                <EmptyChart />
              ) : (
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie data={ordersByStatus} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} labelLine={false} label={({ name, percent }) => (percent >= 0.05 ? `${String(name).replace(/_/g, " ")} ${(percent * 100).toFixed(0)}%` : "")}>
                      {ordersByStatus.map((entry, i) => {
                        const STATUS_COLORS: Record<string, string> = {
                          open: "#ef4444",
                          in_progress: "#f59e0b",
                          finished: "#22c55e",
                          completed: "#22c55e",
                          done: "#14b8a6",
                          closed: "#14b8a6",
                          force_closed: "#6b7280",
                          received: "#3b82f6",
                          arrived: "#8b5cf6",
                        };
                        return <Cell key={i} fill={STATUS_COLORS[entry.name] || COLORS[i % COLORS.length]} />;
                      })}
                    </Pie>
                    <Tooltip formatter={(v: number, n: string) => [v, String(n).replace(/_/g, " ")]} />
                    <Legend formatter={(value: string) => <span style={{ color: "hsl(var(--foreground))" }}>{value.replace(/_/g, " ")}</span>} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* NEW: WOs per Machine Type */}
          <Card>
            <CardHeader><CardTitle className="text-base">WOs per Machine Type</CardTitle></CardHeader>
            <CardContent>
              {(() => {
                const wosByType: Record<string, number> = {};
                if (allWOs && machines) {
                  const machineTypeMap: Record<string, string> = {};
                  machines.forEach((m) => { machineTypeMap[m.name] = m.machine_type || "No Machine Assigned"; });
                  allWOs.forEach((w) => {
                    const t = w.machine ? (machineTypeMap[w.machine] || "No Machine Assigned") : "No Machine Assigned";
                    wosByType[t] = (wosByType[t] || 0) + 1;
                  });
                }
                const data = Object.entries(wosByType).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([type, count]) => ({ type, count }));
                return !data.length ? (
                  <EmptyChart />
                ) : (
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={data} layout="vertical"><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" allowDecimals={false} /><YAxis type="category" dataKey="type" width={140} tick={{ fontSize: 11 }}  /><Tooltip /><Bar dataKey="count" fill="#8b5cf6" name="WOs" radius={[0, 4, 4, 0]} /></BarChart>
                  </ResponsiveContainer>
                );
              })()}
            </CardContent>
          </Card>

          {/* NEW: Machine Status Distribution */}
          <Card>
            <CardHeader><CardTitle className="text-base">Machine Status Distribution</CardTitle></CardHeader>
            <CardContent>
              {(() => {
                const statusCounts: Record<string, number> = {};
                machines?.forEach((m) => {
                  const s = m.status || "active";
                  statusCounts[s] = (statusCounts[s] || 0) + 1;
                });
                const data = Object.entries(statusCounts).map(([name, value]) => ({ name, value }));
                const STATUS_COLORS = ["#10b981", "#f59e0b", "#ef4444", "#6b7280", "#8b5cf6"];
                return !data.length ? (
                  <EmptyChart />
                ) : (
                  <ResponsiveContainer width="100%" height={250}>
                    <PieChart>
                      <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} labelLine={false} label={({ name, percent }) => (percent >= 0.05 ? `${String(name).replace(/_/g, " ")} ${(percent * 100).toFixed(0)}%` : "")}>
                        {data.map((_, i) => <Cell key={i} fill={STATUS_COLORS[i % STATUS_COLORS.length]} />)}
                      </Pie>
                      <Tooltip formatter={(v: number, n: string) => [v, String(n).replace(/_/g, " ")]} />
                      <Legend formatter={(value: string) => <span style={{ color: "hsl(var(--foreground))" }}>{value.replace(/_/g, " ")}</span>} />
                    </PieChart>
                  </ResponsiveContainer>
                );
              })()}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Lines with Most Problems</CardTitle></CardHeader>
            <CardContent>
              {!lineProblems.length ? (
                <EmptyChart />
              ) : (
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={lineProblems} layout="vertical"><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" allowDecimals={false} /><YAxis type="category" dataKey="line" width={140} tick={{ fontSize: 11 }} tickFormatter={(v: string) => truncLabel(v)} /><Tooltip /><Bar dataKey="count" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} /></BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Top 5 Problems</CardTitle></CardHeader>
            <CardContent>
              {!topProblems.length ? (
                <EmptyChart />
              ) : (
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={topProblems} layout="vertical"><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" allowDecimals={false} /><YAxis type="category" dataKey="problem" width={140} tick={{ fontSize: 11 }} tickFormatter={(v: string) => truncLabel(v)} /><Tooltip /><Bar dataKey="count" radius={[0, 4, 4, 0]}>{topProblems.map((_, i) => (<Cell key={i} fill={COLORS[i % COLORS.length]} />))}<LabelList dataKey="count" position="right" fontSize={11} /></Bar></BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Orders by Priority</CardTitle></CardHeader>
            <CardContent>
              {!ordersByPriority.length ? (
                <EmptyChart />
              ) : (
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={ordersByPriority}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="priority" /><YAxis allowDecimals={false} /><Tooltip /><Bar dataKey="count" fill="#f59e0b" radius={[4, 4, 0, 0]} /></BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Most Used Machines</CardTitle></CardHeader>
            <CardContent>
              {!mostUsedMachines.length ? (
                <EmptyChart />
              ) : (
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={mostUsedMachines} layout="vertical"><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" allowDecimals={false} /><YAxis type="category" dataKey="machine" width={140} tick={{ fontSize: 11 }} tickFormatter={(v: string) => truncLabel(v)} /><Tooltip /><Bar dataKey="count" fill="hsl(var(--primary))" name="Total WOs" radius={[0, 4, 4, 0]} /></BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Maintenance Frequency (avg WOs/month)</CardTitle></CardHeader>
            <CardContent>
              {!maintenanceFrequency.length ? (
                <EmptyChart />
              ) : (
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={maintenanceFrequency} layout="vertical"><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" /><YAxis type="category" dataKey="machine" width={140} tick={{ fontSize: 11 }} tickFormatter={(v: string) => truncLabel(v)} /><Tooltip /><Bar dataKey="avgPerMonth" fill="hsl(var(--accent))" name="Avg/Month" radius={[0, 4, 4, 0]} /></BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>


        {/* Engineer Ranking */}
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Trophy className="h-5 w-5 text-warning-strong" /> Engineer Ranking</CardTitle></CardHeader>
          <CardContent>
            {!rankedEngineers.length ? (
              <EmptyChart />
            ) : (
              <div className="space-y-6">
                {/* Top 3 podium */}
                <div className="flex justify-center gap-4 items-end">
                  {rankedEngineers.slice(0, 3).map((eng, i) => {
                    const heights = ["h-28", "h-24", "h-20"];
                    const medals = [<Award key="g" className="h-6 w-6 text-warning-strong" />, <Award key="s" className="h-5 w-5 text-gray-400" />, <Award key="b" className="h-5 w-5 text-warning-strong" />];
                    return (
                      <div key={eng.name} className="flex flex-col items-center">
                        {medals[i]}
                        <p className="text-sm font-bold mt-1">{eng.name}</p>
                        <p className="text-lg font-bold text-primary">{eng.score ?? "—"}</p>
                        <div className={`w-20 ${heights[i]} bg-primary/20 rounded-t-lg flex items-end justify-center pb-1`}>
                          <span className="text-xs text-muted-foreground">{eng.completed} WOs</span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Full table */}
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">#</th>
                        <th className="px-3 py-2 text-left font-medium">Engineer</th>
                        <th className="px-3 py-2 text-center font-medium">Score</th>
                        <th className="px-3 py-2 text-center font-medium">Completed</th>
                        <th className="px-3 py-2 text-center font-medium">Avg Response</th>
                        <th className="px-3 py-2 text-center font-medium">Avg MTTR</th>
                        <th className="px-3 py-2 text-center font-medium">Trend</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rankedEngineers.map((eng, i) => (
                        <tr key={eng.name} className="border-t">
                          <td className="px-3 py-2 font-bold">{i + 1}</td>
                          <td className="px-3 py-2 font-medium">{eng.name}</td>
                          <td className="px-3 py-2 text-center">
                            {/* Nothing completed in the period is not a zero: there is
                                nothing to score, and a badge reading 0 accuses somebody
                                of a bad month they did not have. */}
                            {eng.score === null ? (
                              <span className="text-xs text-muted-foreground">no orders</span>
                            ) : (
                              <Badge variant={eng.score >= 75 ? "default" : "destructive"}>{eng.score}</Badge>
                            )}
                          </td>
                          <td className="px-3 py-2 text-center">{eng.completed}</td>
                          <td className="px-3 py-2 text-center">{fmtMin(eng.avgResponse)}</td>
                          <td className="px-3 py-2 text-center">{fmtMin(eng.avgMTTR)}</td>
                          <td className="px-3 py-2 text-center">
                            {/* Against the targets, not against zero: the old test was
                                `score > 0`, which pointed the arrow up for everybody. */}
                            {eng.score === null ? <span className="text-muted-foreground">—</span>
                              : eng.score >= 75 ? <TrendingUp className="h-4 w-4 text-success-strong inline" />
                              : <TrendingDown className="h-4 w-4 text-destructive-strong inline" />}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Quality Analytics ── */}
        <div className="space-y-4 print:break-inside-avoid">
          <h3 className="text-lg font-bold flex items-center gap-2"><Activity className="h-5 w-5 text-primary" /> Quality Analytics</h3>
          {qa.total === 0 ? (
            <Card><CardContent className="py-8"><p className="text-center text-sm text-muted-foreground">No quality actions in this period.</p></CardContent></Card>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <KpiCard accent="blue" icon={<ClipboardList className="h-4 w-4" />} label="Total Actions" value={qa.total} />
                <KpiCard accent="amber" icon={<Timer className="h-4 w-4" />} label="Open" value={qa.open} />
                <KpiCard accent="green" icon={<Award className="h-4 w-4" />} label="Completed" value={qa.completed} />
                <KpiCard accent="red" icon={<TrendingDown className="h-4 w-4" />} label="High / Critical" value={qa.critical} />
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader><CardTitle className="text-base">Actions by Status</CardTitle></CardHeader>
                  <CardContent className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={qa.statusData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                          {qa.statusData.map((e, i) => <Cell key={i} fill={e.color} />)}
                        </Pie>
                        <Tooltip /><Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle className="text-base">Actions by Severity</CardTitle></CardHeader>
                  <CardContent className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={qa.severityData}>
                        <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" fontSize={12} /><YAxis allowDecimals={false} fontSize={12} /><Tooltip />
                        <Bar dataKey="value" fill="hsl(24 90% 55%)" radius={[4, 4, 0, 0]}><LabelList dataKey="value" position="top" /></Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle className="text-base">Actions by Line</CardTitle></CardHeader>
                  <CardContent className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={qa.lineData} layout="vertical" margin={{ left: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" /><XAxis type="number" allowDecimals={false} fontSize={12} /><YAxis type="category" dataKey="name" width={90} fontSize={11} /><Tooltip />
                        <Bar dataKey="value" fill="hsl(217 91% 60%)" radius={[0, 4, 4, 0]}><LabelList dataKey="value" position="right" /></Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle className="text-base">Actions by Department</CardTitle></CardHeader>
                  <CardContent className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={qa.deptData} layout="vertical" margin={{ left: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" /><XAxis type="number" allowDecimals={false} fontSize={12} /><YAxis type="category" dataKey="name" width={90} fontSize={11} /><Tooltip />
                        <Bar dataKey="value" fill="hsl(262 83% 58%)" radius={[0, 4, 4, 0]}><LabelList dataKey="value" position="right" /></Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </div>
              <Card>
                <CardHeader><CardTitle className="text-base">Actions Trend</CardTitle></CardHeader>
                <CardContent className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={qa.trendData}>
                      <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" fontSize={11} /><YAxis allowDecimals={false} fontSize={12} /><Tooltip />
                      <Bar dataKey="value" fill="hsl(142 71% 45%)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </>
          )}
        </div>

        {/* Printed footer — same identity line every report carries. */}
        <div className="print-doc-footer hidden print:flex items-center justify-between mt-4 pt-2 border-t border-black text-[8pt]">
          <span>Analytics Report · {reportPeriodLabel(period, "dd/MM/yyyy")}</span>
          <span>Applied Nutrition · Confidential · printed {format(new Date(), "dd/MM/yyyy HH:mm")}</span>
        </div>
      </div>
    </DashboardLayout>
  );
}
