import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/DashboardLayout";
import { SectionErrorBoundary } from "@/components/SectionErrorBoundary";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusRail, type RailState } from "@/components/ui/StatusRail";
import { ControlPlate, ControlField, ControlDivider } from "@/components/ui/ControlPlate";
import { ConsoleCell } from "@/components/ui/ConsoleStrip";
import { LeaderScorecard } from "@/components/LeaderScorecard";
import { LineIndicators } from "@/components/production/LineIndicators";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight, Medal, BarChart3, Printer, AlertTriangle, Download } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { generatePerformanceReportPDF } from "@/lib/performanceReport";
import { getCurrentFactoryShift, getCurrentShiftStart, shiftDateFetchRange, shiftSessionDate } from "@/lib/shifts";
import { classifyLive, stopClock, LIVE_TONE, type LiveReading } from "@/lib/lineLiveStatus";
import { stopColour, isAmbiguousStop, ITOUCH_RUNNING } from "@/lib/intouchStopColours";
import { computePace, lineScore, scoreBand, PACE_MESSAGES, PACE_STATUS, PACE_NEEDS_ACTION, type ScoreBand, type ScoreBasis } from "@/lib/linePerformance";
import { AndonBar } from "@/components/ui/AndonBar";
import { cn } from "@/lib/utils";
import { ANDON_FIELD } from "@/lib/rail";
import { buildSkuCatalogue, pickLineSku, resolveItemSku, type LineSkuItem, type LiveJob } from "@/lib/lineSku";
import { EmptyState } from "@/components/EmptyState";
import { format, parseISO, addDays, subDays, addMonths, addQuarters, addYears, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfQuarter, endOfQuarter, startOfYear, endOfYear } from "date-fns";
import { CircularProgress } from "@/components/ui/circular-progress";
import { toast } from "sonner";

type Period = "day" | "week" | "month" | "quarter" | "year" | "custom";

/**
 * The three carriers of a band, in one place, so a card cannot say GO in the
 * plate, HOLD on the rail and STOP in the figure. They came apart once already:
 * the plate read the plan's 100/80 while the colour read the pace's 95/75, so a
 * line at 97% was captioned "Setup" and printed in green.
 *
 * Two vocabularies, because a pace and a share of the plan are different claims:
 * "On pace" is about this minute, "On target" is about the whole period.
 */
const BAND_RAIL: Record<ScoreBand, RailState> = { GO: "go", HOLD: "hold", STOP: "stop" };
const BAND_TEXT: Record<ScoreBand, string> = {
  GO: "text-success-strong",
  HOLD: "text-warning-strong",
  STOP: "text-destructive-strong",
};
const PACE_BAND_STATUS: Record<ScoreBand, string> = { GO: "On pace", HOLD: "Behind", STOP: "Critical" };
const PLAN_BAND_STATUS: Record<ScoreBand, string> = { GO: "On target", HOLD: "Setup", STOP: "Below target" };
/* O andon fala da fábrica inteira e precisa das suas próprias palavras: "Setup" é o
   que se diz de uma linha que está a mudar de formato, não de um turno. */
const FACTORY_PACE_VERDICT: Record<ScoreBand, string> = { GO: "On pace", HOLD: "Behind pace", STOP: "Critical" };
const FACTORY_PLAN_VERDICT: Record<ScoreBand, string> = { GO: "On target", HOLD: "Behind plan", STOP: "Below target" };

interface SessionAgg {
  id: string; session_date: string; shift: string; line: string;
  leader_name: string | null; locked: boolean;
  target: number; actual: number; eff: number;
  // `sku_code_text` travels with `sku_id` everywhere, because either one of them
  // can be the only place the product is named — see `lineSku.ts`.
  items: LineSkuItem[];
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
        .select("line, machine, status, reason, planned, seen_at, stop_since, job_code, job_name, job_state, job_seen_at");
      if (error) throw error;
      return (data ?? []) as { line: string; machine: string | null; status: number | null; reason: string | null; planned: boolean | null; seen_at: string | null; stop_since: string | null; job_code: string | null; job_name: string | null; job_state: string | null; job_seen_at: string | null }[];
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

