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
import { DateRangeFilter, type DateRangePreset, getPresetRange } from "@/components/DateRangeFilter";
import { useDowntime, useCreateDowntime, useUpdateDowntime, useDeleteDowntime, type DowntimeRecord } from "@/hooks/useDowntime";
import { useWorkOrders } from "@/hooks/useWorkOrders";
import { useMachines, useLines } from "@/hooks/useMachines";
import { useRecentMachineEvents } from "@/hooks/useMachineEvents";
import { type RiskLevel } from "@/hooks/usePredictiveAlerts";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  format, differenceInMinutes, startOfDay, startOfWeek, startOfMonth,
  subDays, endOfDay,
} from "date-fns";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, LineChart, Line } from "recharts";
import { useNavigate } from "react-router-dom";
import { reconcileMinutes } from "@/lib/downtimeReconcile";
import { filterWOsByRange, buildMachineHistory, buildMachineRisks } from "@/lib/downtimeReliability";

const CATEGORIES = ["Mechanical", "Electrical", "Machine", "Maintenance", "Filler", "Other"] as const;
const LINES = ["Line 1", "Line 2", "Line 3", "Line 4", "Line 5"] as const;

const riskBadge: Record<RiskLevel, { label: string; className: string }> = {
  HIGH: { label: "HIGH", className: "bg-red-100 text-red-800 border-red-200" },
  MEDIUM: { label: "MEDIUM", className: "bg-amber-100 text-amber-800 border-amber-200" },
  LOW: { label: "LOW", className: "bg-green-100 text-green-800 border-green-200" },
};

