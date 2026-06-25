import { useMemo, useState, useCallback } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useWorkOrders } from "@/hooks/useWorkOrders";
import { useMachines } from "@/hooks/useMachines";
import { useEngineerScores } from "@/hooks/useEngineerScores";
import { useAllWoMetrics } from "@/hooks/useWoMetrics";
import { differenceInMinutes, subDays, format, startOfDay, endOfDay } from "date-fns";
import { useDowntime } from "@/hooks/useDowntime";
import { reconcileMinutes } from "@/lib/downtimeReconcile";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Maximize, Minimize, AlertTriangle, Clock, Gauge, ShieldCheck, Timer, Activity, Trophy, TrendingUp, BarChart3 } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell } from "recharts";
import { countOpenWOs } from "@/lib/woStatus";
import { DateRangeFilter, DateRangePreset, DateRange, getPresetRange } from "@/components/DateRangeFilter";

export default function ExecutiveDashboard() {
  const { data: workOrders = [] } = useWorkOrders();
  const { data: machines = [] } = useMachines();
  const { data: engineerScores = [] } = useEngineerScores();
  const [kpiPreset, setKpiPreset] = useState<DateRangePreset>("today");
  const [kpiRange, setKpiRange] = useState<DateRange>(() => getPresetRange("today"));
  const [shiftFilter, setShiftFilter] = useState<"ALL" | "DAY" | "NIGHT">("ALL");
  const { data: woMetrics = [] } = useAllWoMetrics({ from: kpiRange.from, to: kpiRange.to });
  const { data: downtimeRecords = [] } = useDowntime();
  const [isFullscreen, setIsFullscreen] = useState(false);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  }, []);

  // Hour in Europe/London for shift detection (DAY = 06-18, NIGHT otherwise)
  const londonHour = (iso: string) => {
    const parts = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: "Europe/London" }).formatToParts(new Date(iso));
    return parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  };
  const inShift = useCallback((iso: string) => {
    if (shiftFilter === "ALL") return true;
    const h = londonHour(iso);
    const isDay = h >= 6 && h < 18;
    return shiftFilter === "DAY" ? isDay : !isDay;
  }, [shiftFilter]);

  // Work orders filtered by the selected KPI period (by created_at) and shift.
  const inRange = useCallback((iso: string) => {
    const d = new Date(iso);
    if (kpiRange.from && d < kpiRange.from) return false;
    if (kpiRange.to && d > kpiRange.to) return false;
    return inShift(iso);
  }, [kpiRange.from, kpiRange.to, inShift]);

  const filteredWOs = useMemo(
    () => workOrders.filter((w) => inRange(w.created_at)),
    [workOrders, inRange]
  );

  const kpis = useMemo(() => {
    // "Open" = anything not in a terminal state (closed/finished/completed/force_closed) — real-time, not period-filtered
    const openWOs = countOpenWOs(workOrders);

    // Avg Response Time = AVG(response_time_sec) from v_wo_metrics (exclude force_closed which skew the average)
    const shiftMetrics = woMetrics.filter((m: any) => !m.created_at || inShift(m.created_at));
    const respMetrics = shiftMetrics.filter((m) => m.response_time_sec !== null && (m as any).status !== "force_closed");
    const avgResponse = respMetrics.length
      ? Math.round(respMetrics.reduce((s, m) => s + (m.response_time_sec || 0), 0) / respMetrics.length / 60)
      : 0;

    // Avg Active Repair (MTTR) = AVG(active_repair_sec) from v_wo_metrics (exclude force_closed)
    const repairMetrics = shiftMetrics.filter((m) => m.active_repair_sec !== null && m.active_repair_sec > 0 && (m as any).status !== "force_closed");
    const avgMTTR = repairMetrics.length
      ? Math.round(repairMetrics.reduce((s, m) => s + (m.active_repair_sec || 0), 0) / repairMetrics.length / 60)
      : 0;

    // SLA Compliance — respect the selected period
    const slaTargets: Record<string, number> = { critical: 10, high: 30, medium: 60, low: 120 };
    const closedWOs = filteredWOs.filter((w) => ["closed", "completed"].includes(w.status) && w.received_at);
    const withinSLA = closedWOs.filter((w) => {
      const target = slaTargets[w.priority || "medium"] || 60;
      return differenceInMinutes(new Date(w.received_at!), new Date(w.created_at)) <= target;
    }).length;
    const slaPercent = closedWOs.length ? Math.round((withinSLA / closedWOs.length) * 100) : 100;

    // Total Line Downtime within selected period — aligned with Downtime page
    // (wall-clock; parallel stoppages counted once).
    const rangeStartMs = startOfDay(kpiRange.from).getTime();
    const rangeEndMs = Math.min(endOfDay(kpiRange.to).getTime(), Date.now());
    const lineDowntimeTodayMin = reconcileMinutes(
      (downtimeRecords || []).filter((r: any) => inShift(r.started_at)).map((r: any) => ({ start: r.started_at, end: r.ended_at })),
      rangeStartMs,
      rangeEndMs,
      Date.now(),
    );

    const machinesAtRisk = machines.filter((m) => m.health_score < 40).length;

    return { openWOs, avgResponse, avgMTTR, slaPercent, lineDowntimeTodayMin, machinesAtRisk };
  }, [workOrders, filteredWOs, machines, woMetrics, downtimeRecords, kpiRange, inShift]);

  // WOs per day across the selected period (defaults to last 7 days when range is empty).
  const wosPerDay = useMemo(() => {
    const end = kpiRange.to ?? new Date();
    const start = kpiRange.from ?? startOfDay(subDays(end, 6));
    const days: { label: string; count: number }[] = [];
    const dayMs = 86_400_000;
    const totalDays = Math.min(31, Math.max(1, Math.ceil((+startOfDay(end) - +startOfDay(start)) / dayMs) + 1));
    for (let i = totalDays - 1; i >= 0; i--) {
      const day = subDays(end, i);
      const dayStart = startOfDay(day);
      const dayEnd = new Date(+dayStart + dayMs);
      const count = workOrders.filter((w) => {
        const d = new Date(w.created_at);
        return d >= dayStart && d < dayEnd;
      }).length;
      days.push({ label: format(day, totalDays > 10 ? "dd/MM" : "EEE"), count });
    }
    return days;
  }, [workOrders, kpiRange.from, kpiRange.to]);

  // Top 3 lines by downtime — respect the selected period (filter by created_at).
  const topLines = useMemo(() => {
    const lineMap: Record<string, number> = {};
    filteredWOs.forEach((w) => {
      if (w.started_at && (w.finished_at || w.completed_at)) {
        const snapshot = ((w as any).line_at_time ?? "").toString().trim();
        const machine = machines.find((m) => m.name === w.machine);
        const liveLine = (machine?.line ?? "").toString().trim();
        const line = snapshot && !/^removed$/i.test(snapshot)
          ? snapshot
          : (liveLine || "—");
        const mins = differenceInMinutes(new Date(w.finished_at || w.completed_at!), new Date(w.started_at!));
        lineMap[line] = (lineMap[line] || 0) + mins;
      }
    });
    return Object.entries(lineMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([line, mins]) => ({ line, mins }));
  }, [filteredWOs, machines]);

  // Top 3 recurring problems — respect the selected period
  const topProblems = useMemo(() => {
    const probMap: Record<string, number> = {};
    filteredWOs.forEach((w) => {
      probMap[w.description] = (probMap[w.description] || 0) + 1;
    });
    return Object.entries(probMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([desc, count]) => ({ desc, count }));
  }, [filteredWOs]);

  // Top 3 engineers
  const topEngineers = useMemo(() => {
    return engineerScores.slice(0, 3);
  }, [engineerScores]);

  const formatMins = (m: number) => {
    if (m < 60) return `${m}min`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
  };

  return (
    <DashboardLayout>
      <div className={`space-y-6 ${isFullscreen ? "p-6 bg-background min-h-screen" : ""}`}>
        <div className="flex items-center justify-between print:hidden">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Executive Dashboard</h2>
            <p className="text-sm text-muted-foreground">Strategic overview for decision-making</p>
          </div>
          <Button variant="outline" size="sm" onClick={toggleFullscreen} className="gap-2">
            {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
            {isFullscreen ? "Exit Fullscreen" : "TV Mode"}
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-3 print:hidden">
          <span className="text-sm font-medium text-muted-foreground">KPI period filter</span>
          <div className="flex flex-wrap items-center gap-2">
            <DateRangeFilter
              value={kpiRange}
              preset={kpiPreset}
              onChange={(r, p) => { setKpiRange(r); setKpiPreset(p); }}
            />
            <Select value={shiftFilter} onValueChange={(v) => setShiftFilter(v as "ALL" | "DAY" | "NIGHT")}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All shifts</SelectItem>
                <SelectItem value="DAY">Day (06–18)</SelectItem>
                <SelectItem value="NIGHT">Night (18–06)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* KPI Grid */}
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <Card className="border-l-4 border-l-blue-500">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <Activity className="h-4 w-4" />
                <span className="text-xs font-medium">Open WOs</span>
              </div>
              <p className="text-3xl font-bold">{kpis.openWOs}</p>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-indigo-500">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <Clock className="h-4 w-4" />
                <span className="text-xs font-medium">Avg Response Time</span>
              </div>
              <p className="text-3xl font-bold">{formatMins(kpis.avgResponse)}</p>
              <p className="text-[10px] text-muted-foreground mt-1">created → accepted</p>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-amber-500">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <Gauge className="h-4 w-4" />
                <span className="text-xs font-medium">Avg Active Repair</span>
              </div>
              <p className="text-3xl font-bold">{formatMins(kpis.avgMTTR)}</p>
              <p className="text-[10px] text-muted-foreground mt-1">MTTR — pauses excluded</p>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-green-500">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <ShieldCheck className="h-4 w-4" />
                <span className="text-xs font-medium">SLA Compliance</span>
              </div>
              <p className="text-3xl font-bold">{kpis.slaPercent}%</p>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-orange-500">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <Timer className="h-4 w-4" />
                <span className="text-xs font-medium">Line Downtime (period)</span>
              </div>
              <p className="text-3xl font-bold">{formatMins(kpis.lineDowntimeTodayMin)}</p>
              <p className="text-[10px] text-muted-foreground mt-1">minutes lines were stopped</p>
            </CardContent>
          </Card>
          <Card className={`border-l-4 ${kpis.machinesAtRisk > 0 ? "border-l-destructive" : "border-l-green-500"}`}>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <AlertTriangle className="h-4 w-4" />
                <span className="text-xs font-medium">Machines at Risk</span>
              </div>
              <p className="text-3xl font-bold">{kpis.machinesAtRisk}</p>
            </CardContent>
          </Card>
        </div>

        {/* Charts + Rankings */}
        <div className="grid gap-4 lg:grid-cols-3">
          {/* WOs per day chart */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <BarChart3 className="h-4 w-4" /> Work Orders — Selected Period
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div style={{ width: "100%", height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={wosPerDay}>
                    <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                      {wosPerDay.map((_, i) => (
                        <Cell key={i} fill="hsl(var(--primary))" />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Top Engineers */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Trophy className="h-4 w-4 text-amber-500" /> Top Engineers
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {topEngineers.map((eng, i) => (
                  <div key={eng.id} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`text-lg font-bold ${i === 0 ? "text-amber-500" : i === 1 ? "text-muted-foreground" : "text-orange-600"}`}>
                        #{i + 1}
                      </span>
                      <span className="text-sm font-medium">{eng.engineer_name}</span>
                    </div>
                    <span className="font-bold text-primary">{eng.score} pts</span>
                  </div>
                ))}
                {!topEngineers.length && <p className="text-sm text-muted-foreground">No data</p>}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Bottom row: Top Lines + Top Problems */}
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-destructive" /> Most Impacted Lines
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {topLines.map((l, i) => (
                  <div key={l.line} className="flex items-center justify-between">
                    <span className="text-sm font-medium">{i + 1}. {l.line}</span>
                    <span className="text-sm font-bold text-destructive">{formatMins(l.mins)}</span>
                  </div>
                ))}
                {!topLines.length && <p className="text-sm text-muted-foreground">No downtime data</p>}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" /> Most Recurring Problems
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {topProblems.map((p, i) => (
                  <div key={p.desc} className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium truncate">{i + 1}. {p.desc}</span>
                    <span className="text-sm font-bold shrink-0">{p.count}x</span>
                  </div>
                ))}
                {!topProblems.length && <p className="text-sm text-muted-foreground">No data</p>}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
