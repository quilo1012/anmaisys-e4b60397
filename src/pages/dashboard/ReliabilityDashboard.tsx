import { useState, useMemo } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Activity, AlertTriangle, Clock, Cog, CalendarIcon, ChevronDown, TrendingUp } from "lucide-react";
import { useWorkOrders } from "@/hooks/useWorkOrders";
import { useMachines } from "@/hooks/useMachines";
import { type RiskLevel } from "@/hooks/usePredictiveAlerts";
import { useRecentMachineEvents } from "@/hooks/useMachineEvents";
import { format, subDays, differenceInMinutes, endOfDay } from "date-fns";
import { cn } from "@/lib/utils";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, LineChart, Line } from "recharts";

const riskBadge: Record<RiskLevel, { label: string; className: string }> = {
  HIGH: { label: "HIGH", className: "bg-red-100 text-red-800 border-red-200" },
  MEDIUM: { label: "MEDIUM", className: "bg-amber-100 text-amber-800 border-amber-200" },
  LOW: { label: "LOW", className: "bg-green-100 text-green-800 border-green-200" },
};

export default function ReliabilityDashboard() {
  const [startDate, setStartDate] = useState<Date>(subDays(new Date(), 30));
  const [endDate, setEndDate] = useState<Date>(new Date());
  const [filterMachine, setFilterMachine] = useState("");
  const [filterLine, setFilterLine] = useState("");

  const { data: allWOs } = useWorkOrders();
  const { data: machines } = useMachines();
  const { data: machineEvents } = useRecentMachineEvents();

  // Filter WOs by date range
  const filteredWOs = useMemo(() => {
    if (!allWOs) return [];
    return allWOs.filter((wo) => {
      const d = new Date(wo.created_at);
      if (d < startDate || d > endOfDay(endDate)) return false;
      if (filterMachine && wo.machine !== filterMachine) return false;
      if (filterLine && machines) {
        const m = machines.find((mac) => mac.name === wo.machine);
        if (!m || m.line !== filterLine) return false;
      }
      return true;
    });
  }, [allWOs, startDate, endDate, filterMachine, filterLine, machines]);

  // Compute risks locally from filteredWOs so date range applies
  const filteredRisks = useMemo(() => {
    if (!filteredWOs.length) return [];
    const now = new Date();
    const machineMap: Record<string, typeof filteredWOs> = {};
    filteredWOs.forEach((wo) => {
      if (!machineMap[wo.machine]) machineMap[wo.machine] = [];
      machineMap[wo.machine].push(wo);
    });

    return Object.entries(machineMap).map(([machine, wos]) => {
      const failures = wos.length;
      const sorted = [...wos].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      
      // MTBF
      let mtbfHours: number | null = null;
      if (sorted.length >= 2) {
        const gaps: number[] = [];
        for (let i = 1; i < sorted.length; i++) {
          gaps.push((new Date(sorted[i].created_at).getTime() - new Date(sorted[i - 1].created_at).getTime()) / 3600000);
        }
        mtbfHours = Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
      }

      // MTBF warning
      const lastFailureDate = sorted[sorted.length - 1]?.created_at;
      const hoursSinceLast = lastFailureDate ? (now.getTime() - new Date(lastFailureDate).getTime()) / 3600000 : null;
      const mtbfWarning = mtbfHours !== null && hoursSinceLast !== null && hoursSinceLast >= mtbfHours * 0.8;

      // Recent repair alert
      const recentRepairAlert = lastFailureDate ? (now.getTime() - new Date(lastFailureDate).getTime()) / 86400000 < 5 : false;

      // Recurring problems (≥3 in 7 days)
      const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000);
      const recentWOs = wos.filter((w) => new Date(w.created_at) >= sevenDaysAgo);
      const problemCounts: Record<string, number> = {};
      recentWOs.forEach((w) => { problemCounts[w.description] = (problemCounts[w.description] || 0) + 1; });
      const recurringProblems = Object.entries(problemCounts).filter(([, c]) => c >= 3).map(([p]) => p);

      // Risk level
      let risk: RiskLevel = "LOW";
      if (recurringProblems.length > 0 || (recentRepairAlert && failures >= 3) || mtbfWarning) risk = "HIGH";
      else if (failures >= 2 || recentRepairAlert) risk = "MEDIUM";

      return {
        machine,
        risk,
        failures30d: failures,
        mtbfHours,
        mtbfWarning,
        recentRepairAlert,
        recurringProblems,
        lastFailure: lastFailureDate || null,
      };
    }).sort((a, b) => {
      const order: Record<RiskLevel, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
      return (order[a.risk] - order[b.risk]) || (b.failures30d - a.failures30d);
    });
  }, [filteredWOs]);

  // KPIs
  const totalMachines = machines?.length || 0;
  const totalWOs = filteredWOs.length;

  const avgMTTR = useMemo(() => {
    const finished = filteredWOs.filter((w) => w.started_at && w.finished_at);
    if (!finished.length) return 0;
    const total = finished.reduce((sum, w) => sum + differenceInMinutes(new Date(w.finished_at!), new Date(w.started_at!)), 0);
    return Math.round(total / finished.length);
  }, [filteredWOs]);

  const avgMTBF = useMemo(() => {
    const vals = filteredRisks.filter((r) => r.mtbfHours !== null).map((r) => r.mtbfHours!);
    if (!vals.length) return 0;
    return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  }, [filteredRisks]);

  // Top 5 problem machines
  const topProblemMachines = useMemo(() => {
    const counts: Record<string, number> = {};
    filteredWOs.forEach((w) => { counts[w.machine] = (counts[w.machine] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name: name.length > 15 ? name.slice(0, 15) + "…" : name, fullName: name, count }));
  }, [filteredWOs]);

  // Most common problems
  const commonProblems = useMemo(() => {
    const counts: Record<string, number> = {};
    filteredWOs.forEach((w) => { counts[w.description] = (counts[w.description] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name: name.length > 20 ? name.slice(0, 20) + "…" : name, fullName: name, count }));
  }, [filteredWOs]);

  // Failure trend (daily)
  const failureTrend = useMemo(() => {
    const dayMap: Record<string, number> = {};
    filteredWOs.forEach((w) => {
      const day = format(new Date(w.created_at), "MM/dd");
      dayMap[day] = (dayMap[day] || 0) + 1;
    });
    return Object.entries(dayMap).map(([date, count]) => ({ date, count }));
  }, [filteredWOs]);

  // Lines for filter
  const lines = useMemo(() => {
    if (!machines) return [];
    const s = new Set<string>();
    machines.forEach((m) => { if (m.line) s.add(m.line); });
    return Array.from(s).sort();
  }, [machines]);

  // Events for a machine
  const getEventsForMachine = (machineName: string) => {
    if (!machineEvents || !machines) return [];
    const m = machines.find((x) => x.name === machineName);
    if (!m) return [];
    return machineEvents.filter((e) => e.machine_id === m.id).slice(0, 10);
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-2">
              <Activity className="h-6 w-6" />
              Reliability Dashboard
            </h2>
            <p className="text-muted-foreground">Machine health, risk analysis & failure intelligence</p>
          </div>
          {/* Filters */}
          <div className="flex flex-wrap gap-2 items-center">
            <Select value={filterLine} onValueChange={(v) => { setFilterLine(v === "all" ? "" : v); setFilterMachine(""); }}>
              <SelectTrigger className="w-[140px]"><SelectValue placeholder="All Lines" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Lines</SelectItem>
                {lines.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterMachine} onValueChange={(v) => setFilterMachine(v === "all" ? "" : v)}>
              <SelectTrigger className="w-[160px]"><SelectValue placeholder="All Machines" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Machines</SelectItem>
                {machines?.filter((m) => !filterLine || m.line === filterLine).map((m) => (
                  <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1">
                  <CalendarIcon className="h-4 w-4" />
                  {format(startDate, "dd/MM")} – {format(endDate, "dd/MM")}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar mode="range" selected={{ from: startDate, to: endDate }} onSelect={(range) => { if (range?.from) setStartDate(range.from); if (range?.to) setEndDate(range.to); }} numberOfMonths={2} />
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid gap-4 md:grid-cols-5">
          <Card><CardContent className="p-4"><div className="text-2xl font-bold">{totalMachines}</div><p className="text-xs text-muted-foreground">Total Machines</p></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-2xl font-bold">{totalWOs}</div><p className="text-xs text-muted-foreground">WOs (Period)</p></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-2xl font-bold">{filteredRisks.filter((r) => r.risk === "HIGH").length}</div><p className="text-xs text-muted-foreground flex items-center gap-1"><AlertTriangle className="h-3 w-3 text-red-500" />High Risk</p></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-2xl font-bold">{avgMTTR} min</div><p className="text-xs text-muted-foreground">Avg MTTR</p></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-2xl font-bold">{avgMTBF} hrs</div><p className="text-xs text-muted-foreground">Avg MTBF</p></CardContent></Card>
        </div>

        {/* Machine Risk Table */}
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Cog className="h-5 w-5" />Machine Risk Assessment</CardTitle></CardHeader>
          <CardContent>
            {filteredRisks.length === 0 ? (
              <p className="text-muted-foreground text-center py-4">No data for selected period</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Machine</TableHead>
                    <TableHead>Failures</TableHead>
                    <TableHead>MTBF (hrs)</TableHead>
                    <TableHead>Risk</TableHead>
                    <TableHead>Last Failure</TableHead>
                    <TableHead>Alerts</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRisks.map((r) => (
                    <Collapsible key={r.machine} asChild>
                      <>
                        <TableRow>
                          <TableCell className="font-medium">{r.machine}</TableCell>
                          <TableCell>{r.failures30d}</TableCell>
                          <TableCell>{r.mtbfHours ?? "—"}</TableCell>
                          <TableCell><Badge variant="outline" className={riskBadge[r.risk].className}>{riskBadge[r.risk].label}</Badge></TableCell>
                          <TableCell className="text-sm text-muted-foreground">{r.lastFailure ? format(new Date(r.lastFailure), "dd/MM HH:mm") : "—"}</TableCell>
                          <TableCell>
                            <div className="flex gap-1 flex-wrap">
                              {r.mtbfWarning && <Badge variant="outline" className="text-xs bg-orange-100 text-orange-800 border-orange-200">MTBF Warning</Badge>}
                              {r.recentRepairAlert && <Badge variant="outline" className="text-xs bg-blue-100 text-blue-800 border-blue-200">Recent Repair</Badge>}
                              {r.recurringProblems.length > 0 && <Badge variant="outline" className="text-xs bg-red-100 text-red-800 border-red-200">Recurring</Badge>}
                            </div>
                          </TableCell>
                          <TableCell>
                            <CollapsibleTrigger asChild>
                              <Button variant="ghost" size="sm"><ChevronDown className="h-4 w-4" /></Button>
                            </CollapsibleTrigger>
                          </TableCell>
                        </TableRow>
                        <CollapsibleContent asChild>
                          <TableRow className="bg-muted/30">
                            <TableCell colSpan={7}>
                              <div className="p-2 space-y-1">
                                <p className="text-sm font-medium">Last 10 Events</p>
                                {getEventsForMachine(r.machine).length === 0 ? (
                                  <p className="text-xs text-muted-foreground">No events recorded yet</p>
                                ) : (
                                  <div className="space-y-1">
                                    {getEventsForMachine(r.machine).map((ev) => (
                                      <div key={ev.id} className="flex gap-3 text-xs items-center">
                                        <span className="text-muted-foreground w-[90px]">{format(new Date(ev.created_at), "dd/MM HH:mm")}</span>
                                        <Badge variant="secondary" className="text-xs">{ev.event_type}</Badge>
                                        <span className="truncate">{ev.problem_description || "—"}</span>
                                        {ev.engineer_name && <span className="text-muted-foreground">by {ev.engineer_name}</span>}
                                      </div>
                                    ))}
                                  </div>
                                )}
                                {r.recurringProblems.length > 0 && (
                                  <div className="mt-2">
                                    <p className="text-xs font-medium text-red-700">Recurring Problems (≥3 in 7 days):</p>
                                    {r.recurringProblems.map((p) => <Badge key={p} variant="outline" className="text-xs mr-1 bg-red-50 text-red-700">{p}</Badge>)}
                                  </div>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        </CollapsibleContent>
                      </>
                    </Collapsible>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Charts */}
        <div className="grid gap-4 md:grid-cols-3">
          {/* Top 5 Problem Machines */}
          <Card>
            <CardHeader><CardTitle className="text-sm">Top Problem Machines</CardTitle></CardHeader>
            <CardContent className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topProblemMachines} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number) => [v, "WOs"]} />
                  <Bar dataKey="count" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Most Common Problems */}
          <Card>
            <CardHeader><CardTitle className="text-sm">Most Common Problems</CardTitle></CardHeader>
            <CardContent className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={commonProblems} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number) => [v, "Occurrences"]} />
                  <Bar dataKey="count" fill="hsl(var(--destructive))" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Failure Trend */}
          <Card>
            <CardHeader><CardTitle className="text-sm flex items-center gap-1"><TrendingUp className="h-4 w-4" />Failure Trend</CardTitle></CardHeader>
            <CardContent className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={failureTrend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis />
                  <Tooltip />
                  <Line type="monotone" dataKey="count" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