  /**
   * O que o iTouching tem em cada máquina, para as linhas que ninguém escreveu.
   *
   * Separado da leitura de estado acima porque responde a outra pergunta e vale
   * outra coisa: nomeia o produto e não mede nada. O poll grava-o por máquina —
   * ver `liveJob.ts` — e o cartão recusa-o quando envelhece.
   */
  const liveJobByLine = useMemo(() => {
    const norm = (s: string | null | undefined) => String(s ?? "").trim().toLowerCase();
    const m = new Map<string, LiveJob>();
    for (const r of liveRows) {
      if (!r.job_code) continue;
      m.set(norm(r.line), {
        code: r.job_code,
        name: r.job_name,
        seenAt: r.job_seen_at ? new Date(r.job_seen_at) : null,
        state: r.job_state === "running" ? "running" : "next",
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
  // By id AND by code: half the rows on the board identify their product only by
  // the code as text, with `sku_id` never resolved by the import. See `lineSku.ts`.
  const catalogue = useMemo(() => buildSkuCatalogue(skus), [skus]);

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
        .select("id, session_date, shift, line, leader_name, locked, production_items(sku_id, sku_code_text, target_qty, planned_qty, actual_qty, started_at, finished_at)")
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

      const sessions: SessionAgg[] = (data ?? []).map((s: { id: string; session_date: string; shift: string; line: string; leader_name: string | null; locked: boolean; production_items: { sku_id: string | null; sku_code_text: string | null; target_qty: number | null; planned_qty: number | null; actual_qty: number | null; started_at: string | null; finished_at: string | null }[] }) => {
        const items = s.production_items ?? [];
        const key = `${s.session_date}|${s.line}|${s.shift}`;
        const target = ragPlanMap.get(key) ?? 0;
        const itemsActual = items.reduce((a, i) => a + Number(i.actual_qty ?? 0), 0);
        const ragActual = ragActualMap.get(key) ?? 0;
        const actual = ragActual > 0 ? ragActual : itemsActual;
        return { id: s.id, session_date: s.session_date, shift: s.shift, line: s.line, leader_name: s.leader_name, locked: s.locked, target, actual, eff: target > 0 ? (actual / target) * 100 : 0, items: items.map((i) => ({ sku_id: i.sku_id ?? null, sku_code_text: i.sku_code_text ?? null, actual: Number(i.actual_qty ?? 0), started_at: i.started_at ?? null, finished_at: i.finished_at ?? null })) };
      });

      return { sessions, ragRows };
    },
  });

  const sessions = useMemo(() => queryResult?.sessions ?? [], [queryResult]);
  const ragRows = useMemo(() => queryResult?.ragRows ?? [], [queryResult]);

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
        // Resolved by link OR by the text code. Line 2, 12/08: 1.832 feitas contra
        // ABEENG, que tem 720/h — e o cartão dizia "SKU has no standard rate"
        // porque a linha de produção tinha `sku_id` a NULL e mais nada foi tentado.
        ratePerHour: resolveItemSku(i, catalogue)?.target_per_hour ?? null,
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
  }, [isCurrentShiftView, sessions, catalogue]);

  /**
   * O veredicto da fábrica, numa medida só — o que a barra de andon acende.
   *
   * Corre pela MESMA função que dá a banda a cada cartão. Se o ecrã inteiro dissesse
   * VERDE por uma conta e um cartão dissesse vermelho por outra, era o ecrã que perdia
   * a autoridade: é o que se lê de longe e é o que ninguém vai conferir.
   *
   * A base muda com o que se está a ver, e tem de mudar. Contra o plano inteiro do
   * turno, às 21:39 de um turno que acaba às 06:00 a fábrica leria 7% — não porque
   * esteja a perder, mas porque faltam nove horas de plano. Uma lâmpada vermelha todas
   * as noites até às quatro da manhã é uma lâmpada que ninguém volta a olhar. Enquanto
   * o turno corre mede-se contra o que já era devido a esta hora; quando o período
   * fecha, contra o plano, que aí é a pergunta certa.
   *
   * Soma-se produzido e devido de TODAS as linhas antes de dividir, e não a média das
   * percentagens: nove linhas pequenas não valem o mesmo que uma linha grande, e uma
   * média simples diria que sim.
   */
  const factory = useMemo(() => {
    const scored = byLine.filter((l) => l.target > 0);
    const totalTarget = scored.reduce((a, l) => a + l.target, 0);
    const totalActual = scored.reduce((a, l) => a + l.actual, 0);

    let expected = 0;
    let produced = 0;
    let pacedLines = 0;
    for (const l of scored) {
      const p = paceByLine.get(l.line);
      if (p?.kind !== "PACE") continue;
      expected += p.expected;
      produced += p.produced;
      pacedLines += 1;
    }

    // A base do ritmo só serve enquanto houver alguma coisa devida por alguma linha.
    // Na primeira meia hora de um turno o "devido até agora" é praticamente zero, e
    // dividir por ele dava percentagens de milhares.
    const paced = isCurrentShiftView && pacedLines > 0 && expected >= 1;
    const basis: ScoreBasis = paced ? "PACE" : "PLAN";
    const denom = paced ? expected : totalTarget;
    const numer = paced ? produced : totalActual;

    // Sem plano não há veredicto. Um ecrã verde numa fábrica sem ordens, ou vermelho
    // numa que ainda não abriu, é o ecrã a inventar uma leitura que não tem.
    if (denom <= 0) {
      return { state: "idle" as RailState, verdict: "No plan", value: null as string | null, basis: "Nothing planned for this period", detail: undefined as string | undefined, pct: 0, paced: false };
    }

    const pct = (numer / denom) * 100;
    const band = scoreBand(basis, pct);

    /**
     * A percentagem IMPRESSA é sempre a fatia do plano — a mesma pergunta que os
     * cartões passaram a responder em grande, e a mesma que quem tem a folha na
     * mão consegue conferir: feito a dividir pelo planeado do período.
     *
     * A COR e o veredicto continuam a vir do ritmo enquanto o turno corre, e é
     * essa a divisão de trabalho: a lâmpada diz se se está a perder AGORA, o
     * número diz quanto do turno já está feito. Imprimir o ritmo aqui punha no
     * ecrã uma percentagem que não batia com nenhuma das duas somas escritas a
     * um palmo dela — nem com o anel, nem com o "feito / planeado".
     */
    const attainedPct = totalTarget > 0 ? (totalActual / totalTarget) * 100 : 0;
    const lines = `${scored.length} ${scored.length === 1 ? "line" : "lines"}`;

    return {
      state: BAND_RAIL[band],
      verdict: (paced ? FACTORY_PACE_VERDICT : FACTORY_PLAN_VERDICT)[band],
      value: `${Math.round(attainedPct)}%`,
      basis: paced
        ? `${lines} · of the full shift plan`
        : `${lines} · against the period plan`,
      // Em peças, contra o alvo, e nada mais. O ritmo esteve escrito aqui — "60%
      // of what is due by now" — e era a última percentagem no ecrã com um
      // denominador que não está em lado nenhum na folha. Continua a decidir a
      // cor e o veredicto acima; deixa de ser um número a competir com o outro.
      detail: paced
        ? `${totalActual.toLocaleString("en-US")} / ${totalTarget.toLocaleString("en-US")}`
        : `${Math.round(numer).toLocaleString("en-US")} / ${Math.round(denom).toLocaleString("en-US")}`,
      pct: attainedPct,
      paced,
    };
  }, [byLine, paceByLine, isCurrentShiftView]);


