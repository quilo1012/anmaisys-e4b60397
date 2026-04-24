import { useState, useMemo } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Clock, Loader2, Plus, Pencil, Trash2, CheckCircle, AlertTriangle, Activity,
  TrendingUp, CalendarIcon, ChevronDown, History, Cog,
} from "lucide-react";
import { ShiftBreakdownCard } from "@/components/ShiftBreakdownCard";
import { useDowntime, useCreateDowntime, useUpdateDowntime, useDeleteDowntime, type DowntimeRecord } from "@/hooks/useDowntime";
import { useWorkOrders } from "@/hooks/useWorkOrders";
import { useMachines, useLines } from "@/hooks/useMachines";
import { useRecentMachineEvents } from "@/hooks/useMachineEvents";
import { useAllWoMetrics } from "@/hooks/useWoMetrics";
import { type RiskLevel } from "@/hooks/usePredictiveAlerts";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  format, differenceInMinutes, startOfDay, startOfWeek, startOfMonth,
  subDays, endOfDay,
} from "date-fns";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, LineChart, Line } from "recharts";

const CATEGORIES = ["Mechanical", "Electrical", "Machine", "Maintenance", "Filler", "Other"] as const;
const LINES = ["Line 1", "Line 2", "Line 3", "Line 4", "Line 5"] as const;

const riskBadge: Record<RiskLevel, { label: string; className: string }> = {
  HIGH: { label: "HIGH", className: "bg-red-100 text-red-800 border-red-200" },
  MEDIUM: { label: "MEDIUM", className: "bg-amber-100 text-amber-800 border-amber-200" },
  LOW: { label: "LOW", className: "bg-green-100 text-green-800 border-green-200" },
};

