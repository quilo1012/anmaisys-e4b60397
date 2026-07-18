import { useMemo, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useWorkOrders } from "@/hooks/useWorkOrders";
import { useMachines } from "@/hooks/useMachines";
import { useEngineerScores } from "@/hooks/useEngineerScores";
import { useMaintenanceKpis } from "@/hooks/useMaintenanceKpis";
import { differenceInMinutes, subDays, format, startOfDay } from "date-fns";
import { Button } from "@/components/ui/button";
import { Maximize, Minimize, AlertTriangle, Clock, Gauge, ShieldCheck, Activity, Trophy, BarChart3, TrendingDown, LineChart, DollarSign } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell } from "recharts";
import { countOpenWOs } from "@/lib/woStatus";
import { DateRangePreset, DateRange, getPresetRange } from "@/components/DateRangeFilter";
import { SLA_TARGETS } from "@/lib/sla";
import { ReportsFilterBar } from "@/components/reports/ReportsFilterBar";
import { KpiCard } from "@/components/reports/KpiCard";

export default function ExecutiveDashboard() {
  const { data: workOrders = [] } = useWorkOrders();
  const { data: machines = [] } = useMachines();
  const { data: engineerScores = [] } = useEngineerScores();
  const [kpiPreset, setKpiPreset] = useState<DateRangePreset>("today");
  const [kpiRange, setKpiRange] = useState<DateRange>(() => getPresetRange("today"));
  const [shiftFilter, setShiftFilter] = useState<"ALL" | "DAY" | "NIGHT">("ALL");
  const { data: woMetrics = [] } = useAllWoMetrics({ from: kpiRange.from, to: kpiRange.to });
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
    const closedWOs = filteredWOs.filter((w) => ["closed", "completed"].includes(w.status) && w.received_at);
    const withinSLA = closedWOs.filter((w) => {
      const target = SLA_TARGETS[w.priority || "medium"] || 60;
      return differenceInMinutes(new Date(w.received_at!), new Date(w.created_at)) <= target;
    }).length;
    const slaPercent = closedWOs.length ? Math.round((withinSLA / closedWOs.length) * 100) : 100;

    const machinesAtRisk = machines.filter((m) => m.health_score < 40).length;

    return { openWOs, avgResponse, avgMTTR, slaPercent, machinesAtRisk };
  }, [workOrders, filteredWOs, machines, woMetrics, inShift]);

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

        <ReportsFilterBar
          dateRange={kpiRange}
          datePreset={kpiPreset}
          onDateChange={(r, p) => { setKpiRange(r); setKpiPreset(p); }}
          shift={shiftFilter}
          onShiftChange={setShiftFilter}
          storageKey="executive-dashboard"
        >
          <span className="text-xs text-muted-foreground">KPI period filter</span>
        </ReportsFilterBar>

        {/* KPI Grid */}
        <div className="grid gap-3 sm:gap-4 grid-cols-1 xs:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 [&_p.text-3xl]:text-2xl [&_p.text-3xl]:sm:text-3xl">
          <KpiCard
            accent="blue"
            icon={<Activity className="h-4 w-4" />}
            label="Open WOs"
            value={kpis.openWOs}
          />
          <KpiCard
            accent="indigo"
            icon={<Clock className="h-4 w-4" />}
            label="Avg Response Time"
            value={formatMins(kpis.avgResponse)}
            sublabel="created → accepted"
          />
          <KpiCard
            accent="amber"
            icon={<Gauge className="h-4 w-4" />}
            label="Avg Active Repair"
            value={formatMins(kpis.avgMTTR)}
            sublabel="MTTR — pauses excluded"
          />
          <KpiCard
            accent="green"
            icon={<ShieldCheck className="h-4 w-4" />}
            label="SLA Compliance"
            value={`${kpis.slaPercent}%`}
          />
          <KpiCard
            accent={kpis.machinesAtRisk > 0 ? "red" : "green"}
            icon={<AlertTriangle className="h-4 w-4" />}
            label="Machines at Risk"
            value={kpis.machinesAtRisk}
          />
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

        {/* Downtime & Reliability shortcut — details live on the dedicated page */}
        <Link to="/dashboard/downtime" className="block">
          <Card className="hover:border-primary transition-colors">
            <CardContent className="pt-4 pb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <TrendingDown className="h-5 w-5 text-destructive" />
                <div>
                  <p className="text-sm font-semibold">Downtime & Reliability</p>
                  <p className="text-xs text-muted-foreground">Most impacted lines, recurring problems and totals — open the dedicated page.</p>
                </div>
              </div>
              <span className="text-xs font-medium text-primary">Open →</span>
            </CardContent>
          </Card>
        </Link>
      </div>
    </DashboardLayout>
  );
}