  /**
   * What each line is actually making, which the board never said.
   *
   * The card could report "SKU has no standard rate" without naming the SKU, so a
   * supervisor was told a product was misconfigured and not which product. And a
   * line is defined by what is on it right now — the iTouching board leads with
   * the product for that reason.
   *
   * Which item, and how the product is identified when the row carries no link to
   * the catalogue, are both in `lineSku.ts` — the same rule the wallboard uses, in
   * one place, because reading `sku_id` alone left three of six lines unnamed.
   */
  const skuByLine = useMemo(() => {
    const out = new Map<string, ReturnType<typeof pickLineSku>>();
    const bySession = new Map<string, SessionAgg[]>();
    for (const s of sessions) {
      const arr = bySession.get(s.line) ?? [];
      arr.push(s);
      bySession.set(s.line, arr);
    }
    // Every line the board can draw, not only the ones with a session: a line
    // whose order nobody has written down is exactly the case iTouching answers,
    // and keying off the sessions alone would skip it. `now` is read once so the
    // whole board ages the jobs against the same instant.
    const now = new Date();
    const lineNames = new Set<string>([...bySession.keys(), ...byLine.map((l) => l.line), ...lines.map((l) => l.name)]);
    for (const line of lineNames) {
      const items = (bySession.get(line) ?? []).flatMap((s) => s.items);
      const job = liveJobByLine.get(line.trim().toLowerCase());
      // Only while looking at the shift that is running. iTouching's job is a
      // statement about this minute, and beside a finished shift's figures it
      // would be two different days on one card — the same rule the live pill
      // and the pace notch already follow.
      const sku = pickLineSku(items, catalogue, isCurrentShiftView ? { job, now } : undefined);
      if (sku) out.set(line, sku);
    }
    return out;
  }, [sessions, catalogue, byLine, lines, liveJobByLine, isCurrentShiftView]);

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
      {/* O ecrã fica verde, âmbar ou vermelho.
          O banho sangra para fora do padding do shell — margens negativas do tamanho
          exacto do padding, com o padding reposto por dentro — para que seja o ECRÃ a
          ficar da cor e não um cartão dentro dele. A 7% não tira legibilidade a nada:
          o que se lê a três metros é a barra, e o que se lê a trinta centímetros são os
          números, que continuam sobre o mesmo fundo de sempre. */}
      <div className={cn("-m-3 space-y-6 p-3 transition-colors duration-500 sm:-m-4 sm:p-4 md:-m-6 md:p-6", ANDON_FIELD[factory.state])}>
        <AndonBar
          state={factory.state}
          verdict={factory.verdict}
          value={factory.value}
          basis={factory.basis}
          detail={factory.detail}
        />
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
          {/* A placa de comando.
              Seis controlos soltos por cima de um painel são um formulário; o que eles
              na verdade são é a afinação do instrumento que está por baixo. Juntos numa
              placa, com uma chapa em cada um e um filete a separar as datas dos filtros,
              lêem-se como o que são — e o painel volta a começar no primeiro número. */}
          <ControlPlate>
            <ControlField label="Date range" className="w-full lg:w-auto">
            <div className="flex items-center gap-1.5">
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
              }} className="min-w-0 flex-1 sm:w-[9.5rem] sm:flex-none" />
              <span className="shrink-0 font-display text-2xs font-bold uppercase tracking-[0.1em] text-muted-foreground">to</span>
              <Input type="date" value={endDate} min={date} onChange={(e) => {
                setEndDate(e.target.value);
                if (period !== "custom") setPeriod("custom");
              }} className="min-w-0 flex-1 sm:w-[9.5rem] sm:flex-none" />
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
            </ControlField>

            <ControlDivider />

            <ControlField label="Period" className="min-w-[8.5rem] flex-1 sm:flex-none">
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
            </ControlField>
            <ControlField label="Shift" className="min-w-[8.5rem] flex-1 sm:flex-none">
              <Select value={shift} onValueChange={(v) => setShift(v as "all" | "DAY" | "NIGHT")}>
                <SelectTrigger className="w-full sm:w-28"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">All</SelectItem><SelectItem value="DAY">Day</SelectItem><SelectItem value="NIGHT">Night</SelectItem></SelectContent>
              </Select>
            </ControlField>
            <ControlField label="Line" className="min-w-[8.5rem] flex-1 sm:flex-none">
              <Select value={lineFilter} onValueChange={setLineFilter}>
                <SelectTrigger className="w-full sm:w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All lines</SelectItem>
                  {sortedLines.map((l) => <SelectItem key={l.name} value={l.name}>{l.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </ControlField>
            <ControlField label="Leader" className="min-w-[8.5rem] flex-1 sm:flex-none">
              <Select value={leaderFilter} onValueChange={setLeaderFilter}>
                <SelectTrigger className="w-full sm:w-44"><SelectValue placeholder="All leaders" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All leaders</SelectItem>
                  {leaders.map((l) => <SelectItem key={l.name} value={l.name}>{l.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </ControlField>
            {/* The scorecard belongs here: production runs the leaders, and this is
                the screen where their lines, shifts and output already are. It used
                to open from Quality, which only ever saw one third of the score. */}
            {leaderFilter !== "__all__" && (
              <Button variant="outline" className="gap-1.5" onClick={() => setScorecardFor(leaderFilter)}>
                <Medal className="h-4 w-4" /> Scorecard
              </Button>
            )}

            {/* O que está de facto a ser mostrado, resolvido. Com o período em semana
                ou em mês, as duas caixas de data não dizem onde a semana começa nem
                onde acaba, e é essa a pergunta a que este canto responde. */}
            <div className="ml-auto self-end pb-2.5 text-right">
              <div className="font-figure text-xs font-bold leading-none text-foreground">
                {range.from === range.to ? format(parseISO(range.from), "dd MMM yyyy") : `${format(parseISO(range.from), "dd MMM")} → ${format(parseISO(range.to), "dd MMM yyyy")}`}
              </div>
            </div>
          </ControlPlate>
        </div>


        {/* Overall OEE Panel — excludes lines with no RAG Weekly target for the period (#9) */}
        {(() => {
          const scored = byLine.filter((l) => l.target > 0);
          const totalTarget = scored.reduce((a, l) => a + l.target, 0);
          const totalActual = scored.reduce((a, l) => a + l.actual, 0);
          const excludedCount = byLine.length - scored.length;
          const variance = totalActual - totalTarget;
          /* A chave diz o critério que está mesmo a ser aplicado.
             Os cartões pontuam ao ritmo — 95/75 contra o tempo já trabalhado — enquanto
             se olha para o turno a correr, e contra o plano — 100/80 — quando o período
             já fechou. Uma legenda fixa em 100/80 estava a explicar as cores erradas
             durante metade das horas do dia. */
          const key: [string, string, string][] = isCurrentShiftView
            ? [["bg-success", "≥95%", "on pace"], ["bg-warning", "75–94%", "behind"], ["bg-destructive", "<75%", "critical"]]
            : [["bg-success", "≥100%", "on target"], ["bg-warning", "80–99%", "behind"], ["bg-destructive", "<80%", "critical"]];
          return (
            <Card>
              <CardContent className="p-0">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-5 p-5">
                  {/* O mesmo número da barra de andon, e nunca um segundo.
                      Duas percentagens da mesma fábrica no mesmo ecrã, a dois palmos
                      uma da outra, era o defeito antigo — e resolveu-se pelos dois
                      lados a dizerem a mesma coisa: quanto do plano do período já está
                      feito. É a conta que os números em peças aqui ao lado mostram
                      escrita por extenso, e o ritmo, que tem outro denominador, vive
                      agora na linha de baixo da barra e nos cartões. */}
                  <CircularProgress value={factory.pct} size={104} strokeWidth={9} sublabel="Attained" />
                  <div className="min-w-[13rem] flex-1">
                    <div className="font-display text-2xs font-bold uppercase tracking-[0.13em] text-muted-foreground">
                      Overall performance
                    </div>
                    {/* Feito e planeado na mesma linha, e o planeado em surdina: são o
                        mesmo facto lido em duas metades, e só uma delas é a notícia. */}
                    <div className="mt-1.5 font-figure text-[2rem] font-bold leading-none text-foreground">
                      {totalActual.toLocaleString("en-US")}
                      <span className="text-muted-foreground"> / {totalTarget.toLocaleString("en-US")}</span>
                    </div>
                    <div className="mt-1.5 text-xs text-muted-foreground">
                      Units made, against the {factory.paced ? "full shift plan" : "period plan"}
                    </div>
                  </div>
                  {/* A chave, à voz mais baixa do painel, e com o nome de quem ela
                      explica: são as cores das BARRAS dos cartões, não do anel ao lado.
                      Três chips cheios punham as três cores de sinalética no ecrã com
                      mais força do que qualquer linha que as estivesse a merecer. */}
                  <div className="flex flex-col gap-2">
                    <span className="font-display text-2xs font-bold uppercase leading-none tracking-[0.12em] text-muted-foreground">
                      Line status
                    </span>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                      {key.map(([swatch, band, meaning]) => (
                        <span key={band} className="flex items-center gap-1.5 whitespace-nowrap text-2xs text-muted-foreground">
                          <span className={`h-2 w-2 shrink-0 rounded-full ${swatch}`} aria-hidden />
                          <span className="font-figure font-bold text-foreground">{band}</span>
                          {meaning}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
                {/* A régua. O que estava numa frase corrida em cinzento — quatro factos
                    separados por pontos — passa a quatro medidas com a sua chapa, que é
                    como se lê um número que se vai comparar com o de ontem. */}
                <div className="grid grid-cols-2 divide-x divide-y border-t sm:grid-cols-4 sm:divide-y-0">
                  <ConsoleCell
                    label="Variance"
                    value={`${variance >= 0 ? "+" : ""}${variance.toLocaleString("en-US")}`}
                    hint="units against plan"
                    tone={variance > 0 ? "text-success-strong" : "text-foreground"}
                  />
                  <ConsoleCell label="Lines scored" value={String(scored.length)} hint={`of ${byLine.length} with activity`} />
                  <ConsoleCell label="Sessions" value={String(sessions.length)} hint="logged in the period" />
                  <ConsoleCell
                    label="No RAG target"
                    value={String(excludedCount)}
                    hint={excludedCount > 0 ? "excluded from the score" : "every line has a plan"}
                    tone={excludedCount > 0 ? "text-warning-strong" : "text-muted-foreground"}
                  />
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
            /* A mesma barra dos cartões, num aviso. Antes o parágrafo inteiro era
               âmbar, e um bloco de três linhas em cor de sinalética grita mais alto do
               que a linha que está mesmo parada. Fica o veredicto em âmbar; a
               explicação, que é o que se lê depois de já se ter percebido, em cinzento. */
            <div className="flex items-start gap-2.5 rounded-lg border border-l-[3px] border-warning/35 border-l-warning bg-warning/[0.07] px-4 py-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-strong" />
              <div>
                {/* Um aviso, e não uma desculpa.
                    Isto dizia que as linhas liam 0% "não necessariamente porque
                    nada foi feito" — o painel a retirar, por baixo, o veredicto
                    que tinha acabado de dar por cima. Um número que precisa de
                    um rodapé a desdizê-lo não é um número; era o cartão que
                    estava errado, e é lá que foi corrigido. Aqui fica o que
                    isto sempre foi: a lista de quem falta, num sítio só. */}
                <b className="text-warning-strong">{missing.length} {missing.length === 1 ? "line has" : "lines have"} a plan but nothing logged on My Production.</b>{" "}
                <span className="text-muted-foreground">
                  {missing.map((l) => l.line).join(", ")}. Until the quantities are logged
                  {isCurrentShiftView ? " these lines cannot be paced" : " the period reads 0% for them"}.
                </span>
              </div>
            </div>
          );
        })()}

        {/* `items-stretch` com o `fill` do cartão: numa fila, todos os cartões têm a
            altura do mais alto, e a medida de cada um encosta ao mesmo fundo. */}
        <div className="grid items-stretch gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {sortedByLine.map((l) => {

            // Industrial Andon panel — high-contrast dark, readable from across
            // the floor / on a line TV. Status colours: green on-target, amber
            // setup/near, red below-target (pulsing).
            const gap = l.actual - l.target;
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
            // The pace that could NOT be given, when that is the case. It is the
            // subject of the footer note and of the amber rail, and it survives a
            // line that scores on the plan anyway: a missing standard rate is a
            // fault about the SKU, and it stays named either way.
            const gapKind = pace && pace.kind !== "PACE" ? pace.kind : null;
            // One reading, and everything on the card is dressed from it — the
            // plate, the rail and the figure. See `lineScore`: the card colours
            // the number it prints, on that number's own thresholds.
            const score = lineScore(pace, l.target, l.actual);
            // Each gap names itself. "No reading" was the board describing its own
            // difficulty, and it read the same on a line waiting for an order as on
            // a line whose SKU has no standard — two different people, two
            // different jobs, one word.
            const status = score
              ? (score.basis === "PACE" ? PACE_BAND_STATUS : PLAN_BAND_STATUS)[score.band]
              : gapKind ? PACE_STATUS[gapKind] : "—";
            // An unmeasurable line is grey unless it is somebody's job. Nothing
            // entered, nobody logged in and a SKU with no standard all take the
            // amber rail: the risk in each is that it stays unnoticed to the end
            // of the shift, and grey is how a card asks not to be looked at.
            const railState: RailState = score
              ? BAND_RAIL[score.band]
              : gapKind && PACE_NEEDS_ACTION[gapKind] ? "hold" : "idle";
            const effColor = score ? BAND_TEXT[score.band] : "text-muted-foreground";
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
                fill
                role="button"
                tabIndex={0}
                onClick={handleClick}
                onKeyDown={handleKeyDown}
                className="cursor-pointer transition-colors hover:border-primary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {/* A chapa da linha.
                    Duas alturas fixas, não duas alturas conforme calhar: o nome da
                    máquina ocupa a sua linha mesmo quando não existe. Quatro cartões
                    lado a lado são lidos na horizontal, e basta um deles ter uma
                    legenda a menos para que o número grande do vizinho desça dois
                    centímetros e essa leitura deixe de existir. */}
                <div className="flex items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-display text-xl font-bold uppercase leading-none tracking-[0.02em] text-foreground">{l.line}</div>
                    {/* O nome da máquina no iTouching, que é como a manutenção lhe
                        chama. Duas casas para a mesma linha só é confusão enquanto
                        uma delas estiver escondida. */}
                    {(() => {
                      const machine = liveRows.find((r) => r.line?.trim().toLowerCase() === l.line.trim().toLowerCase())?.machine;
                      const named = machine && machine.trim().toLowerCase() !== l.line.trim().toLowerCase() ? machine : null;
                      return <div className="mt-1.5 h-4 truncate text-2xs text-muted-foreground">{named}</div>;
                    })()}
                  </div>
                  {/* A etiqueta nomeia o estado; a barra ao lado é que o colore. Pintá-la
                      também seria dizer a mesma coisa duas vezes a três centímetros de
                      distância, e deixaria a percentagem sem ser a única coisa colorida
                      dentro do cartão — que é onde o olho deve pousar. Dito por extenso,
                      o estado também sobrevive a quem não distingue as três cores. */}
                  <span className="shrink-0 font-display text-2xs font-bold uppercase tracking-[0.1em] text-muted-foreground">{status}</span>
                </div>
                {/* What the line is doing RIGHT NOW, which is a different question
                    from how the shift has gone and is allowed to disagree with it:
                    a line can be behind on the shift because of a breakdown this
                    morning and be running perfectly at this minute. */}
                {/* Only while looking at the shift that is RUNNING.
                    A live pill beside a finished shift's numbers is two different
                    days on one card: at 21:39 on a night shift, with the filter on
                    Day 08/08, the board showed 4,517 made between 06:00 and 18:00
                    and, an inch below it, "RUNNING, 26 seconds ago" — which is a
                    statement about a shift whose figures are nowhere on the card.

                    The notch on the scale is withheld for exactly this reason and
                    this was the same rule left unapplied. */
                isCurrentShiftView && (() => {
                  const live = classifyLive(liveByLine.get(l.line.trim().toLowerCase()), new Date());
                  // iTouching's own colour for this exact stop code, so the two
                  // screens name the same stop with the same colour and nobody has
                  // to translate between them mid-shift. It identifies WHICH stop
                  // this is; how the line is doing stays on the rail, and the two
                  // are allowed to disagree — a line can be on a planned clean and
                  // still be the worst performer of the shift.
                  //
                  // Carried at low alpha with the text left on `foreground`, because
                  // twelve hues chosen for a white industrial panel cannot all be
                  // read against in a dark theme. The solid dot is where the hue is
                  // stated at full strength.
                  const hue = live.state === "RUNNING"
                    ? ITOUCH_RUNNING
                    : (live.state === "PLANNED_STOP" || live.state === "UNPLANNED_STOP")
                      ? stopColour(live.label)
                      : null;
                  const ambiguous = isAmbiguousStop(live.label);
                  return (
                    <div
                      className={`mt-3 flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 ${hue ? "text-foreground" : LIVE_TONE[live.state]}`}
                      style={hue ? { backgroundColor: `${hue}1F`, borderColor: `${hue}59` } : undefined}
                      title={[
                        live.ageSeconds == null
                          ? "iTouching has never reported this machine"
                          : `iTouching, read ${live.ageSeconds}s ago${live.rawStatus != null ? ` · status ${live.rawStatus}` : ""}`,
                        ambiguous ? "iTouching holds two codes called Metal Detected, in two colours; they cannot be told apart from here" : null,
                      ].filter(Boolean).join(" · ")}
                    >
                      {/* Verbatim, and NOT uppercased. The stop reason is the name
                          iTouching itself holds for that code — "Deep Clean", "No
                          Planned Shift", "Electrical Stop" — and the person reading
                          this board reads the same words on the iTouching screen.
                          Case-shifting it here makes it a second name for the same
                          thing, which is exactly what a shared vocabulary is not. */}
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: hue ?? "currentColor" }}
                          aria-hidden
                        />
                        <span className="truncate font-display text-2xs font-bold tracking-[0.1em]">
                          {live.label}{ambiguous ? " *" : ""}
                        </span>
                      </span>
                      {/* How long the line has been in this stop, in iTouching's own
                          H:MM:SS, so the two screens can be read side by side without
                          anyone converting anything. It counts on the board's clock,
                          not on the poll's, because a stop counter that only moved
                          every twenty seconds would read as broken.

                          When there is no stop to time, the reading's own age takes
                          the slot — a state nobody has confirmed for ten minutes is
                          not a state. Which of the two is on screen is `kind`, and it
                          is not left to the reader to work out: the stop's duration is
                          the bold figure, the reading's age is the quiet one, and a
                          stop nobody is timing says so instead of borrowing the age. */}
                      {(() => {
                        const clock = stopClock(live);
                        if (!clock) return null;
                        const title = clock.kind === "STOP"
                          ? "How long this stop has been running, as first seen by the poll"
                          : clock.kind === "UNTIMED"
                            ? "This stop is not being timed — the poll has not recorded a start for it"
                            : "How long ago iTouching last reported this machine";
                        return (
                          <span
                            className={`shrink-0 font-figure text-2xs ${clock.kind === "STOP" ? "font-bold" : "opacity-70"}`}
                            title={title}
                          >
                            {clock.text}
                          </span>
                        );
                      })()}
                    </div>
                  );
                })()}
                {(() => {
                  const sku = skuByLine.get(l.line);
                  // Um denominador, e é o que está escrito na folha.
                  //
                  // O cartão media o feito contra duas coisas ao mesmo tempo: o
                  // número grande dizia 60% (299 do que já era devido a esta hora)
                  // por cima de uma barra a 9% (299 do plano do turno), e o único
                  // dos dois que alguém podia conferir era o que não era um número.
                  // Quem lê o painel não tem como saber que os dois 299 são o mesmo
                  // 299 dividido por coisas diferentes — e um painel que precisa de
                  // ser explicado deixa de ser lido.
                  //
                  // Agora o cartão conta uma coisa só: feito, alvo, e a fatia. O
                  // ritmo continua a decidir a COR (ver `lineScore`), porque às
                  // cinco horas de doze 9% do plano não é um veredicto — mas deixa
                  // de imprimir um segundo número ao lado do primeiro.
                  const donePct = l.target > 0 ? Math.min(100, Math.max(0, (l.actual / l.target) * 100)) : 0;
                  return (
                    <>
                      {/* What is on the line. Quiet, because it is context and not a
                          measurement — but present, because "made 1,415" is a count
                          of something and the board never said of what.

                          A ranhura é fixa mesmo quando está vazia: uma linha sem SKU
                          registado não pode puxar o número grande para cima e
                          desalinhá-lo dos vizinhos. */}
                      <div className="mt-2.5 flex h-4 min-w-0 items-baseline gap-2">
                        {sku && (
                          <>
                            <span className="shrink-0 font-figure text-2xs font-bold text-foreground">{sku.code}</span>
                            <span className="truncate text-2xs text-muted-foreground">{sku.name}</span>
                            {sku.others > 0 && (
                              <span className="shrink-0 text-2xs text-muted-foreground/70" title={`${sku.others} other SKU${sku.others === 1 ? "" : "s"} ran on this line in the period`}>
                                +{sku.others}
                              </span>
                            )}
                            {/* Onde o produto foi sabido, quando não foi aqui.
                                Um produto que veio do iTouching nomeia a linha e não
                                mede nada: não há quantidade registada contra ele e o
                                ritmo continua a dizer "No order". Sem esta marca, o
                                cartão dava as duas coisas pelo mesmo facto — e uma
                                delas ninguém escreveu. "Next" separa a linha que está
                                a FAZER o produto da que está a ser montada para ele,
                                que é o caso da Line 2 em Line Preparation. */}
                            {sku.source === "itouch" && (
                              <span
                                className="shrink-0 font-display text-2xs uppercase tracking-[0.1em] text-muted-foreground/70"
                                title={sku.liveState === "next"
                                  ? "iTouching has this job next in the queue on this machine — the line is not making it yet, and no order for it is logged here"
                                  : "iTouching reports this job as running on this machine. Nothing is logged against it here, so there is no quantity to measure"}
                              >
                                · iTouching{sku.liveState === "next" ? ", next" : ""}
                              </span>
                            )}
                          </>
                        )}
                      </div>
                      {/* `mt-auto`: a medida encosta ao fundo do cartão. É o que faz com
                          que os quatro números grandes de uma fila assentem na mesma
                          linha, seja qual for o que cada linha tenha para dizer acima. */}
                      <div className="mt-auto flex items-end justify-between gap-3 pt-5">
                        <div className="min-w-0">
                          <div className="font-display text-2xs font-bold uppercase tracking-[0.12em] text-muted-foreground">Made</div>
                          <div className="mt-1 font-figure text-[2.5rem] font-bold leading-none tracking-[-0.02em] text-foreground">
                            {l.actual.toLocaleString("en-US")}
                          </div>
                          <div className="mt-1.5 font-figure text-xs text-muted-foreground">
                            {l.target.toLocaleString("en-US")} target
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-display text-2xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
                            Of target
                          </div>
                          {/* The one figure that carries colour. The rail says WHICH
                              state from across the room; this says HOW MUCH where the
                              eye has already landed. Everything else on the card is
                              foreground or muted — four colour carriers on one card is
                              how a board teaches people to stop looking at it.

                              O número é a fatia do alvo do turno — 299 de 3.233 — e é
                              o mesmo facto que a barra logo abaixo enche e que o 3.233
                              ao lado dela nomeia. Três sítios, uma conta.

                              A COR continua a vir do ritmo: a cinco horas de doze, 9%
                              do alvo não é um veredicto, e pintar de vermelho uma linha
                              que está a andar bem só porque ainda faltam sete horas é o
                              que fazia a fábrica deixar de olhar para o painel. */}
                          <div className={`mt-1 font-figure text-[2rem] font-bold leading-none tracking-[-0.02em] ${effColor}`}>
                            {Math.round(score ? score.attainedPct : l.eff)}%
                          </div>
                        </div>
                      </div>

                      {/* A escala. O enchimento é o que a linha fez, o fim da barra é
                          o alvo do turno, e a distância entre os dois É o relatório.
                          Havia aqui um entalhe a marcar "onde devia estar a esta hora"
                          — saiu com o ritmo, porque era a terceira voz a falar de uma
                          medida que o cartão já não imprime. */}
                      <div className="mt-3.5">
                        <div className="relative h-2 w-full overflow-hidden rounded-[2px] bg-foreground/[0.09]">
                          <div className="h-full bg-foreground/40" style={{ width: `${donePct}%` }} />
                        </div>
                        <div className="mt-2 flex items-baseline justify-between font-figure text-2xs text-muted-foreground">
                          <span>{gap >= 0 ? "+" : ""}{gap.toLocaleString("en-US")} vs target</span>
                          <span className="text-muted-foreground/70">{l.target.toLocaleString("en-US")}</span>
                        </div>
                      </div>

                      {/* Uma ranhura, duas notas, nunca as duas ao mesmo tempo: ou o
                          ritmo não pôde ser medido, ou pôde e ninguém registou nada. E
                          de altura fixa, como as de cima — é a última linha antes do
                          filete, e é ela que mantém o rodapé alinhado nos quatro
                          cartões. Dito uma vez e por palavras: uma linha sem ordem e
                          uma linha que não fez nada são factos diferentes, e o cartão
                          não os pode arredondar os dois a 0%. */}
                      <div className="mt-2.5 flex h-4 items-center gap-1.5">
                        {(() => {
                          // Uma nota, uma regra. Havia duas escritas aqui — a do
                          // ritmo em versaletes cinzentos e a do "não registado" em
                          // âmbar com triângulo — e qual delas aparecia dependia de
                          // se o cartão tinha conseguido pontuar. O mesmo facto
                          // mudava de voz consoante o caminho que o levou ao ecrã.
                          //
                          // Agora é o triângulo que carrega o significado, e diz o
                          // mesmo que a barra do bordo: isto é de alguém.
                          const note = pace && pace.kind !== "PACE"
                            // Named. Telling a supervisor that "the SKU" has no
                            // standard rate, on a line that ran three of them, is a
                            // fault report with the subject left out.
                            ? {
                                text: pace.kind === "NO_RATE" && sku
                                  // Two different faults, and telling them apart is
                                  // the difference between "go and set a rate" and
                                  // "this product does not exist here". The Tablet
                                  // Line ran 3.441 of "Vitamin  d3 and k2" on 12/08,
                                  // which is not a code in SKU Products at all.
                                  ? sku.uncatalogued
                                    ? `“${sku.code}” is not in SKU Products`
                                    : `${sku.code} has no standard rate`
                                  : PACE_MESSAGES[pace.kind],
                                act: PACE_NEEDS_ACTION[pace.kind],
                                why: pace.kind === "NOTHING_LOGGED"
                                  ? "The line has a session and an order, but no quantity has been logged on My Production this shift. Nothing here can tell that apart from a line that made nothing."
                                  : pace.kind === "NO_RATE"
                                    ? sku?.uncatalogued
                                      ? "The product on this order does not match any code in SKU Products, so there is nothing to pace it against. Fix the code on the order, or add the product."
                                      : "Pace needs units/hour on the SKU. Set it in SKU Products and this line starts scoring."
                                    : undefined,
                              }
                            : l.notLogged
                              ? {
                                  text: "Nothing logged for this period",
                                  act: true,
                                  why: "This line was planned to run but no production was logged on My Production, so it reads 0%.",
                                }
                              : null;
                          if (!note) return null;
                          return (
                            <span
                              className={`flex min-w-0 items-center gap-1.5 text-2xs ${note.act ? "font-semibold text-warning-strong" : "text-muted-foreground"}`}
                              title={note.why}
                            >
                              {note.act && <AlertTriangle className="h-3.5 w-3.5 shrink-0" />}
                              {/* Em caixa de frase, e não em versaletes espacejados:
                                  isto é uma frase, não uma chapa de coluna, e um
                                  código como UAEABECIB perde a própria forma dentro
                                  de uma corrida de maiúsculas espacejadas. */}
                              <span className="truncate">{note.text}</span>
                            </span>
                          );
                        })()}
                      </div>
                    </>
                  );
                })()}
                {/* O controlo, no fim e do outro lado de um filete.
                    Estava entre o nome da linha e o estado da máquina, e um campo de
                    formulário aí fazia o painel inteiro parecer um formulário. A ordem
                    de leitura de um instrumento é primeiro o que ele diz, e só depois o
                    que se lhe mexe. */}
                <div
                  className="mt-3.5 border-t border-border/80 pt-3"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="shrink-0 font-display text-2xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
                      Leader
                    </span>
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
                      <SelectTrigger className="h-8 flex-1 border-transparent bg-muted/60 text-xs hover:border-border focus:border-border">
                        <SelectValue placeholder="— Assign —" />
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
                  </div>
                  {addingLeaderFor === l.line && (
                    <div className="mt-2 flex items-center gap-1.5">
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
                        className="h-8 min-w-0 flex-1 text-xs"
                      />
                      <Button
                        size="sm"
                        className="h-8 px-2.5 text-xs"
                        disabled={savingLeaderFor === l.line || !newLeaderName.trim()}
                        onClick={() => addNewLeader(l.line, l.hasSession)}
                      >
                        Add
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 px-2 text-xs"
                        onClick={() => { setAddingLeaderFor(null); setNewLeaderName(""); }}
                      >
                        Cancel
                      </Button>
                    </div>
                  )}
                </div>
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
