import { useMemo, useState, useCallback } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useWorkOrders } from "@/hooks/useWorkOrders";
import { useMachines } from "@/hooks/useMachines";
import { useEngineerScores } from "@/hooks/useEngineerScores";
import { useAllWoMetrics } from "@/hooks/useWoMetrics";
import { differenceInMinutes, subDays, format, startOfDay } from "date-fns";
import { Button } from "@/components/ui/button";
import { Maximize, Minimize, AlertTriangle, Clock, Gauge, ShieldCheck, Timer, Activity, Trophy, TrendingUp, BarChart3 } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell } from "recharts";

export default function ExecutiveDashboard() {
  const { data: workOrders = [] } = useWorkOrders();
  const { data: machines = [] } = useMachines();
  const { data: engineerScores = [] } = useEngineerScores();
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

  const kpis = useMemo(() => {
    const openWOs = workOrders.filter((w) => !["closed", "completed", "force_closed"].includes(w.status)).length;

    const completedWOs = workOrders.filter((w) => w.received_at);
    const avgResponse = completedWOs.length
      ? Math.round(completedWOs.reduce((s, w) => s + differenceInMinutes(new Date(w.received_at!), new Date(w.created_at)), 0) / completedWOs.length)
      : 0;

    const repairedWOs = workOrders.filter((w) => w.started_at && (w.finished_at || w.completed_at));
    const avgMTTR = repairedWOs.length
      ? Math.round(repairedWOs.reduce((s, w) => s + differenceInMinutes(new Date(w.finished_at || w.completed_at!), new Date(w.started_at!)), 0) / repairedWOs.length)
      : 0;

    const slaTargets: Record<string, number> = { critical: 10, high: 30, medium: 60, low: 120 };
    const closedWOs = workOrders.filter((w) => ["closed", "completed"].includes(w.status) && w.received_at);
    const withinSLA = closedWOs.filter((w) => {
      const target = slaTargets[w.priority || "medium"] || 60;
      return differenceInMinutes(new Date(w.received_at!), new Date(w.created_at)) <= target;
    }).length;
    const slaPercent = closedWOs.length ? Math.round((withinSLA / closedWOs.length) * 100) : 100;

    const today = startOfDay(new Date());
    const todayWOs = workOrders.filter((w) => new Date(w.created_at) >= today && w.started_at && (w.finished_at || w.completed_at));
    const totalDowntime = todayWOs.reduce((s, w) => s + differenceInMinutes(new Date(w.finished_at || w.completed_at!), new Date(w.started_at!)), 0);

    const machinesAtRisk = machines.filter((m) => m.health_score < 40).length;

    return { openWOs, avgResponse, avgMTTR, slaPercent, totalDowntime, machinesAtRisk };
  }, [workOrders, machines]);

  // WOs per day (last 7 days)
  const wosPerDay = useMemo(() => {
    const days: { label: string; count: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const day = subDays(new Date(), i);
      const dayStart = startOfDay(day);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);
      const count = workOrders.filter((w) => {
        const d = new Date(w.created_at);
        return d >= dayStart && d < dayEnd;
      }).length;
      days.push({ label: format(day, "EEE"), count });
    }
    return days;
  }, [workOrders]);

  // Top 3 lines by downtime
  const topLines = useMemo(() => {
    const lineMap: Record<string, number> = {};
    workOrders.forEach((w) => {
      if (w.started_at && (w.finished_at || w.completed_at)) {
        const machine = machines.find((m) => m.name === w.machine);
        const line = machine?.line || "Unknown";
        const mins = differenceInMinutes(new Date(w.finished_at || w.completed_at!), new Date(w.started_at!));
        lineMap[line] = (lineMap[line] || 0) + mins;
      }
    });
    return Object.entries(lineMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([line, mins]) => ({ line, mins }));
  }, [workOrders, machines]);

  // Top 3 recurring problems
  const topProblems = useMemo(() => {
    const probMap: Record<string, number> = {};
    workOrders.forEach((w) => {
      probMap[w.description] = (probMap[w.description] || 0) + 1;
    });
    return Object.entries(probMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([desc, count]) => ({ desc, count }));
  }, [workOrders]);

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
                <span className="text-xs font-medium">Avg Response</span>
              </div>
              <p className="text-3xl font-bold">{formatMins(kpis.avgResponse)}</p>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-amber-500">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <Gauge className="h-4 w-4" />
                <span className="text-xs font-medium">Avg MTTR</span>
              </div>
              <p className="text-3xl font-bold">{formatMins(kpis.avgMTTR)}</p>
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
                <span className="text-xs font-medium">Downtime Today</span>
              </div>
              <p className="text-3xl font-bold">{formatMins(kpis.totalDowntime)}</p>
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
                <BarChart3 className="h-4 w-4" /> Work Orders — Last 7 Days
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
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
