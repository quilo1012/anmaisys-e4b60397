import { useEffect, useState, useMemo } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { ClipboardList, XCircle, Loader2, Download, Plus, Pencil, Trash2, Search, LayoutGrid, List, ChevronLeft, ChevronRight, Printer, CheckCircle, AlertTriangle, SlidersHorizontal } from "lucide-react";
import { useWorkOrders, useForceCloseWorkOrder, useCloseWorkOrder, useCreateWorkOrder, useUpdateWorkOrder, useDeleteWorkOrder, type WOStatus, type WorkOrder } from "@/hooks/useWorkOrders";
import { usePartsCountByWOs } from "@/hooks/useStock";
import { useMachines, useLines } from "@/hooks/useMachines";
import { useActiveProblemDescriptions } from "@/hooks/useProblemDescriptions";
import { useProfileNames } from "@/hooks/useProfileNames";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate, useSearchParams } from "react-router-dom";
import { format, subDays, startOfDay, endOfDay, startOfMonth, differenceInMinutes } from "date-fns";
import { exportWorkOrdersCsv } from "@/lib/exportCsv";
import { useToast } from "@/hooks/use-toast";
import { useEngineerScores } from "@/hooks/useEngineerScores";
// jsPDF is lazy-loaded inside the PDF button handler to keep it out of the initial bundle.
import { authorizePdfGeneration } from "@/lib/generatePdfReport";
import { FileText } from "lucide-react";
import { logAuditEvent } from "@/hooks/useAuditLogs";
import { RecurrenceBadge } from "@/components/RecurrenceBadge";
import { WO_TERMINAL_STATUSES, isWoOpen } from "@/lib/woStatus";
import { getWoStatusConfig } from "@/lib/woStatusConfig";
import { ShiftFilter } from "@/components/ShiftFilter";
import { DateRangeFilter, getPresetRange, type DateRange, type DateRangePreset } from "@/components/DateRangeFilter";

const statusConfig = new Proxy({} as Record<string, { label: string; className: string }>, {
  get: (_t, key: string) => getWoStatusConfig(key),
});

const priorityConfig: Record<string, { label: string; className: string }> = {
  low: { label: "Low", className: "bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30" },
  medium: { label: "Medium", className: "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30" },
  high: { label: "High", className: "bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30" },
  critical: { label: "Critical", className: "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30" },
};

const ITEMS_PER_PAGE = 20;