export default function DowntimePage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: records, isLoading } = useDowntime();
  const { data: workOrders } = useWorkOrders({ statusIn: ["open", "in_progress", "received", "arrived"] as any });
  const { data: allWOs } = useWorkOrders();
  const { data: machines } = useMachines();
  const { data: machineEvents } = useRecentMachineEvents();
  const { data: woMetrics = [] } = useAllWoMetrics();
  const createDowntime = useCreateDowntime();
  const updateDowntime = useUpdateDowntime();
  const deleteDowntime = useDeleteDowntime();

  const [showCreate, setShowCreate] = useState(false);
  const [editRecord, setEditRecord] = useState<DowntimeRecord | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Filters (shared)
  const [filterLine, setFilterLine] = useState("all");
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [startDate, setStartDate] = useState<Date>(startOfDay(subDays(new Date(), 30)));
  const [endDate, setEndDate] = useState<Date>(new Date());
  const [historyPeriod, setHistoryPeriod] = useState<"today" | "week" | "month">("today");

  // Form state
  const [formLine, setFormLine] = useState("");
  const [formMachine, setFormMachine] = useState("");
  const [formCategory, setFormCategory] = useState("");
  const [formReason, setFormReason] = useState("");
  const [formStartedAt, setFormStartedAt] = useState("");
  const [formEndedAt, setFormEndedAt] = useState("");
  const [formWOId, setFormWOId] = useState("");
  const [formNotes, setFormNotes] = useState("");

  const resetForm = () => {
    setFormLine(""); setFormMachine(""); setFormCategory(""); setFormReason("");
    setFormStartedAt(""); setFormEndedAt(""); setFormWOId(""); setFormNotes("");
  };

  const openCreate = () => { resetForm(); setShowCreate(true); };

  const openEdit = (r: DowntimeRecord) => {
    setEditRecord(r);
    setFormLine(r.line); setFormMachine(r.machine || ""); setFormCategory(r.category);
    setFormReason(r.reason); setFormStartedAt(r.started_at.slice(0, 16));
    setFormEndedAt(r.ended_at?.slice(0, 16) || ""); setFormWOId(r.work_order_id || "");
    setFormNotes(r.notes || "");
  };

  const handleSubmit = async (isEdit: boolean) => {
    const payload: any = {
      line: formLine, machine: formMachine || null, category: formCategory,
      reason: formReason, started_at: new Date(formStartedAt).toISOString(),
      ended_at: formEndedAt ? new Date(formEndedAt).toISOString() : null,
      work_order_id: (formWOId && formWOId !== "none") ? formWOId : null, notes: formNotes || null,
      reported_by: user?.id || null,
    };
    try {
      if (isEdit && editRecord) {
        await updateDowntime.mutateAsync({ id: editRecord.id, ...payload });
        toast({ title: "Downtime updated" });
        setEditRecord(null);
      } else {
        await createDowntime.mutateAsync(payload);
        toast({ title: "Downtime registered" });
        setShowCreate(false);
      }
      resetForm();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleResolve = async (id: string) => {
    try {
      await updateDowntime.mutateAsync({ id, ended_at: new Date().toISOString() });
      toast({ title: "Downtime resolved" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteDowntime.mutateAsync(deleteId);
      toast({ title: "Downtime deleted" });
      setDeleteId(null);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  // ── Downtime KPIs ─────────────────────────────────────────────
  const kpis = useMemo(() => {
    const now = new Date();
    const todayStart = startOfDay(now);
    const weekStart = startOfWeek(now, { weekStartsOn: 1 });
    const monthStart = startOfMonth(now);

    const safeRecords = records || [];

    // Manual downtime records started today
    const todayRecords = safeRecords.filter(r => new Date(r.started_at) >= todayStart);
    const manualTodayMin = todayRecords.reduce((sum, r) => {
      const end = r.ended_at ? new Date(r.ended_at) : now;
      return sum + differenceInMinutes(end, new Date(r.started_at));
    }, 0);

    // WO line-stops today (single source of truth: v_wo_metrics)
    const woTodayMin = woMetrics
      .filter(m => m.line_stopped_at && new Date(m.line_stopped_at) >= todayStart)
      .reduce((sum, m) => {
        if (m.line_downtime_sec != null) return sum + Math.round(m.line_downtime_sec / 60);
        // open stop: count from line_stopped_at until now
        return sum + differenceInMinutes(now, new Date(m.line_stopped_at!));
      }, 0);

    const totalToday = manualTodayMin + woTodayMin;

    const manualActive = safeRecords.filter(r => !r.ended_at).length;
    const woActive = woMetrics.filter(m => m.line_stopped_at && !m.line_resumed_at).length;
    const active = manualActive + woActive;

    const weekRecords = safeRecords.filter(r => new Date(r.started_at) >= weekStart && r.ended_at);
    const avgDuration = weekRecords.length
      ? Math.round(weekRecords.reduce((s, r) => s + differenceInMinutes(new Date(r.ended_at!), new Date(r.started_at)), 0) / weekRecords.length)
      : 0;

    const monthRecords = safeRecords.filter(r => new Date(r.started_at) >= monthStart);
    const lineCount: Record<string, number> = {};
    monthRecords.forEach(r => { lineCount[r.line] = (lineCount[r.line] || 0) + 1; });
    const mostAffected = Object.entries(lineCount).sort((a, b) => b[1] - a[1])[0]?.[0] || "—";

    return { totalToday, active, avgDuration, mostAffected };
  }, [records, woMetrics]);

  const filteredRecords = useMemo(() => {
    if (!records) return [];
    const from = startOfDay(startDate).getTime();
    const to = endOfDay(endDate).getTime();
    return records.filter(r => {
      const t = new Date(r.started_at).getTime();
      if (t < from || t > to) return false;
      if (filterLine !== "all" && r.line !== filterLine) return false;
      if (filterCategory !== "all" && r.category !== filterCategory) return false;
      if (filterStatus === "active" && r.ended_at) return false;
      if (filterStatus === "resolved" && !r.ended_at) return false;
      return true;
    });
  }, [records, filterLine, filterCategory, filterStatus, startDate, endDate]);

  const getDuration = (r: DowntimeRecord) => {
    const end = r.ended_at ? new Date(r.ended_at) : new Date();
    const mins = differenceInMinutes(end, new Date(r.started_at));
    if (mins < 60) return `${mins}min`;
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  };

  // ── Reliability section (WO-based) ────────────────────────────
  const filteredWOs = useMemo(() => {
    if (!allWOs) return [];
    return allWOs.filter((wo) => {
      const d = new Date(wo.created_at);
      if (d < startDate || d > endOfDay(endDate)) return false;
      return true;
    });
  }, [allWOs, startDate, endDate]);

  const machineHistory = useMemo(() => {
    if (!allWOs) return [];
    const now = new Date();
    const todayStart = startOfDay(now);
    const weekStart = startOfWeek(now, { weekStartsOn: 1 });
    const monthStart = startOfMonth(now);

    const machineMap: Record<string, { today: number; week: number; month: number; problems: Record<string, number> }> = {};

    allWOs.forEach((wo) => {
      const d = new Date(wo.created_at);
      if (!machineMap[wo.machine]) machineMap[wo.machine] = { today: 0, week: 0, month: 0, problems: {} };
      const entry = machineMap[wo.machine];
      if (d >= monthStart) {
        entry.month++;
        entry.problems[wo.description] = (entry.problems[wo.description] || 0) + 1;
      }
      if (d >= weekStart) entry.week++;
      if (d >= todayStart) entry.today++;
    });

    return Object.entries(machineMap)
      .map(([machine, data]) => {
        const topProblem = Object.entries(data.problems).sort((a, b) => b[1] - a[1])[0];
        return {
          machine,
          today: data.today, week: data.week, month: data.month,
          topProblem: topProblem ? topProblem[0] : "—",
          topProblemCount: topProblem ? topProblem[1] : 0,
        };
      })
      .sort((a, b) => b[historyPeriod] - a[historyPeriod])
      .filter((m) => m[historyPeriod] > 0);
  }, [allWOs, historyPeriod]);

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

      let mtbfHours: number | null = null;
      if (sorted.length >= 2) {
        const gaps: number[] = [];
        for (let i = 1; i < sorted.length; i++) {
          gaps.push((new Date(sorted[i].created_at).getTime() - new Date(sorted[i - 1].created_at).getTime()) / 3600000);
        }
        mtbfHours = Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
      }

      const lastFailureDate = sorted[sorted.length - 1]?.created_at;
      const hoursSinceLast = lastFailureDate ? (now.getTime() - new Date(lastFailureDate).getTime()) / 3600000 : null;
      const mtbfWarning = mtbfHours !== null && hoursSinceLast !== null && hoursSinceLast >= mtbfHours * 0.8;
      const recentRepairAlert = lastFailureDate ? (now.getTime() - new Date(lastFailureDate).getTime()) / 86400000 < 5 : false;

      const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000);
      const recentWOs = wos.filter((w) => new Date(w.created_at) >= sevenDaysAgo);
      const problemCounts: Record<string, number> = {};
      recentWOs.forEach((w) => { problemCounts[w.description] = (problemCounts[w.description] || 0) + 1; });
      const recurringProblems = Object.entries(problemCounts).filter(([, c]) => c >= 3).map(([p]) => p);

      let risk: RiskLevel = "LOW";
      if (recurringProblems.length > 0 || (recentRepairAlert && failures >= 3) || mtbfWarning) risk = "HIGH";
      else if (failures >= 2 || recentRepairAlert) risk = "MEDIUM";

      return {
        machine, risk, failures30d: failures, mtbfHours, mtbfWarning, recentRepairAlert, recurringProblems,
        lastFailure: lastFailureDate || null,
      };
    }).sort((a, b) => {
      const order: Record<RiskLevel, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
      return (order[a.risk] - order[b.risk]) || (b.failures30d - a.failures30d);
    });
  }, [filteredWOs]);

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

  const topProblemMachines = useMemo(() => {
    const counts: Record<string, number> = {};
    filteredWOs.forEach((w) => { counts[w.machine] = (counts[w.machine] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([name, count]) => ({ name: name.length > 15 ? name.slice(0, 15) + "…" : name, fullName: name, count }));
  }, [filteredWOs]);

  const failureTrend = useMemo(() => {
    const dayMap: Record<string, number> = {};
    filteredWOs.forEach((w) => {
      const day = format(new Date(w.created_at), "MM/dd");
      dayMap[day] = (dayMap[day] || 0) + 1;
    });
    return Object.entries(dayMap).map(([date, count]) => ({ date, count }));
  }, [filteredWOs]);

  const getEventsForMachine = (machineName: string) => {
    if (!machineEvents || !machines) return [];
    const m = machines.find((x) => x.name === machineName);
    if (!m) return [];
    return machineEvents.filter((e) => e.machine_id === m.id).slice(0, 10);
  };

  const formFieldsJsx = (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Line *</Label>
          <Input value={formLine} onChange={e => setFormLine(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Machine</Label>
          <Input value={formMachine} onChange={e => setFormMachine(e.target.value)} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Category *</Label>
          <Input value={formCategory} onChange={e => setFormCategory(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Reason *</Label>
          <Input value={formReason} onChange={e => setFormReason(e.target.value)} required />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Start Time *</Label>
          <Input type="datetime-local" value={formStartedAt} onChange={e => setFormStartedAt(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>End Time</Label>
          <Input type="datetime-local" value={formEndedAt} onChange={e => setFormEndedAt(e.target.value)} />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Link to Work Order</Label>
        <Select value={formWOId || undefined} onValueChange={setFormWOId}>
          <SelectTrigger><SelectValue placeholder="" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None</SelectItem>
            {workOrders?.map(wo => (
              <SelectItem key={wo.id} value={wo.id}>WO-{wo.wo_number} — {wo.machine}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Notes</Label>
        <Textarea value={formNotes} onChange={e => setFormNotes(e.target.value)} rows={2} />
      </div>
    </div>
  );

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-2"><Clock className="h-6 w-6" /> Downtime & Reliability</h2>
            <p className="text-muted-foreground">Production stoppages, MTBF/MTTR & machine risk intelligence</p>
          </div>
          <div className="flex items-center gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1">
                  <CalendarIcon className="h-4 w-4" />
                  {format(startDate, "dd/MM")} – {format(endDate, "dd/MM")}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 z-50 bg-popover" align="end">
                <Calendar
                  mode="range"
                  selected={{ from: startDate, to: endDate }}
                  onSelect={(range) => {
                    if (range?.from) setStartDate(startOfDay(range.from));
                    if (range?.to) setEndDate(endOfDay(range.to));
                  }}
                  numberOfMonths={2}
                  initialFocus
                  className="p-3 pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
            <Button className="bg-orange-600 hover:bg-orange-700 text-white" onClick={openCreate}>
              <Plus className="h-4 w-4 mr-2" /> Register Downtime
            </Button>
          </div>
        </div>

        {/* Top KPIs: Downtime focused */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Downtime Today</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{kpis.totalToday < 60 ? `${kpis.totalToday}min` : `${Math.floor(kpis.totalToday / 60)}h ${kpis.totalToday % 60}m`}</div>
            </CardContent>
          </Card>
          <Card className={kpis.active > 0 ? "border-destructive" : ""}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Active Stoppages</CardTitle>
              <AlertTriangle className={`h-4 w-4 ${kpis.active > 0 ? "text-destructive" : "text-muted-foreground"}`} />
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${kpis.active > 0 ? "text-destructive" : ""}`}>{kpis.active}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Avg Duration (Week)</CardTitle>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{kpis.avgDuration}min</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Most Affected Line</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{kpis.mostAffected}</div>
            </CardContent>
          </Card>
        </div>

        {/* Day / Night shift breakdown (Europe/London) */}
        <ShiftBreakdownCard />

        {/* Reliability KPIs */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold">{avgMTTR} min</div>
              <p className="text-xs text-muted-foreground">Avg MTTR (Period)</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold">{avgMTBF} hrs</div>
              <p className="text-xs text-muted-foreground">Avg MTBF (Period)</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold">{filteredWOs.length}</div>
              <p className="text-xs text-muted-foreground">WOs (Period)</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold">{filteredRisks.filter((r) => r.risk === "HIGH").length}</div>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <AlertTriangle className="h-3 w-3 text-red-500" />High Risk Machines
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Filters + Downtime records */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className="text-base">Downtime Records</CardTitle>
              <div className="flex items-center gap-2 flex-wrap">
                <Select value={filterLine} onValueChange={setFilterLine}>
                  <SelectTrigger className="w-[140px]"><SelectValue placeholder="Line" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Lines</SelectItem>
                    {LINES.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={filterCategory} onValueChange={setFilterCategory}>
                  <SelectTrigger className="w-[160px]"><SelectValue placeholder="Category" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Categories</SelectItem>
                    {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={filterStatus} onValueChange={setFilterStatus}>
                  <SelectTrigger className="w-[140px]"><SelectValue placeholder="Status" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="resolved">Resolved</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : !filteredRecords.length ? (
              <div className="text-center py-12">
                <Clock className="h-12 w-12 mx-auto text-muted-foreground/40 mb-3" />
                <p className="text-muted-foreground font-medium">No downtime records found</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Line</TableHead>
                    <TableHead>Machine</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Started</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRecords.map(r => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.line}</TableCell>
                      <TableCell>{r.machine || "—"}</TableCell>
                      <TableCell><Badge variant="outline">{r.category}</Badge></TableCell>
                      <TableCell className="max-w-[200px] truncate">{r.reason}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{format(new Date(r.started_at), "dd/MM HH:mm")}</TableCell>
                      <TableCell className="font-mono text-sm">{getDuration(r)}</TableCell>
                      <TableCell>
                        {r.ended_at ? (
                          <Badge className="bg-green-100 text-green-800 border-green-200">Resolved</Badge>
                        ) : (
                          <Badge className="bg-red-100 text-red-800 border-red-200">Active</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button size="icon" variant="ghost" onClick={() => openEdit(r)}><Pencil className="h-4 w-4" /></Button>
                          {!r.ended_at && (
                            <Button size="icon" variant="ghost" className="text-green-600" onClick={() => handleResolve(r.id)} title="Mark Resolved">
                              <CheckCircle className="h-4 w-4" />
                            </Button>
                          )}
                          <Button size="icon" variant="ghost" className="text-destructive" onClick={() => setDeleteId(r.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Machine Problem History */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2"><History className="h-5 w-5" />Machine Problem History</CardTitle>
              <Tabs value={historyPeriod} onValueChange={(v) => setHistoryPeriod(v as "today" | "week" | "month")}>
                <TabsList>
                  <TabsTrigger value="today">Today</TabsTrigger>
                  <TabsTrigger value="week">This Week</TabsTrigger>
                  <TabsTrigger value="month">This Month</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </CardHeader>
          <CardContent>
            {machineHistory.length === 0 ? (
              <p className="text-muted-foreground text-center py-4">No problems recorded for this period</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Machine</TableHead>
                    <TableHead className="text-center">Today</TableHead>
                    <TableHead className="text-center">Week</TableHead>
                    <TableHead className="text-center">Month</TableHead>
                    <TableHead>Top Problem</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {machineHistory.map((m, i) => (
                    <TableRow key={m.machine}>
                      <TableCell className="font-medium text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="font-medium">{m.machine}</TableCell>
                      <TableCell className="text-center"><Badge variant={m.today > 0 ? "destructive" : "secondary"}>{m.today}</Badge></TableCell>
                      <TableCell className="text-center"><Badge variant={m.week >= 3 ? "destructive" : "secondary"}>{m.week}</Badge></TableCell>
                      <TableCell className="text-center"><Badge variant={m.month >= 5 ? "destructive" : "secondary"}>{m.month}</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground truncate max-w-[200px]" title={m.topProblem}>
                        {m.topProblem} {m.topProblemCount > 1 && <span className="text-xs">(×{m.topProblemCount})</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Machine Risk Assessment */}
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
        <div className="grid gap-4 md:grid-cols-2">
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

        {/* Create Dialog */}
        <Dialog open={showCreate} onOpenChange={o => { setShowCreate(o); if (!o) resetForm(); }}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Register Downtime</DialogTitle>
              <DialogDescription className="sr-only">Fill in the details to register a new downtime event</DialogDescription>
            </DialogHeader>
            {formFieldsJsx}
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button onClick={() => handleSubmit(false)} disabled={!formLine || !formCategory || !formReason || !formStartedAt || createDowntime.isPending}>
                {createDowntime.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Register
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit Dialog */}
        <Dialog open={!!editRecord} onOpenChange={o => { if (!o) { setEditRecord(null); resetForm(); } }}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Edit Downtime</DialogTitle>
              <DialogDescription className="sr-only">Edit the details of this downtime record</DialogDescription>
            </DialogHeader>
            {formFieldsJsx}
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditRecord(null)}>Cancel</Button>
              <Button onClick={() => handleSubmit(true)} disabled={!formLine || !formCategory || !formReason || !formStartedAt || updateDowntime.isPending}>
                {updateDowntime.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation */}
        <AlertDialog open={!!deleteId} onOpenChange={o => { if (!o) setDeleteId(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete downtime record?</AlertDialogTitle>
              <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </DashboardLayout>
  );
}