export default function DowntimePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { data: records, isLoading } = useDowntime();
  const { data: workOrders } = useWorkOrders({ statusIn: ["open", "in_progress", "received", "arrived"] as any });
  const { data: allWOs } = useWorkOrders();
  const { data: machines } = useMachines();
  const { data: linesData } = useLines();
  const { data: machineEvents } = useRecentMachineEvents();
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
  const [startDate, setStartDate] = useState<Date>(startOfDay(new Date()));
  const [endDate, setEndDate] = useState<Date>(new Date());
  const [datePreset, setDatePreset] = useState<DateRangePreset>("today");
  

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

  // ── Downtime KPIs (all follow top date range) ─────────────────
  const kpis = useMemo(() => {
    const safeRecords = records || [];
    const rangeStartMs = startOfDay(startDate).getTime();
    const rangeEndMs = Math.min(endOfDay(endDate).getTime(), Date.now());
    const nowMs = Date.now();

    const totalRange = reconcileMinutes(
      safeRecords.map((r) => ({ start: r.started_at, end: r.ended_at })),
      rangeStartMs,
      rangeEndMs,
      nowMs,
    );

    const active = safeRecords.filter(r => !r.ended_at).length;

    // Average duration over the selected range (resolved records only)
    const inRange = safeRecords.filter(r => {
      const t = new Date(r.started_at).getTime();
      return t >= rangeStartMs && t <= rangeEndMs && r.ended_at;
    });
    const avgDuration = inRange.length
      ? Math.round(inRange.reduce((s, r) => s + differenceInMinutes(new Date(r.ended_at!), new Date(r.started_at)), 0) / inRange.length)
      : 0;

    // Most affected line over the selected range
    const rangeRecords = safeRecords.filter(r => {
      const t = new Date(r.started_at).getTime();
      return t >= rangeStartMs && t <= rangeEndMs;
    });
    const lineCount: Record<string, number> = {};
    rangeRecords.forEach(r => { lineCount[r.line] = (lineCount[r.line] || 0) + 1; });
    const mostAffected = Object.entries(lineCount).sort((a, b) => b[1] - a[1])[0]?.[0] || "—";

    return { totalRange, active, avgDuration, mostAffected };
  }, [records, startDate, endDate]);


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
  const filteredWOs = useMemo(
    () => filterWOsByRange(allWOs, startDate, endDate),
    [allWOs, startDate, endDate],
  );

  const machineHistory = useMemo(() => buildMachineHistory(filteredWOs), [filteredWOs]);

  const filteredRisks = useMemo(() => buildMachineRisks(filteredWOs), [filteredWOs]);

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

  // ── Debug mode (?debug=1) — log hook outputs feeding Risk Assessment & Problem History ──
  const debugMode = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("debug") === "1";
  if (debugMode) {
    // eslint-disable-next-line no-console
    console.log("[DowntimeDebug]", {
      range: { startDate: startDate.toISOString(), endDate: endDate.toISOString() },
      allWOs_count: allWOs?.length ?? 0,
      filteredWOs_count: filteredWOs.length,
      filteredWOs: filteredWOs.map((w) => ({ id: w.id, wo_number: w.wo_number, machine: w.machine, created_at: w.created_at, status: w.status, description: w.description })),
      machineHistory_count: machineHistory.length,
      machineHistory,
      filteredRisks_count: filteredRisks.length,
      filteredRisks,
    });
  }

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

  const lineOptions = useMemo(() => {
    const fromDb = (linesData ?? []).map((l: any) => l.name).filter(Boolean);
    return fromDb.length > 0 ? fromDb : [...LINES];
  }, [linesData]);

  const machineOptions = useMemo(() => {
    if (!machines) return [];
    if (!formLine) return machines.map((m: any) => m.name).filter(Boolean);
    return machines
      .filter((m: any) => {
        const ml = m.current_line || m.fixed_line || m.line || "";
        return ml === formLine;
      })
      .map((m: any) => m.name)
      .filter(Boolean);
  }, [machines, formLine]);

  const formFieldsJsx = (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Line *</Label>
          <Select value={formLine || undefined} onValueChange={(v) => { setFormLine(v); setFormMachine(""); }}>
            <SelectTrigger><SelectValue placeholder="Select line" /></SelectTrigger>
            <SelectContent>
              {lineOptions.map((l) => (
                <SelectItem key={l} value={l}>{l}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Machine</Label>
          <Select value={formMachine || undefined} onValueChange={setFormMachine} disabled={machineOptions.length === 0}>
            <SelectTrigger><SelectValue placeholder={machineOptions.length === 0 ? "Select line first" : "Select machine"} /></SelectTrigger>
            <SelectContent>
              {machineOptions.map((m) => (
                <SelectItem key={m} value={m}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Category *</Label>
          <Select value={formCategory || undefined} onValueChange={setFormCategory}>
            <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
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
            <DateRangeFilter
              value={{ from: startDate, to: endDate }}
              preset={datePreset}
              storageKey="downtime-page"
              onChange={(range, preset) => {
                setDatePreset(preset);
                const r = preset === "all" ? getPresetRange("30d") : range;
                if (r.from) setStartDate(startOfDay(r.from));
                if (r.to) setEndDate(endOfDay(r.to));
              }}
            />

            <Button className="bg-orange-600 hover:bg-orange-700 text-white" onClick={openCreate}>
              <Plus className="h-4 w-4 mr-2" /> Register Downtime
            </Button>
          </div>
        </div>

        {debugMode && (
          <Card className="border-amber-500/50 bg-amber-500/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-mono">🐞 Debug — Hook outputs</CardTitle>
            </CardHeader>
            <CardContent className="text-xs font-mono space-y-1">
              <div>Range: <b>{format(startDate, "dd/MM/yy HH:mm")}</b> → <b>{format(endDate, "dd/MM/yy HH:mm")}</b></div>
              <div>allWOs (raw): <b>{allWOs?.length ?? 0}</b></div>
              <div>filteredWOs (in range): <b>{filteredWOs.length}</b></div>
              <div>machineHistory rows: <b>{machineHistory.length}</b> → {machineHistory.map(m => `${m.machine}(${m.count})`).join(", ") || "—"}</div>
              <div>filteredRisks rows: <b>{filteredRisks.length}</b> → {filteredRisks.map(r => `${r.machine}[${r.risk}/${r.failures30d}]`).join(", ") || "—"}</div>
              <div className="text-muted-foreground pt-1">Full payload logged to console as <code>[DowntimeDebug]</code>.</div>
            </CardContent>
          </Card>
        )}

        {/* Top KPIs: Downtime focused */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Downtime (Selected Range)</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{kpis.totalRange < 60 ? `${kpis.totalRange}min` : `${Math.floor(kpis.totalRange / 60)}h ${kpis.totalRange % 60}m`}</div>

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
              <CardTitle className="text-sm font-medium">Avg Duration (Period)</CardTitle>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{kpis.avgDuration}min</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Most Affected Line (Period)</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{kpis.mostAffected}</div>
            </CardContent>
          </Card>
        </div>

        {/* Day / Night shift breakdown (Europe/London) */}
        <ShiftBreakdownCard date={endDate} onDateChange={(d) => { setEndDate(d); setDatePreset("custom"); }} />

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
                    {lineOptions.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
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
              <>
                {/* Mobile cards */}
                <div className="md:hidden space-y-3">
                  {filteredRecords.map(r => {
                    const active = !r.ended_at;
                    return (
                      <div key={r.id} className={`rounded-lg border p-3 space-y-2 ${active ? "border-destructive/50 bg-destructive/5" : "bg-card"}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className={`font-semibold truncate ${r.line === "— (line deleted)" ? "italic text-muted-foreground" : ""}`}>{r.line}</p>
                            <p className="text-xs text-muted-foreground">{r.machine || "—"}</p>
                          </div>
                          {active ? (
                            <Badge className="bg-red-100 text-red-800 border-red-200 dark:bg-red-900/40 dark:text-red-300 dark:border-red-800">Active</Badge>
                          ) : (
                            <Badge className="bg-green-100 text-green-800 border-green-200 dark:bg-green-900/40 dark:text-green-300 dark:border-green-800">Resolved</Badge>
                          )}
                        </div>
                        <p className="text-sm line-clamp-2">{r.reason}</p>
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <Badge variant="outline">{r.category}</Badge>
                          <span>{format(new Date(r.started_at), "dd/MM HH:mm")}</span>
                          <span className="font-mono">{getDuration(r)}</span>
                        </div>
                        {r.source === "wo_event" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-11 w-full touch-manipulation"
                            onClick={() => r.work_order_id && navigate(`/dashboard/wo/${r.work_order_id}`)}
                            disabled={!r.work_order_id}
                          >
                            Open WO
                          </Button>
                        ) : (
                          <div className="flex gap-2">
                            <Button size="sm" variant="outline" className="h-10 flex-1 touch-manipulation" onClick={() => openEdit(r)}>
                              <Pencil className="h-4 w-4 mr-1" /> Edit
                            </Button>
                            {active && (
                              <Button size="sm" variant="outline" className="h-10 flex-1 text-green-600 touch-manipulation" onClick={() => handleResolve(r.id)}>
                                <CheckCircle className="h-4 w-4 mr-1" /> Resolve
                              </Button>
                            )}
                            <Button size="sm" variant="destructive" className="h-10 touch-manipulation" onClick={() => setDeleteId(r.id)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Desktop table */}
                <Table className="hidden md:table">
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
                      <TableCell className={r.line === "— (line deleted)" ? "italic text-muted-foreground" : "font-medium"}>{r.line}</TableCell>
                      <TableCell>{r.machine || "—"}</TableCell>
                      <TableCell><Badge variant="outline">{r.category}</Badge></TableCell>
                      <TableCell className="max-w-[200px] truncate">{r.reason}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{format(new Date(r.started_at), "dd/MM HH:mm")}</TableCell>
                      <TableCell className="font-mono text-sm">{getDuration(r)}</TableCell>
                      <TableCell>
                        {r.ended_at ? (
                          <Badge className="bg-green-100 text-green-800 border-green-200 dark:bg-green-900/40 dark:text-green-300 dark:border-green-800">Resolved</Badge>
                        ) : (
                          <Badge className="bg-red-100 text-red-800 border-red-200 dark:bg-red-900/40 dark:text-red-300 dark:border-red-800">Active</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {r.source === "wo_event" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => r.work_order_id && navigate(`/dashboard/wo/${r.work_order_id}`)}
                            disabled={!r.work_order_id}
                          >
                            Open WO
                          </Button>
                        ) : (
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
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </>
            )}
          </CardContent>
        </Card>

        {/* Machine Problem History */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><History className="h-5 w-5" />Machine Problem History</CardTitle>
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
                    <TableHead className="text-center">Failures</TableHead>
                    <TableHead>Top Problem</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {machineHistory.map((m, i) => (
                    <TableRow key={m.machine}>
                      <TableCell className="font-medium text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="font-medium">{m.machine}</TableCell>
                      <TableCell className="text-center"><Badge variant={m.count >= 5 ? "destructive" : "secondary"}>{m.count}</Badge></TableCell>
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