export default function WorkOrdersPage() {
  const { user, role } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [drRange, setDrRange] = useState<DateRange>(() => getPresetRange("today"));
  const [drPreset, setDrPreset] = useState<DateRangePreset>("today");
  const [statusFilter, setStatusFilter] = useState<string>(() => searchParams.get("status") || "all");
  
  const [problemFilter, setProblemFilter] = useState<string>("all");
  const [machineFilter, setMachineFilter] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [viewMode, setViewMode] = useState<"table" | "board">("table");
  const [currentPage, setCurrentPage] = useState(1);
  const [shiftFilter, setShiftFilter] = useState<"ALL" | "DAY" | "NIGHT">("ALL");
  const [lineFilter, setLineFilter] = useState<string>("all");

  useEffect(() => {
    if (role === "admin" || (role === "manager" || role === "maintenance_manager")) {
      setDrPreset("all");
      setDrRange(getPresetRange("all"));
    }
  }, [role]);
  const [lineStoppedFilter, setLineStoppedFilter] = useState<"all" | "stopped" | "running">("all");

  const ALL_COLUMNS = [
    { key: "wo", label: "WO#" },
    { key: "line", label: "Line" },
    { key: "machine", label: "Machine" },
    { key: "problem", label: "Problem" },
    { key: "status", label: "Status" },
    { key: "requester", label: "Requester" },
    { key: "engineer", label: "Engineer" },
    { key: "created", label: "Created" },
    { key: "parts", label: "Parts" },
    { key: "actions", label: "Actions" },
  ] as const;
  type ColKey = typeof ALL_COLUMNS[number]["key"];
  const [visibleCols, setVisibleCols] = useState<Set<ColKey>>(() => new Set(ALL_COLUMNS.map((c) => c.key)));
  const toggleCol = (key: ColKey) => setVisibleCols((prev) => { const s = new Set(prev); s.has(key) ? s.delete(key) : s.add(key); return s; });
  const isCol = (key: ColKey) => visibleCols.has(key);

  const filterStatuses =
    statusFilter === "all" || statusFilter === "stale"
      ? undefined
      : [statusFilter as WOStatus];
  const { data: workOrders, isLoading } = useWorkOrders({ statusIn: filterStatuses });
  const forceClose = useForceCloseWorkOrder();
  const closeWO = useCloseWorkOrder();
  const createWO = useCreateWorkOrder();
  const updateWO = useUpdateWorkOrder();
  const deleteWO = useDeleteWorkOrder();

  const { data: machines } = useMachines();
  const { data: lines } = useLines();
  const { data: problemDescriptions } = useActiveProblemDescriptions();
  const { data: profileNames } = useProfileNames();
  const { data: engineerScores } = useEngineerScores();

  const woIds = useMemo(() => workOrders?.map((w) => w.id) ?? [], [workOrders]);
  const { data: partsCounts } = usePartsCountByWOs(woIds);

  const [showCreate, setShowCreate] = useState(false);
  const [newRequester, setNewRequester] = useState("");
  const [newLineId, setNewLineId] = useState("");
  const [newMachine, setNewMachine] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [newPriority, setNewPriority] = useState<string>("medium");
  

  const [editWO, setEditWO] = useState<WorkOrder | null>(null);
  const [editRequester, setEditRequester] = useState("");
  const [editMachine, setEditMachine] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editNotes, setEditNotes] = useState("");

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showClearWOs, setShowClearWOs] = useState(false);
  const [clearPin, setClearPin] = useState("");
  const [clearing, setClearing] = useState(false);
  const [clearConfirmText, setClearConfirmText] = useState("");

  const lineNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    lines?.forEach((line: any) => {
      if (line.id) map[line.id] = line.name;
    });
    return map;
  }, [lines]);

  // Prefer the physical_line_id (real production line for sealer/printer WOs),
  // then the WO line_id, falling back to legacy machine-derived line names.
  const getWoLine = (wo: WorkOrder) => {
    const physical = lineNameMap[(wo as any).physical_line_id];
    if (physical) return physical;
    const explicitLine = lineNameMap[(wo as any).line_id];
    if (explicitLine) return explicitLine;
    if (wo.machine) return machineLineMap[wo.machine] || "";
    return "";
  };

  const machineLineMap = useMemo(() => {
    const map: Record<string, string> = {};
    machines?.forEach((m: any) => {
      const base = m.current_line || m.fixed_line || m.line || "";
      const withSide = base && (m.side === "A" || m.side === "B") ? `${base}${m.side}` : base;
      map[m.name] = withSide;
    });
    return map;
  }, [machines]);

  const distinctLines = useMemo(() => {
    const lineNames = new Set<string>();
    lines?.forEach((line: any) => { if (line.name) lineNames.add(line.name); });
    Object.values(machineLineMap).forEach((l) => { if (l) lineNames.add(l); });
    return Array.from(lineNames).sort();
  }, [lines, machineLineMap]);

  const filteredWOs = useMemo(() => {
    if (!workOrders) return [];
    let filtered = workOrders;
    const now = new Date();
    if (drRange.from) {
      const fromMs = drRange.from.getTime();
      filtered = filtered.filter((w) => new Date(w.created_at).getTime() >= fromMs);
    }
    if (drRange.to) {
      const toMs = drRange.to.getTime();
      filtered = filtered.filter((w) => new Date(w.created_at).getTime() <= toMs);
    }
    if (problemFilter !== "all") filtered = filtered.filter((w) => w.description === problemFilter);
    if (machineFilter !== "all") filtered = filtered.filter((w) => w.machine === machineFilter);
    if (lineFilter !== "all") filtered = filtered.filter((w) => getWoLine(w) === lineFilter);
    if (lineStoppedFilter === "stopped") {
      filtered = filtered.filter((w: any) => w.line_stopped === true && !w.line_resumed_at);
    } else if (lineStoppedFilter === "running") {
      filtered = filtered.filter((w: any) => !w.line_stopped || !!w.line_resumed_at);
    }
    if (shiftFilter !== "ALL") {
      filtered = filtered.filter((w) => {
        const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: "Europe/London" }).format(new Date(w.created_at)));
        const isDay = h >= 6 && h < 18;
        return shiftFilter === "DAY" ? isDay : !isDay;
      });
    }
    if (statusFilter === "stale") {
      filtered = filtered.filter((w) => w.status === "in_progress" && w.started_at && differenceInMinutes(now, new Date(w.started_at)) > 4320);
    }
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter((w) =>
        `WO-${new Date(w.created_at).getFullYear()}-${String(w.wo_number).padStart(6, "0")}`.toLowerCase().includes(term) ||
        w.requester_name.toLowerCase().includes(term) ||
        w.machine.toLowerCase().includes(term) ||
        w.description.toLowerCase().includes(term) ||
        (w.operator?.name || "").toLowerCase().includes(term) ||
        (w.engineer?.name || "").toLowerCase().includes(term)
      );
    }
    // Sort: stopped lines first (oldest stoppage first = most urgent), then by line, then newest
    filtered = [...filtered].sort((a: any, b: any) => {
      const aStopped = a.line_stopped === true && !a.line_resumed_at;
      const bStopped = b.line_stopped === true && !b.line_resumed_at;
      if (aStopped && !bStopped) return -1;
      if (!aStopped && bStopped) return 1;
      if (aStopped && bStopped) {
        const ta = a.line_stopped_at ? new Date(a.line_stopped_at).getTime() : 0;
        const tb = b.line_stopped_at ? new Date(b.line_stopped_at).getTime() : 0;
        return ta - tb; // oldest stoppage first
      }
      const lineA = getWoLine(a) || "zzz";
      const lineB = getWoLine(b) || "zzz";
      if (lineA !== lineB) return lineA.localeCompare(lineB);
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
    return filtered;
  }, [workOrders, drRange, problemFilter, machineFilter, lineFilter, lineStoppedFilter, searchTerm, lineNameMap, machineLineMap, shiftFilter, statusFilter]);

  const stoppedCount = useMemo(
    () => (workOrders ?? []).filter((w: any) => w.line_stopped === true && !w.line_resumed_at).length,
    [workOrders],
  );
  const runningCount = useMemo(
    () => (workOrders ?? []).filter((w: any) => !w.line_stopped || !!w.line_resumed_at).length,
    [workOrders],
  );

  const totalPages = Math.ceil((filteredWOs?.length ?? 0) / ITEMS_PER_PAGE);
  const paginatedWOs = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredWOs.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredWOs, currentPage]);

  useMemo(() => { setCurrentPage(1); }, [statusFilter, problemFilter, machineFilter, lineFilter, searchTerm, drRange]);

  // Keep URL in sync with status filter so deep-links from dashboards work
  useEffect(() => {
    const current = searchParams.get("status") || "all";
    if (current !== statusFilter) {
      const next = new URLSearchParams(searchParams);
      if (statusFilter === "all") next.delete("status"); else next.set("status", statusFilter);
      setSearchParams(next, { replace: true });
    }
  }, [statusFilter]);

  const kanbanColumns = useMemo(() => ({
    open: filteredWOs.filter((w) => w.status === "open"),
    received: filteredWOs.filter((w) => ["received", "arrived"].includes(w.status)),
    inProgress: filteredWOs.filter((w) => w.status === "in_progress"),
    finished: filteredWOs.filter((w) => w.status === "finished"),
    done: filteredWOs.filter((w) => ["closed", "completed", "force_closed"].includes(w.status)),
  }), [filteredWOs]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createWO.mutateAsync({ requester_name: newRequester.trim(), line_id: newLineId || undefined, machine: newMachine.trim(), description: newDesc.trim(), notes: newNotes.trim(), priority: newPriority } as any);
      toast({ title: "Work Order Created" });
      setShowCreate(false); setNewRequester(""); setNewLineId(""); setNewMachine(""); setNewDesc(""); setNewNotes(""); setNewPriority("medium");
    } catch (err: any) { toast({ title: "Error", description: err.message, variant: "destructive" }); }
  };

  const openEdit = (wo: WorkOrder) => {
    setEditWO(wo); setEditRequester(wo.requester_name); setEditMachine(wo.machine); setEditDesc(wo.description); setEditNotes(wo.notes || "");
  };

  const handleEdit = async () => {
    if (!editWO) return;
    try {
      await updateWO.mutateAsync({ id: editWO.id, requester_name: editRequester.trim(), machine: editMachine.trim(), description: editDesc.trim(), notes: editNotes.trim() });
      toast({ title: "Work Order Updated" }); setEditWO(null);
    } catch (err: any) { toast({ title: "Error", description: err.message, variant: "destructive" }); }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try { await deleteWO.mutateAsync(deleteId); toast({ title: "Work Order Deleted" }); setDeleteId(null); }
    catch (err: any) { toast({ title: "Error", description: err.message, variant: "destructive" }); }
  };

  const KanbanCard = ({ wo, borderColor }: { wo: WorkOrder; borderColor: string }) => {
    const pri = priorityConfig[wo.priority || "medium"] || priorityConfig.medium;
    return (
      <Card className={`cursor-pointer hover:shadow-md transition-shadow border-l-4 ${borderColor}`} onClick={() => navigate(`/dashboard/wo/${wo.id}`)}>
        <CardContent className="p-3 space-y-1">
          <div className="flex justify-between items-center">
            <span className="font-mono text-xs font-medium flex items-center gap-1">
              WO-{new Date(wo.created_at).getFullYear()}-{String(wo.wo_number).padStart(6, "0")}
              <RecurrenceBadge originalWoId={(wo as any).recurrence_of_wo_id} compact />
            </span>
            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${pri.className}`}>{pri.label}</Badge>
          </div>
          <p className="text-sm font-medium">{wo.machine}</p>
          <p className="text-xs text-muted-foreground truncate">{wo.description}</p>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{wo.requester_name}</span>
            <span>{wo.engineer?.name || "—"}</span>
          </div>
        </CardContent>
      </Card>
    );
  };

  const KanbanColumn = ({ title, items, color, borderColor }: { title: string; items: WorkOrder[]; color: string; borderColor: string }) => (
    <div className="space-y-2">
      <div className="flex items-center gap-2 mb-3"><div className={`w-3 h-3 rounded-full ${color}`} /><h3 className="font-semibold text-sm">{title} ({items.length})</h3></div>
      {items.map((wo) => <KanbanCard key={wo.id} wo={wo} borderColor={borderColor} />)}
      {!items.length && <p className="text-muted-foreground text-xs text-center py-4">No WOs</p>}
    </div>
  );

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3 border-b pb-4">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight flex items-center gap-2"><ClipboardList className="h-6 w-6 text-muted-foreground" /> Work Orders</h2>
            <p className="text-sm text-muted-foreground mt-1">Manage and track all work orders</p>
          </div>
          <div className="flex gap-2">
            {role === "admin" && (
              <Button variant="outline" size="sm" onClick={() => setShowClearWOs(true)} className="text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive">
                <AlertTriangle className="h-4 w-4 mr-2" /> Clear WOs
              </Button>
            )}
            <Button size="sm" onClick={() => setShowCreate(true)}><Plus className="h-4 w-4 mr-2" /> Create WO</Button>
          </div>
        </div>

        <Card>
          <CardHeader className="space-y-4 border-b bg-muted/30">
            {/* Row 1 — Search + Status pills */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="relative flex-1 min-w-[240px] max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search WO#, requester, machine…"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9 h-9 bg-background"
                />
              </div>
            </div>

            {/* Row 2 — View toggle + Date pills + Custom range */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="inline-flex items-center rounded-md border bg-background p-0.5 shadow-sm">
                  <Button variant={viewMode === "table" ? "secondary" : "ghost"} size="sm" onClick={() => setViewMode("table")} className="h-7 w-8 p-0"><List className="h-4 w-4" /></Button>
                  <Button variant={viewMode === "board" ? "secondary" : "ghost"} size="sm" onClick={() => setViewMode("board")} className="h-7 w-8 p-0"><LayoutGrid className="h-4 w-4" /></Button>
                </div>
                <div className="inline-flex items-center rounded-md border bg-background p-0.5 shadow-sm">
                  {([["today", "Today"], ["yesterday", "Yesterday"], ["7days", "7D"], ["month", "Month"], ["all", "All"]] as const).map(([key, label]) => (
                    <Button
                      key={key}
                      variant={dateQuickFilter === key ? "secondary" : "ghost"}
                      size="sm"
                      className="h-7 px-3 text-xs font-medium"
                      onClick={() => { setDateQuickFilter(key); setDateFrom(""); setDateTo(""); }}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
                <div className="flex items-center gap-1">
                  <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setDateQuickFilter(""); }} className="w-[125px] sm:w-[140px] h-9 bg-background" />
                  <span className="text-xs text-muted-foreground">→</span>
                  <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setDateQuickFilter(""); }} className="w-[125px] sm:w-[140px] h-9 bg-background" />
                </div>
                <ShiftFilter value={shiftFilter} onChange={setShiftFilter} />
              </div>

              <div className="inline-flex items-center gap-1 rounded-md border bg-background p-0.5 shadow-sm">
                <Button variant="ghost" size="sm" className="h-7 px-2.5 text-xs" onClick={() => { if (filteredWOs) exportWorkOrdersCsv(filteredWOs, undefined, partsCounts); }}>
                  <Download className="h-3.5 w-3.5 mr-1" /> CSV
                </Button>
                <Button variant="ghost" size="sm" className="h-7 px-2.5 text-xs" onClick={async () => {
                  if (!filteredWOs) return;
                  // Client-side defense-in-depth: block before any network call.
                  if (role !== "admin" && (role !== "manager" && role !== "maintenance_manager")) {
                    toast({ title: "Cannot generate PDF", description: "You don't have permission to generate this report.", variant: "destructive" });
                    return;
                  }
                  try {
                    await authorizePdfGeneration({ reportType: "wo_report" });
                  } catch (err: any) {
                    toast({ title: "Cannot generate PDF", description: err?.message ?? "Authorization failed.", variant: "destructive" });
                    return;
                  }
                  const allWOs = filteredWOs;
                  const engPerf = engineerScores?.map((s) => ({ name: s.engineer_name || "Unknown", score: s.score, completed: 0 })) || [];
                  const openWOs = allWOs.filter((w) => isWoOpen(w.status)).length;
                  try {
                    const { generatePdfReport } = await import("@/lib/generatePdfReport");
                    generatePdfReport({
                      workOrders: allWOs,
                      machineLineMap,
                      engineerRanking: engPerf,
                      kpis: { avgResponse: 0, avgMTTR: 0, totalWOs: allWOs.length, openWOs, slaRate: 0 },
                      dateRange: dateFrom && dateTo ? `${dateFrom} to ${dateTo}` : dateQuickFilter !== "all" ? dateQuickFilter : "All records",
                      callerRole: role,
                    });
                  } catch (err: any) {
                    toast({ title: "Cannot generate PDF", description: err?.message ?? "Failed to generate report.", variant: "destructive" });
                  }
                }}>
                  <FileText className="h-3.5 w-3.5 mr-1" /> PDF
                </Button>
                <Button variant="ghost" size="sm" className="h-7 px-2.5 text-xs no-print" onClick={() => {
                  if (role !== "admin" && (role !== "manager" && role !== "maintenance_manager")) {
                    toast({ title: "Cannot print", description: "You don't have permission to print reports.", variant: "destructive" });
                    return;
                  }
                  window.print();
                }}>
                  <Printer className="h-3.5 w-3.5 mr-1" /> Print
                </Button>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-7 px-2.5 text-xs"><SlidersHorizontal className="h-3.5 w-3.5 mr-1" /> Columns</Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-48 p-3" align="end">
                    <p className="text-xs font-semibold mb-2">Toggle Columns</p>
                    {ALL_COLUMNS.map((col) => (
                      <label key={col.key} className="flex items-center gap-2 py-1 text-sm cursor-pointer">
                        <Checkbox checked={isCol(col.key)} onCheckedChange={() => toggleCol(col.key)} />
                        {col.label}
                      </label>
                    ))}
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            {/* Row 3 — Dropdown filters */}
            <div className="flex items-center gap-2 flex-wrap filters-section">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[140px] sm:w-[150px] h-9 bg-background"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="received">Received</SelectItem>
                  <SelectItem value="arrived">Arrived</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="finished">Finished</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                  <SelectItem value="force_closed">Force Closed</SelectItem>
                  <SelectItem value="stale">Stale (&gt;72h)</SelectItem>
                </SelectContent>
              </Select>
              <Select value={lineFilter} onValueChange={setLineFilter}>
                <SelectTrigger className="w-[140px] sm:w-[150px] h-9 bg-background"><SelectValue placeholder="Line" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Lines</SelectItem>
                  {distinctLines.map((line) => <SelectItem key={line} value={line}>{line}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={problemFilter} onValueChange={setProblemFilter}>
                <SelectTrigger className="w-[150px] sm:w-[170px] h-9 bg-background"><SelectValue placeholder="Problem" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Problems</SelectItem>
                  {problemDescriptions?.map((pd) => <SelectItem key={pd.id} value={pd.name}>{pd.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={machineFilter} onValueChange={setMachineFilter}>
                <SelectTrigger className="w-[150px] sm:w-[170px] h-9 bg-background"><SelectValue placeholder="Machine" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Machines</SelectItem>
                  {machines?.map((m) => <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            {/* Print-only header */}
            <div className="print-header hidden print:block">
              <h1 style={{ fontSize: "16pt", fontWeight: "bold" }}>AN Maintenance — Work Orders Report</h1>
              <p style={{ fontSize: "10pt", color: "#666" }}>
                {dateFrom && dateTo ? `Period: ${dateFrom} to ${dateTo}` : dateQuickFilter !== "all" ? `Filter: ${dateQuickFilter}` : "All records"}
                {lineFilter !== "all" ? ` | Line: ${lineFilter}` : ""}
                {statusFilter !== "all" ? ` | Status: ${statusFilter}` : ""}
                {machineFilter !== "all" ? ` | Machine: ${machineFilter}` : ""}
              </p>
              <p style={{ fontSize: "9pt", color: "#999" }}>Generated: {format(new Date(), "dd/MM/yyyy HH:mm")}</p>
            </div>
            {isLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : !filteredWOs?.length ? (
              <div className="text-center py-12">
                <ClipboardList className="h-12 w-12 mx-auto text-muted-foreground/40 mb-3" />
                <p className="text-muted-foreground font-medium">No work orders found</p>
                <p className="text-muted-foreground text-sm mt-1">Try adjusting your filters or create a new work order.</p>
              </div>
            ) : viewMode === "board" ? (
              <div className="grid grid-cols-1 md:grid-cols-5 gap-4 no-print">
                <KanbanColumn title="Open" items={kanbanColumns.open} color="bg-blue-500" borderColor="border-l-blue-500" />
                <KanbanColumn title="Received/Arrived" items={kanbanColumns.received} color="bg-indigo-500" borderColor="border-l-indigo-500" />
                <KanbanColumn title="In Progress" items={kanbanColumns.inProgress} color="bg-amber-500" borderColor="border-l-amber-500" />
                <KanbanColumn title="Finished" items={kanbanColumns.finished} color="bg-teal-500" borderColor="border-l-teal-500" />
                <KanbanColumn title="Done" items={kanbanColumns.done} color="bg-green-500" borderColor="border-l-green-500" />
              </div>
            ) : (
              <div className="print-content">
                {/* Mobile card list (< md) */}
                <div className="md:hidden space-y-3">
                  {paginatedWOs.map((wo) => {
                    const cfg = getWoStatusConfig(wo.status);
                    const pri = priorityConfig[wo.priority || "medium"] || priorityConfig.medium;
                    const canForceClose = ["open", "received", "arrived", "in_progress"].includes(wo.status);
                    const canClose = wo.status === "finished";
                    const woLine = getWoLine(wo) || "—";
                    const isStale = wo.status === "in_progress" && wo.started_at && differenceInMinutes(new Date(), new Date(wo.started_at)) > 4320;
                    return (
                      <Card key={wo.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate(`/dashboard/wo/${wo.id}`)}>
                        <CardContent className="p-3 space-y-2">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <span className="font-mono text-xs font-semibold flex items-center gap-1.5">
                              WO-{new Date(wo.created_at).getFullYear()}-{String(wo.wo_number).padStart(6, "0")}
                              <RecurrenceBadge originalWoId={(wo as any).recurrence_of_wo_id} compact />
                            </span>
                            <div className="flex items-center gap-1">
                              <Badge variant="outline" className={cfg.className}>{cfg.label}</Badge>
                              {isStale && (
                                <Badge variant="outline" className="bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30 text-[10px]" title="In progress > 3 days">Stale</Badge>
                              )}
                            </div>
                          </div>
                          <div className="text-sm font-medium">{wo.machine} <span className="text-muted-foreground font-normal">· {woLine}</span></div>
                          <p className="text-sm text-muted-foreground line-clamp-2">{wo.description}</p>
                          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground flex-wrap">
                            <span>{wo.requester_name} → {wo.engineer?.name || "—"}</span>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${pri.className}`}>{pri.label}</Badge>
                              <span>{format(new Date(wo.created_at), "dd/MM HH:mm")}</span>
                            </div>
                          </div>
                          <div className="flex gap-2 pt-1" onClick={(e) => e.stopPropagation()}>
                            <Button size="sm" variant="outline" className="h-10 flex-1 touch-manipulation" onClick={() => openEdit(wo)}>
                              <Pencil className="h-4 w-4 mr-1" /> Edit
                            </Button>
                            {canClose && (
                              <Button size="sm" variant="default" className="h-10 flex-1 touch-manipulation" onClick={() => closeWO.mutate({ woId: wo.id, signatureName: "Manager/Admin" })} disabled={closeWO.isPending}>
                                {closeWO.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-1" />} Close
                              </Button>
                            )}
                            {canForceClose && (role === "admin" || (role === "manager" || role === "maintenance_manager")) && (
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button size="sm" variant="destructive" className="h-10 flex-1 touch-manipulation" disabled={forceClose.isPending}>
                                    {forceClose.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <XCircle className="h-4 w-4 mr-1" />} Force
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Force Close Work Order?</AlertDialogTitle>
                                    <AlertDialogDescription>This will force-close the work order regardless of its current status. This action will be recorded in the audit log.</AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => forceClose.mutate(wo.id)}>Force Close</AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>

                {/* Desktop table (≥ md) */}
                <Table className="hidden md:table">
                  <TableHeader>
                    <TableRow>
                      {isCol("wo") && <TableHead>WO#</TableHead>}
                      {isCol("line") && <TableHead>Line</TableHead>}
                      {isCol("machine") && <TableHead>Machine</TableHead>}
                      {isCol("problem") && <TableHead>Problem</TableHead>}
                      {isCol("status") && <TableHead>Status</TableHead>}
                      {isCol("requester") && <TableHead>Requester</TableHead>}
                      {isCol("engineer") && <TableHead>Engineer</TableHead>}
                      {isCol("created") && <TableHead>Created</TableHead>}
                      {isCol("parts") && <TableHead className="no-print">Parts</TableHead>}
                      {isCol("actions") && <TableHead className="no-print">Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedWOs.map((wo) => {
                      const cfg = getWoStatusConfig(wo.status);
                      const canForceClose = ["open", "received", "arrived", "in_progress"].includes(wo.status);
                      const canClose = wo.status === "finished";
                      const woLine = getWoLine(wo) || "—";
                      return (
                        <TableRow key={wo.id}>
                          {isCol("wo") && (
                            <TableCell className="font-mono font-medium">
                              <div className="flex items-center gap-2">
                                <span className="cursor-pointer hover:underline" onClick={() => navigate(`/dashboard/wo/${wo.id}`)}>
                                  WO-{new Date(wo.created_at).getFullYear()}-{String(wo.wo_number).padStart(6, "0")}
                                </span>
                                <RecurrenceBadge originalWoId={(wo as any).recurrence_of_wo_id} compact />
                              </div>
                            </TableCell>
                          )}
                          {isCol("line") && <TableCell className="text-sm font-medium">{woLine}</TableCell>}
                          {isCol("machine") && <TableCell className="cursor-pointer hover:underline" onClick={() => navigate(`/dashboard/machines/${encodeURIComponent(wo.machine)}/history`)}>{wo.machine}</TableCell>}
                          {isCol("problem") && <TableCell className="text-sm text-muted-foreground truncate max-w-[200px]">{wo.description}</TableCell>}
                          {isCol("status") && <TableCell>
                            <div className="flex items-center gap-1">
                              <Badge variant="outline" className={cfg.className}>{cfg.label}</Badge>
                              {wo.status === "in_progress" && wo.started_at && differenceInMinutes(new Date(), new Date(wo.started_at)) > 4320 && (
                                <Badge className="bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30 text-[10px]" variant="outline" title="This work order has been in progress for more than 3 days. Consider reviewing or closing it.">Stale</Badge>
                              )}
                            </div>
                          </TableCell>}
                          {isCol("requester") && <TableCell className="text-sm">{wo.requester_name}</TableCell>}
                          {isCol("engineer") && <TableCell className="text-sm">{wo.engineer?.name || "—"}</TableCell>}
                          {isCol("created") && <TableCell className="text-sm text-muted-foreground">{format(new Date(wo.created_at), "dd/MM HH:mm")}</TableCell>}
                          {isCol("parts") && <TableCell className="no-print">{partsCounts?.[wo.id] ? <Badge variant="secondary">{partsCounts[wo.id]}</Badge> : "—"}</TableCell>}
                          {isCol("actions") && <TableCell className="no-print">
                            <div className="flex gap-1">
                              {(role === "admin" || (role === "manager" || role === "maintenance_manager")) && (
                                <Button size="icon" variant="ghost" onClick={() => window.open(`/dashboard/wo/${wo.id}`, "_blank")}><Printer className="h-4 w-4" /></Button>
                              )}
                              <Button size="icon" variant="ghost" onClick={() => openEdit(wo)}><Pencil className="h-4 w-4" /></Button>
                              {role === "admin" && (
                                <Button size="icon" variant="ghost" className="text-destructive" onClick={() => setDeleteId(wo.id)} disabled={deleteWO.isPending}><Trash2 className="h-4 w-4" /></Button>
                              )}
                              {canClose && (
                                <Button size="sm" variant="default" onClick={() => closeWO.mutate({ woId: wo.id, signatureName: "Manager/Admin" })} disabled={closeWO.isPending}>
                                  {closeWO.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <CheckCircle className="h-3 w-3 mr-1" />} Close
                                </Button>
                              )}
                              {canForceClose && (role === "admin" || (role === "manager" || role === "maintenance_manager")) && (
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button size="sm" variant="destructive" disabled={forceClose.isPending}>
                                      {forceClose.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <XCircle className="h-3 w-3 mr-1" />} Force
                                    </Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Force Close Work Order?</AlertDialogTitle>
                                      <AlertDialogDescription>This will force-close the work order regardless of its current status. This action will be recorded in the audit log.</AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                                      <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => forceClose.mutate(wo.id)}>Force Close</AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              )}
                            </div>
                          </TableCell>}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                {totalPages > 1 && (
                  <div className="flex items-center justify-between mt-4">
                    <p className="text-sm text-muted-foreground">Showing {((currentPage - 1) * ITEMS_PER_PAGE) + 1}–{Math.min(currentPage * ITEMS_PER_PAGE, filteredWOs.length)} of {filteredWOs.length}</p>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setCurrentPage((p) => p - 1)}><ChevronLeft className="h-4 w-4 mr-1" /> Previous</Button>
                      <Button variant="outline" size="sm" disabled={currentPage === totalPages} onClick={() => setCurrentPage((p) => p + 1)}>Next <ChevronRight className="h-4 w-4 ml-1" /></Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Create WO Dialog */}
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogContent>
            <DialogHeader><DialogTitle>Create Work Order</DialogTitle><DialogDescription className="sr-only">Fill in work order details</DialogDescription></DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4" autoComplete="off">
              <div className="space-y-2"><Label>Requested By</Label>
                <Select value={newRequester} onValueChange={setNewRequester}>
                  <SelectTrigger><SelectValue placeholder="Select requester..." /></SelectTrigger>
                  <SelectContent>
                    {profileNames?.map((p) => <SelectItem key={p.id} value={p.name}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Line</Label>
                <Select value={newLineId} onValueChange={(v) => { setNewLineId(v); setNewMachine(""); }}>
                  <SelectTrigger><SelectValue placeholder="Select line..." /></SelectTrigger>
                  <SelectContent>{lines?.map((l: any) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Machine</Label>
                <Select value={newMachine} onValueChange={setNewMachine} disabled={!newLineId}>
                  <SelectTrigger><SelectValue placeholder={newLineId ? "Select machine..." : "Select line first..."} /></SelectTrigger>
                  <SelectContent>
                    {(() => {
                      const selectedLineName = lines?.find((l: any) => l.id === newLineId)?.name;
                      const filtered = (machines || []).filter((m: any) => {
                        if (!selectedLineName) return false;
                        const base = (m.current_line || m.fixed_line || m.line || "").toString();
                        if (!base) return false;
                        const withSide = (m.side === "A" || m.side === "B") ? `${base}${m.side}` : base;
                        return withSide === selectedLineName || base === selectedLineName;
                      });
                      return filtered.length
                        ? filtered.map((m: any) => <SelectItem key={m.id} value={m.name}>{m.name}{m.code ? ` (${m.code})` : ""}</SelectItem>)
                        : <SelectItem value="__none__" disabled>No machines for this line</SelectItem>;
                    })()}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Problem Description</Label>
                <Select value={newDesc} onValueChange={setNewDesc}>
                  <SelectTrigger><SelectValue placeholder="Select problem..." /></SelectTrigger>
                  <SelectContent>{problemDescriptions?.map((pd) => <SelectItem key={pd.id} value={pd.name}>{pd.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Priority</Label>
                <Select value={newPriority} onValueChange={setNewPriority}>
                  <SelectTrigger><SelectValue placeholder="Select priority..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Observations (optional)</Label>
                <Textarea value={newNotes} onChange={(e) => setNewNotes(e.target.value)} placeholder="Additional notes..." rows={3} />
              </div>
              <Button type="submit" className="w-full" disabled={createWO.isPending}>
                {createWO.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Create
              </Button>
            </form>
          </DialogContent>
        </Dialog>

        {/* Edit WO Dialog */}
        <Dialog open={!!editWO} onOpenChange={(open) => !open && setEditWO(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Edit Work Order</DialogTitle><DialogDescription className="sr-only">Modify work order details</DialogDescription></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2"><Label>Requested By</Label>
                <Select value={editRequester} onValueChange={setEditRequester}>
                  <SelectTrigger><SelectValue placeholder="Select requester..." /></SelectTrigger>
                  <SelectContent>
                    {profileNames?.map((p) => <SelectItem key={p.id} value={p.name}>{p.name}</SelectItem>)}
                    {editRequester && !profileNames?.some((p) => p.name === editRequester) && (
                      <SelectItem value={editRequester}>{editRequester}</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Machine</Label>
                <Select value={editMachine} onValueChange={setEditMachine}>
                  <SelectTrigger><SelectValue placeholder="Select machine..." /></SelectTrigger>
                  <SelectContent>{machines?.map((m) => <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Problem Description</Label>
                <Select value={editDesc} onValueChange={setEditDesc}>
                  <SelectTrigger><SelectValue placeholder="Select problem..." /></SelectTrigger>
                  <SelectContent>{problemDescriptions?.map((pd) => <SelectItem key={pd.id} value={pd.name}>{pd.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Observations (optional)</Label>
                <Textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} placeholder="Additional notes..." rows={3} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditWO(null)}>Cancel</Button>
              <Button onClick={handleEdit} disabled={updateWO.isPending}>{updateWO.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete WO */}
        <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete work order?</AlertDialogTitle>
              <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Clear All WOs */}
        <AlertDialog open={showClearWOs} onOpenChange={(o) => { setShowClearWOs(o); if (!o) { setClearPin(""); setClearConfirmText(""); } }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Clear all work orders?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete ALL work orders, messages, photos, parts used records, and engineer scores. This action cannot be undone. Enter admin PIN and type CONFIRM to proceed.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="px-6 pb-2 space-y-3">
              <div>
                <Label htmlFor="clear-pin">Security PIN</Label>
                <Input id="clear-pin" type="password" placeholder="Enter PIN..." value={clearPin} onChange={(e) => setClearPin(e.target.value)} maxLength={8} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="clear-confirm">Type CONFIRM</Label>
                <Input id="clear-confirm" placeholder='Type "CONFIRM" to proceed' value={clearConfirmText} onChange={(e) => setClearConfirmText(e.target.value)} className="mt-1" />
              </div>
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={clearing}>Cancel</AlertDialogCancel>
              <Button variant="destructive" disabled={clearing || clearPin.length < 4 || clearConfirmText !== "CONFIRM"} onClick={async () => {
                setClearing(true);
                try {
                  const { supabase } = await import("@/integrations/supabase/client");
                  const { data: { session } } = await supabase.auth.getSession();
                  const pinRes = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/verify-admin-pin`, {
                    method: "POST",
                    headers: {
                      "Authorization": `Bearer ${session?.access_token}`,
                      "Content-Type": "application/json",
                      "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
                    },
                    body: JSON.stringify({ pin: clearPin }),
                  });
                  const pinData = await pinRes.json();
                  if (!pinRes.ok || !pinData?.valid) {
                    toast({ title: "Invalid PIN", description: "The PIN entered is incorrect.", variant: "destructive" });
                    setClearing(false);
                    return;
                  }
                  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/clear-system`, {
                    method: "POST",
                    headers: { "Authorization": `Bearer ${session?.access_token}`, "Content-Type": "application/json" },
                  });
                  const result = await res.json();
                  if (!res.ok) throw new Error(result.error || "Failed");
                  toast({ title: "Work orders cleared", description: "All work order data has been removed." });
                  logAuditEvent("work_orders_cleared", "system", undefined, { cleared_by: user?.email });
                  setShowClearWOs(false);
                  setClearPin("");
                  setClearConfirmText("");
                } catch (err: any) {
                  toast({ title: "Error", description: err.message, variant: "destructive" });
                } finally {
                  setClearing(false);
                }
              }}>
                {clearing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Yes, Clear All
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </DashboardLayout>
  );
}
