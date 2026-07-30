import { PageHeader } from "@/components/ui/PageHeader";
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
import { ClipboardList, XCircle, Loader2, Download, Plus, Pencil, Search, UserPlus, LayoutGrid, List, ChevronLeft, ChevronRight, Printer, CheckCircle, AlertTriangle, SlidersHorizontal } from "lucide-react";
import { useWorkOrders, useCloseWorkOrder, useCreateWorkOrder, useUpdateWorkOrder, useMoveWorkOrderStage, stageOfStatus, type WOStage, type WOStatus, type WorkOrder } from "@/hooks/useWorkOrders";
import { usePartsCountByWOs } from "@/hooks/useStock";
import { useMachines, useLines } from "@/hooks/useMachines";
import { useActiveProblemDescriptions } from "@/hooks/useProblemDescriptions";
import { ComboboxInput } from "@/components/ComboboxInput";
import { ForceCloseDialog } from "@/components/ForceCloseDialog";
import { printElementAsDocument } from "@/lib/printDocument";
import { AssignEngineerDialog } from "@/components/AssignEngineerDialog";

const WAREHOUSE_LOCATIONS = ["AC1", "AC2 - Warehouse", "K53", "Depot RD"];

// Radix Select has no empty-string value, so "no line chosen" needs a sentinel.
const ANY_LINE = "__any_line__";

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
import { SLA_TARGETS } from "@/lib/sla";
import { getWoStatusConfig } from "@/lib/woStatusConfig";
import { ShiftFilter } from "@/components/ShiftFilter";
import { ReportPrintHeader } from "@/components/reports/ReportPrintHeader";
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

/** Waiting time in the shortest form that still reads correctly on a badge. */
function formatWait(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export default function WorkOrdersPage() {
  const { user, role, profile } = useAuth();
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
  const [printMode, setPrintMode] = useState(false); // when printing, render ALL filtered rows (not just the current page)
  const [shiftFilter, setShiftFilter] = useState<"ALL" | "DAY" | "NIGHT">("ALL");
  const [lineFilter, setLineFilter] = useState<string>("all");

  // #12 Default period filter is "Today" for every role — no longer forced to "All"
  // for admin/manager (that override was hiding today's WOs on first load).
  const [lineStoppedFilter, setLineStoppedFilter] = useState<"all" | "stopped" | "running">("all");
  // Corrective is not a stored value: it is everything that is neither warehouse
  // service nor planned preventive work. Naming it that way keeps the filter honest
  // about the 300+ orders raised before the type existed, which are production rows
  // with no third value to distinguish them.
  const [typeFilter, setTypeFilter] = useState<"all" | "corrective" | "preventive" | "warehouse_service">("all");

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
  const closeWO = useCloseWorkOrder();
  const createWO = useCreateWorkOrder();
  const updateWO = useUpdateWorkOrder();
  const moveStage = useMoveWorkOrderStage();
  const [dragOverStage, setDragOverStage] = useState<WOStage | null>(null);

  const { data: machines } = useMachines();
  const { data: lines } = useLines();
  const { data: problemDescriptions } = useActiveProblemDescriptions();
  const { data: engineerScores } = useEngineerScores();

  const woIds = useMemo(() => workOrders?.map((w) => w.id) ?? [], [workOrders]);
  const { data: partsCounts } = usePartsCountByWOs(woIds);


  const [showCreate, setShowCreate] = useState(false);
  const [newWoType, setNewWoType] = useState<"production" | "warehouse_service">("production");
  const [newWarehouseLocation, setNewWarehouseLocation] = useState("");
  const [newLineStopped, setNewLineStopped] = useState<"stopped" | "running">("running");
  const [newRequester, setNewRequester] = useState("");
  const [newLineId, setNewLineId] = useState("");
  const [newMachine, setNewMachine] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const showErr = (field: string, empty: boolean) => empty && (submitAttempted || touched[field]);
  const markTouched = (field: string) => setTouched((t) => (t[field] ? t : { ...t, [field]: true }));
  
  

  const [editWO, setEditWO] = useState<WorkOrder | null>(null);
  const [editRequester, setEditRequester] = useState("");
  const [editMachine, setEditMachine] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editNotes, setEditNotes] = useState("");

  // Force close now asks whether the line was really stopped, so it needs a dialog
  // driven by the selected order rather than one AlertDialog per row.
  const [forceCloseWO, setForceCloseWO] = useState<WorkOrder | null>(null);
  const [assignWO, setAssignWO] = useState<WorkOrder | null>(null);

  // Closing an order — signing off that the work is done, and deciding whether the
  // stoppage counted — belongs to the maintenance manager. Production managers raise
  // and chase orders; engineers finish them but do not sign off their own work. The
  // database enforces the same rule, so hiding the button is only the courtesy of not
  // offering something that would be refused.
  const canSignOff = role === "admin" || role === "maintenance_manager";
  const canAssign = canSignOff || role === "manager";

  /** Minutes an open order has gone without an engineer accepting it. */
  const unacceptedMinutes = (wo: WorkOrder) =>
    wo.status === "open" && !wo.received_at ? differenceInMinutes(new Date(), new Date(wo.created_at)) : null;

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

  // Machines offered when creating an order.
  //
  // The old list matched a machine to the selected line by comparing the line's
  // name to m.current_line / m.fixed_line — neither column exists on machines, so
  // it fell through to m.line, a free-text field. Any machine whose text differs
  // from the line's name was unreachable: the two Gel machines say "Gel Line" while
  // the line is named "GEL Machine", so that line reported "No machines for this
  // line". Worse, the select was disabled until a line was chosen, and the sealers,
  // printers, Tablet Line and warehouse assets belong to no line at all — there was
  // no way to raise an order against any of them.
  //
  // So: match on line_id first (the real relation), fall back to the name for rows
  // that predate it, and with no line selected offer every machine.
  const machineOptions = useMemo(() => {
    const all = (machines || []) as any[];
    if (!newLineId) return all;
    const lineName = lines?.find((l: any) => l.id === newLineId)?.name;
    const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "");
    const byId = all.filter((m) => m.line_id === newLineId);
    if (byId.length) return byId;
    return all.filter((m) => {
      const base = (m.line || "").toString();
      if (!base || !lineName) return false;
      const withSide = m.side === "A" || m.side === "B" ? `${base}${m.side}` : base;
      return norm(withSide) === norm(lineName) || norm(base) === norm(lineName);
    });
  }, [machines, lines, newLineId]);

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
    if (typeFilter !== "all") {
      filtered = filtered.filter((w: any) => {
        const t = w.wo_type ?? "production";
        return typeFilter === "corrective" ? t === "production" : t === typeFilter;
      });
    }
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
        (w.requester_name || "").toLowerCase().includes(term) ||
        (w.machine || "").toLowerCase().includes(term) ||
        (w.description || "").toLowerCase().includes(term) ||
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
  }, [workOrders, drRange, problemFilter, machineFilter, lineFilter, lineStoppedFilter, typeFilter, searchTerm, lineNameMap, machineLineMap, shiftFilter, statusFilter]);

  const typeCounts = useMemo(() => {
    const rows = (workOrders ?? []) as any[];
    return {
      corrective: rows.filter((w) => (w.wo_type ?? "production") === "production").length,
      preventive: rows.filter((w) => w.wo_type === "preventive").length,
      warehouse: rows.filter((w) => w.wo_type === "warehouse_service").length,
    };
  }, [workOrders]);

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
  // Rows the printable table renders: all filtered rows while printing, else the current page.
  const rowsToShow = printMode ? filteredWOs : paginatedWOs;

  useMemo(() => { setCurrentPage(1); }, [statusFilter, problemFilter, machineFilter, lineFilter, typeFilter, searchTerm, drRange]);

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
    setSubmitAttempted(true);
    if (!newRequester.trim()) {
      toast({ title: "Requester required", description: "Please enter who is requesting the maintenance order.", variant: "destructive" });
      return;
    }
    if (newWoType === "warehouse_service") {
      if (!newWarehouseLocation.trim()) {
        toast({ title: "Warehouse location required", description: "Please provide the warehouse location.", variant: "destructive" });
        return;
      }
    } else if (!newMachine.trim()) {
      toast({ title: "Machine required", description: "Please select a machine before creating the maintenance order.", variant: "destructive" });
      return;
    } else if (!newLineStopped) {
      toast({ title: "Line status required", description: "Please select whether the line is stopped or running.", variant: "destructive" });
      return;
    }
    if (!newDesc.trim()) {
      toast({ title: "Problem description required", description: "Please describe the problem before creating the maintenance order.", variant: "destructive" });
      return;
    }
    try {
      if (newWoType === "warehouse_service") {
        await createWO.mutateAsync({
          requester_name: newRequester.trim(),
          wo_type: "warehouse_service",
          warehouse_location: newWarehouseLocation.trim(),
          description: newDesc.trim(),
          notes: newNotes.trim(),
        } as any);
      } else {
        await createWO.mutateAsync({ requester_name: newRequester.trim(), wo_type: "production", line_id: newLineId || undefined, machine: newMachine.trim(), description: newDesc.trim(), notes: newNotes.trim(), line_stopped: newLineStopped === "stopped" } as any);
      }
      toast({ title: "Maintenance Order Created" });
      setShowCreate(false); setNewWoType("production"); setNewWarehouseLocation(""); setNewLineStopped("running"); setNewRequester(""); setNewLineId(""); setNewMachine(""); setNewDesc(""); setNewNotes(""); setTouched({}); setSubmitAttempted(false);

    } catch (err: any) { toast({ title: "Error", description: err.message, variant: "destructive" }); }
  };

  const openEdit = (wo: WorkOrder) => {
    setEditWO(wo); setEditRequester(wo.requester_name); setEditMachine(wo.machine); setEditDesc(wo.description); setEditNotes(wo.notes || "");
  };

  const handleEdit = async () => {
    if (!editWO) return;
    try {
      await updateWO.mutateAsync({ id: editWO.id, requester_name: editRequester.trim(), machine: editMachine.trim(), description: editDesc.trim(), notes: editNotes.trim() });
      toast({ title: "Maintenance Order Updated" }); setEditWO(null);
    } catch (err: any) { toast({ title: "Error", description: err.message, variant: "destructive" }); }
  };

  const KanbanCard = ({ wo, borderColor }: { wo: WorkOrder; borderColor: string }) => {
    const pri = priorityConfig[wo.priority || "medium"] || priorityConfig.medium;
    return (
      <Card
        draggable
        onDragStart={(e) => { e.dataTransfer.setData("text/plain", wo.id); e.dataTransfer.effectAllowed = "move"; }}
        className={`cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow border-l-4 ${borderColor}`}
        onClick={() => navigate(`/dashboard/wo/${wo.id}`)}>
        <CardContent className="p-3 space-y-1">
          <div className="flex justify-between items-center">
            <span className="font-mono text-xs font-medium flex items-center gap-1">
              WO-{new Date(wo.created_at).getFullYear()}-{String(wo.wo_number).padStart(6, "0")}
              <RecurrenceBadge originalWoId={(wo as any).recurrence_of_wo_id} compact />
            </span>
            <Badge variant="outline" className={`text-2xs px-1.5 py-0 ${pri.className}`}>{pri.label}</Badge>
          </div>
          <p className="text-sm font-medium">{wo.machine}</p>
          <p className="text-xs text-muted-foreground truncate">{wo.description}</p>
          {unacceptedMinutes(wo) !== null && (
            <p className="text-2xs font-semibold text-red-600 dark:text-red-400">
              Not accepted · {formatWait(unacceptedMinutes(wo)!)}
            </p>
          )}
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{wo.requester_name}</span>
            <span>{wo.engineer?.name || "—"}</span>
          </div>
        </CardContent>
      </Card>
    );
  };

  const KanbanColumn = ({ title, items, color, borderColor, stage, note }: { title: string; items: WorkOrder[]; color: string; borderColor: string; stage: WOStage; note?: string }) => (
    <div
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOverStage(stage); }}
      onDragLeave={() => setDragOverStage((c) => (c === stage ? null : c))}
      onDrop={(e) => {
        e.preventDefault();
        setDragOverStage(null);
        const id = e.dataTransfer.getData("text/plain");
        const wo = filteredWOs?.find((w) => w.id === id);
        if (!wo || stageOfStatus(wo.status) === stage) return;
        moveStage.mutate({ wo, to: stage }, {
          onSuccess: () => toast({ title: `WO-${String(wo.wo_number).padStart(6, "0")} moved to ${title}` }),
          // The mutation refuses non-adjacent moves; surface its reason rather than
          // failing silently, so the card snapping back is explained.
          onError: (err: Error) => toast({ title: "Cannot move this order", description: err.message, variant: "destructive" }),
        });
      }}
      className={`space-y-2 rounded-lg p-2 transition-colors ${dragOverStage === stage ? "bg-primary/5 ring-2 ring-primary" : ""}`}
    >
      <div className="mb-3">
        <div className="flex items-center gap-2"><div className={`w-3 h-3 rounded-full ${color}`} /><h3 className="font-semibold text-sm">{title} ({items.length})</h3></div>
        {note && <p className="mt-0.5 pl-5 text-2xs text-muted-foreground">{note}</p>}
      </div>
      {items.map((wo) => <KanbanCard key={wo.id} wo={wo} borderColor={borderColor} />)}
      {!items.length && <p className="text-muted-foreground text-xs text-center py-4">Drop an order here</p>}
    </div>
  );

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <PageHeader
          className="print:hidden"
          title="Maintenance Orders"
          description="Manage and track all maintenance orders"
          icon={<ClipboardList className="h-5 w-5" />}
          actions={
            <>
              {role === "admin" && (
                <Button variant="destructive" size="sm" onClick={() => setShowClearWOs(true)}>
                  <AlertTriangle className="h-4 w-4 mr-2" /> Clear WOs
                </Button>
              )}
              <Button size="sm" onClick={() => setShowCreate(true)}><Plus className="h-4 w-4 mr-2" /> Create WO</Button>
            </>
          }
        />

        <Card>
          {/* Whole toolbar off the paper: the buttons were already dropped by the print
              stylesheet, which left the search box and filter selects printing as empty
              outlines above the report header. */}
          <CardHeader className="space-y-4 border-b bg-muted/30 print:hidden">
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

            {/* Row 2 — View toggle + Unified date range + Shift */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="inline-flex items-center rounded-md border bg-background p-0.5 shadow-sm">
                  <Button variant={viewMode === "table" ? "secondary" : "ghost"} size="sm" onClick={() => setViewMode("table")} className="h-9 w-9 p-0"><List className="h-4 w-4" /></Button>
                  <Button variant={viewMode === "board" ? "secondary" : "ghost"} size="sm" onClick={() => setViewMode("board")} className="h-9 w-9 p-0"><LayoutGrid className="h-4 w-4" /></Button>
                </div>
                <DateRangeFilter
                  value={drRange}
                  preset={drPreset}
                  onChange={(r, p) => { setDrRange(r); setDrPreset(p); }}
                  storageKey="work-orders"
                />
                <ShiftFilter value={shiftFilter} onChange={setShiftFilter} />
              </div>


              <div className="inline-flex items-center gap-1 rounded-md border bg-background p-0.5 shadow-sm">
                <Button variant="ghost" size="sm" className="h-9 px-2.5 text-xs" onClick={() => { if (filteredWOs) exportWorkOrdersCsv(filteredWOs, undefined, partsCounts); }}>
                  <Download className="h-3.5 w-3.5 mr-1" /> CSV
                </Button>
                <Button variant="ghost" size="sm" className="h-9 px-2.5 text-xs" onClick={async () => {
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
                  // Completed per engineer, counted from the orders in scope. This was
                  // hard-coded to 0, so the PDF's engineer ranking reported that nobody
                  // had finished anything.
                  const completedByEngineer = new Map<string, number>();
                  for (const w of allWOs) {
                    if (!(WO_TERMINAL_STATUSES as readonly string[]).includes(w.status)) continue;
                    const name = (w.engineer_name || "").trim();
                    if (name) completedByEngineer.set(name, (completedByEngineer.get(name) ?? 0) + 1);
                  }
                  const engPerf = engineerScores?.map((s) => {
                    const name = s.engineer_name || "Unknown";
                    return { name, score: s.score, completed: completedByEngineer.get(name) ?? 0 };
                  }) || [];
                  const openWOs = allWOs.filter((w) => isWoOpen(w.status)).length;

                  // SLA: response time against the target for the order's priority —
                  // the same definition Analytics uses. It was hard-coded to 0, so every
                  // PDF ever generated reported 0% SLA compliance.
                  let slaCounted = 0, slaMet = 0;
                  for (const w of allWOs) {
                    if (!w.received_at) continue;
                    slaCounted++;
                    const responseMin = differenceInMinutes(new Date(w.received_at as string), new Date(w.created_at));
                    if (responseMin <= (SLA_TARGETS[w.priority || "medium"] ?? 60)) slaMet++;
                  }
                  const slaRate = slaCounted ? Math.round((slaMet / slaCounted) * 100) : 0;
                  // Real KPIs (were hard-coded to 0): response = opened→received, MTTR = start→finish.
                  const respArr = allWOs.filter((w) => w.received_at).map((w) => differenceInMinutes(new Date(w.received_at as string), new Date(w.created_at)));
                  const mttrArr = allWOs.filter((w) => w.started_at && w.finished_at).map((w) => differenceInMinutes(new Date(w.finished_at as string), new Date(w.started_at as string)));
                  const avg = (a: number[]) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0);
                  try {
                    const { generatePdfReport } = await import("@/lib/generatePdfReport");
                    await generatePdfReport({
                      workOrders: allWOs,
                      machineLineMap,
                      engineerRanking: engPerf,
                      kpis: { avgResponse: avg(respArr), avgMTTR: avg(mttrArr), totalWOs: allWOs.length, openWOs, slaRate },
                      dateRange: drPreset === "custom" ? `${drRange.from ? format(drRange.from, "yyyy-MM-dd") : "…"} to ${drRange.to ? format(drRange.to, "yyyy-MM-dd") : "…"}` : drPreset !== "all" ? drPreset : "All records",
                      callerRole: role,
                      // The shift was already filtering the list on screen but never
                      // reached the report, so a day-shift PDF looked identical to a
                      // night one.
                      shiftLabel: shiftFilter === "ALL" ? "All shifts" : shiftFilter === "DAY" ? "Day (06–18)" : "Night (18–06)",
                      generatedBy: user?.email ?? null,
                    });
                  } catch (err: any) {
                    toast({ title: "Cannot generate PDF", description: err?.message ?? "Failed to generate report.", variant: "destructive" });
                  }
                }}>
                  <FileText className="h-3.5 w-3.5 mr-1" /> PDF
                </Button>
                <Button variant="ghost" size="sm" className="h-9 px-2.5 text-xs no-print" onClick={() => {
                  if (role !== "admin" && (role !== "manager" && role !== "maintenance_manager")) {
                    toast({ title: "Cannot print", description: "You don't have permission to print reports.", variant: "destructive" });
                    return;
                  }
                  if (viewMode === "board") {
                    toast({ title: "Switch to the list view to print", description: "The printed report is the table — the board has no printable form." });
                    return;
                  }
                  // Render the full filtered list, then print it as its own document,
                  // then restore pagination. Printing the page itself meant fighting
                  // the dashboard shell (sidebar, sticky header, two nested
                  // overflow-hidden flex containers) with !important rules.
                  setPrintMode(true);
                  setTimeout(async () => {
                    const el = document.getElementById("wo-list-print");
                    try {
                      if (el) await printElementAsDocument(el, "Maintenance Orders");
                    } catch (err: any) {
                      toast({ title: "Could not print", description: err?.message ?? "The print dialog did not open.", variant: "destructive" });
                    } finally {
                      setPrintMode(false);
                    }
                  }, 120);
                }}>
                  <Printer className="h-3.5 w-3.5 mr-1" /> Print
                </Button>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-9 px-2.5 text-xs"><SlidersHorizontal className="h-3.5 w-3.5 mr-1" /> Columns</Button>
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
            <div className="grid grid-cols-2 md:flex md:items-center gap-2 md:flex-wrap filters-section">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full md:w-[150px] h-9 bg-background"><SelectValue placeholder="Status" /></SelectTrigger>
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
                <SelectTrigger className="w-full md:w-[150px] h-9 bg-background"><SelectValue placeholder="Line" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Lines</SelectItem>
                  {distinctLines.map((line) => <SelectItem key={line} value={line}>{line}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={problemFilter} onValueChange={setProblemFilter}>
                <SelectTrigger className="w-full md:w-[170px] h-9 bg-background"><SelectValue placeholder="Problem" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Problems</SelectItem>
                  {problemDescriptions?.map((pd) => <SelectItem key={pd.id} value={pd.name}>{pd.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={machineFilter} onValueChange={setMachineFilter}>
                <SelectTrigger className="w-full md:w-[170px] h-9 bg-background"><SelectValue placeholder="Machine" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Machines</SelectItem>
                  {machines?.map((m) => <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <div className="flex flex-col gap-1">
                <Label className="text-2xs uppercase tracking-wider text-muted-foreground font-medium">Type</Label>
                <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as typeof typeFilter)} aria-label="Order type">
                  <SelectTrigger className="w-full md:w-[180px] h-9 bg-background">
                    <SelectValue placeholder="All types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All types</SelectItem>
                    <SelectItem value="corrective">Corrective ({typeCounts.corrective})</SelectItem>
                    <SelectItem value="preventive">Preventive ({typeCounts.preventive})</SelectItem>
                    <SelectItem value="warehouse_service">Warehouse ({typeCounts.warehouse})</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-2xs uppercase tracking-wider text-muted-foreground font-medium">Line Status</Label>
                <Select
                  value={lineStoppedFilter}
                  onValueChange={(v) => setLineStoppedFilter(v as "all" | "stopped" | "running")}
                  aria-label="Line Status"
                >
                  <SelectTrigger className="w-full md:w-[180px] h-9 bg-background">
                    <SelectValue placeholder="All Lines Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Lines Status</SelectItem>
                    <SelectItem value="stopped">Stopped ({stoppedCount})</SelectItem>
                    <SelectItem value="running">Running ({runningCount})</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

          </CardHeader>
          <CardContent id="wo-list-print">
            {/* The shared report header, instead of the hand-rolled one this page used
                to carry: inline point sizes and #666/#999 greys with no brand, which
                printed nothing like the rest of the system's reports. It also carries
                the shift, which the old header omitted. */}
            <ReportPrintHeader
              title="Maintenance Orders"
              periodLabel={
                drPreset === "custom"
                  ? `${drRange.from ? format(drRange.from, "dd/MM/yyyy") : "…"} — ${drRange.to ? format(drRange.to, "dd/MM/yyyy") : "…"}`
                  : drPreset !== "all" ? String(drPreset) : "All records"
              }
              shift={shiftFilter === "ALL" ? "All shifts" : shiftFilter === "DAY" ? "Day (06–18)" : "Night (18–06)"}
              filtersLabel={[
                lineFilter !== "all" ? `Line: ${lineFilter}` : null,
                statusFilter !== "all" ? `Status: ${statusFilter}` : null,
                machineFilter !== "all" ? `Machine: ${machineFilter}` : null,
              ].filter(Boolean).join("  ·  ") || undefined}
            />
            {isLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : !filteredWOs?.length ? (
              <div className="text-center py-12">
                <ClipboardList className="h-12 w-12 mx-auto text-muted-foreground/40 mb-3" />
                <p className="text-muted-foreground font-medium">No maintenance orders found</p>
                <p className="text-muted-foreground text-sm mt-1">Try adjusting your filters or create a new maintenance order.</p>
              </div>
            ) : viewMode === "board" ? (
              <div className="grid grid-cols-1 md:grid-cols-5 gap-4 no-print">
                <KanbanColumn title="Open" items={kanbanColumns.open} color="bg-blue-500" borderColor="border-l-blue-500" stage="open" />
                <KanbanColumn title="Received/Arrived" items={kanbanColumns.received} color="bg-indigo-500" borderColor="border-l-indigo-500" stage="received" />
                <KanbanColumn title="In Progress" items={kanbanColumns.inProgress} color="bg-amber-500" borderColor="border-l-amber-500" stage="in_progress" />
                <KanbanColumn title="Finished" items={kanbanColumns.finished} color="bg-teal-500" borderColor="border-l-teal-500" stage="finished" note="Waiting for the maintenance manager to sign off" />
                <KanbanColumn title="Done" items={kanbanColumns.done} color="bg-green-500" borderColor="border-l-green-500" stage="closed" />
              </div>
            ) : (
              <div className="print-content">
                {/* Mobile card list (< md). Explicitly print:hidden — the print media
                    query is evaluated against the paper width, so on A4 the breakpoint
                    is a coin toss and a tablet could print the cards, the table, or
                    neither. The printed document is always the table. */}
                <div className="md:hidden print:hidden space-y-3">
                  {rowsToShow.map((wo) => {
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
                              {(wo as any).wo_type === "warehouse_service" && (
                                <Badge variant="outline" className="bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30 text-2xs" title="Warehouse service — not counted as line downtime">Warehouse</Badge>
                              )}
                              <Badge variant="outline" className={cfg.className}>{cfg.label}</Badge>
                              {isStale && (
                                <Badge variant="outline" className="bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30 text-2xs" title="In progress > 3 days">Stale</Badge>
                              )}
                              {unacceptedMinutes(wo) !== null && (
                                <Badge variant="outline" className="bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30 text-2xs" title="No engineer has accepted this order yet">
                                  Not accepted · {formatWait(unacceptedMinutes(wo)!)}
                                </Badge>
                              )}
                            </div>
                          </div>
                          <div className="text-sm font-medium">
                            {(wo as any).wo_type === "warehouse_service"
                              ? <>Warehouse <span className="text-muted-foreground font-normal">· {(wo as any).warehouse_location || "—"}</span></>
                              : <>{wo.machine} <span className="text-muted-foreground font-normal">· {woLine}</span></>}
                          </div>
                          <p className="text-sm text-muted-foreground line-clamp-2">{wo.description}</p>
                          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground flex-wrap">
                            <span>{wo.requester_name} → {wo.engineer?.name || "—"}</span>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className={`text-2xs px-1.5 py-0 ${pri.className}`}>{pri.label}</Badge>
                              <span>{format(new Date(wo.created_at), "dd/MM HH:mm")}</span>
                            </div>
                          </div>
                          <div className="flex gap-2 pt-1" onClick={(e) => e.stopPropagation()}>
                            <Button size="sm" variant="outline" className="h-10 flex-1 touch-manipulation" onClick={() => openEdit(wo)}>
                              <Pencil className="h-4 w-4 mr-1" /> Edit
                            </Button>
                            {unacceptedMinutes(wo) !== null && canAssign && (
                              <Button size="sm" variant="outline" className="h-10 flex-1 touch-manipulation" onClick={() => setAssignWO(wo)}>
                                <UserPlus className="h-4 w-4 mr-1" /> Assign
                              </Button>
                            )}
                            {canClose && canSignOff && (
                              <Button size="sm" variant="default" className="h-10 flex-1 touch-manipulation" onClick={() => closeWO.mutate({ woId: wo.id, signatureName: profile?.name || "Maintenance Manager" })} disabled={closeWO.isPending}>
                                {closeWO.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-1" />} Sign off
                              </Button>
                            )}
                            {canForceClose && canSignOff && (
                              <Button size="sm" variant="destructive" className="h-10 flex-1 touch-manipulation" onClick={() => setForceCloseWO(wo)}>
                                <XCircle className="h-4 w-4 mr-1" /> Force
                              </Button>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>

                {/* Desktop table (≥ md), and the printed document at any width */}
                <Table className="hidden md:table print:table print:w-full">
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
                    {rowsToShow.map((wo) => {
                      const cfg = getWoStatusConfig(wo.status);
                      const canForceClose = ["open", "received", "arrived", "in_progress"].includes(wo.status);
                      const canClose = wo.status === "finished";
                      const woLine = getWoLine(wo) || "—";
                      return (
                        <TableRow key={wo.id}>
                          {isCol("wo") && (
                            <TableCell className="font-mono font-medium">
                              <div className="flex items-center gap-2">
                                <button type="button" className="cursor-pointer text-left hover:underline focus:outline-none focus:ring-2 focus:ring-ring rounded" onClick={() => navigate(`/dashboard/wo/${wo.id}`)}>
                                  WO-{new Date(wo.created_at).getFullYear()}-{String(wo.wo_number).padStart(6, "0")}
                                </button>
                                <RecurrenceBadge originalWoId={(wo as any).recurrence_of_wo_id} compact />
                              </div>
                            </TableCell>
                          )}
                          {isCol("line") && (
                            <TableCell className="text-sm font-medium">
                              {(wo as any).wo_type === "warehouse_service" ? (
                                <Badge variant="outline" className="bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30 text-2xs" title="Warehouse service — not counted as line downtime">Warehouse</Badge>
                              ) : (
                                <span className="flex flex-wrap items-center gap-1">
                                  {woLine}
                                  {(wo as any).wo_type === "preventive" && (
                                    // A preventive order sits in the same list as the
                                    // breakdowns; without this it reads as one.
                                    <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/15 text-2xs text-success-strong" title="Planned preventive work — books no downtime">
                                      Preventive
                                    </Badge>
                                  )}
                                </span>
                              )}
                            </TableCell>
                          )}
                          {isCol("machine") && <TableCell className={(wo as any).wo_type === "warehouse_service" ? "text-sm text-muted-foreground" : "cursor-pointer hover:underline"} onClick={(wo as any).wo_type === "warehouse_service" ? undefined : () => navigate(`/dashboard/machines/${encodeURIComponent(wo.machine)}/history`)}>{(wo as any).wo_type === "warehouse_service" ? ((wo as any).warehouse_location || "—") : wo.machine}</TableCell>}
                          {isCol("problem") && <TableCell className="text-sm text-muted-foreground truncate max-w-[200px]">{wo.description}</TableCell>}
                          {isCol("status") && <TableCell>
                            <div className="flex items-center gap-1">
                              <Badge variant="outline" className={cfg.className}>{cfg.label}</Badge>
                              {wo.status === "in_progress" && wo.started_at && differenceInMinutes(new Date(), new Date(wo.started_at)) > 4320 && (
                                <Badge className="bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30 text-2xs" variant="outline" title="This maintenance order has been in progress for more than 3 days. Consider reviewing or closing it.">Stale</Badge>
                              )}
                              {/* An open order with no received_at has not been accepted by anyone.
                                  Nothing on the board said so, which is how WO-605 waited from
                                  29/07 13:04 to the next morning without anyone noticing. */}
                              {unacceptedMinutes(wo) !== null && (
                                <Badge variant="outline" className="bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30 text-2xs" title="No engineer has accepted this order yet">
                                  Not accepted · {formatWait(unacceptedMinutes(wo)!)}
                                </Badge>
                              )}
                            </div>
                          </TableCell>}
                          {isCol("requester") && <TableCell className="text-sm">{wo.requester_name}</TableCell>}
                          {isCol("engineer") && <TableCell className="text-sm">{wo.engineer?.name || "—"}</TableCell>}
                          {isCol("created") && <TableCell className="text-sm text-muted-foreground">{format(new Date(wo.created_at), "dd/MM HH:mm")}</TableCell>}
                          {isCol("parts") && <TableCell className="no-print">{partsCounts?.[wo.id] ? <Badge variant="secondary">{partsCounts[wo.id]}</Badge> : "—"}</TableCell>}
                          {isCol("actions") && <TableCell className="no-print">
                            <div className="flex gap-1">
                              {/* This carried a printer icon but only opened the order in a new
                                  tab, so clicking the printer on a row printed nothing and the
                                  order sheet had to be found and printed by hand. It now opens
                                  the order asking it to print itself. */}
                              {(role === "admin" || (role === "manager" || role === "maintenance_manager")) && (
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  aria-label={`Print WO-${String(wo.wo_number).padStart(6, "0")}`}
                                  title="Print this order"
                                  onClick={() => window.open(`/dashboard/wo/${wo.id}?print=1`, "_blank")}
                                >
                                  <Printer className="h-4 w-4" />
                                </Button>
                              )}
                              <Button size="icon" variant="ghost" aria-label="Edit maintenance order" onClick={() => openEdit(wo)}><Pencil className="h-4 w-4" /></Button>
                              {/* No delete. An order that should not have existed is force-closed,
                                  which keeps its history and leaves an audit trail; deleting it
                                  took the downtime, parts and timings with it. */}
                              {unacceptedMinutes(wo) !== null && canAssign && (
                                <Button size="sm" variant="outline" onClick={() => setAssignWO(wo)}>
                                  <UserPlus className="h-3 w-3 mr-1" /> Assign
                                </Button>
                              )}
                              {canClose && canSignOff && (
                                <Button size="sm" variant="default" onClick={() => closeWO.mutate({ woId: wo.id, signatureName: profile?.name || "Maintenance Manager" })} disabled={closeWO.isPending}>
                                  {closeWO.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <CheckCircle className="h-3 w-3 mr-1" />} Sign off
                                </Button>
                              )}
                              {canForceClose && canSignOff && (
                                <Button size="sm" variant="destructive" onClick={() => setForceCloseWO(wo)}>
                                  <XCircle className="h-3 w-3 mr-1" /> Force
                                </Button>
                              )}
                            </div>
                          </TableCell>}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                {/* Printed summary + footer. The on-screen pager is meaningless on paper
                    (print always renders every filtered row), so it is replaced by the
                    row count and a signed-off footer line. */}
                <div className="print-doc-footer hidden print:block mt-3 pt-2 border-t border-black text-[8pt]">
                  <div className="flex items-center justify-between">
                    <span><b>{filteredWOs.length}</b> maintenance order{filteredWOs.length === 1 ? "" : "s"} in this report</span>
                    <span>Applied Nutrition · Confidential · {user?.email ?? ""}</span>
                  </div>
                </div>
                {totalPages > 1 && (
                  <div className="flex items-center justify-between mt-4 print:hidden">
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
        <Dialog open={showCreate} onOpenChange={(o) => { setShowCreate(o); if (!o) { setTouched({}); setSubmitAttempted(false); } }}>
          <DialogContent>
            <DialogHeader><DialogTitle>Create Maintenance Order</DialogTitle><DialogDescription className="sr-only">Fill in maintenance order details</DialogDescription></DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4" autoComplete="off">
              <div className="space-y-2"><Label>Requested By <span className="text-destructive-strong">*</span></Label>
                <Input value={newRequester} onChange={(e) => setNewRequester(e.target.value)} onBlur={() => markTouched("requester")} placeholder="Your name / tablet" className={showErr("requester", !newRequester) ? "border-destructive focus-visible:ring-destructive" : ""} />
                {showErr("requester", !newRequester) && <p className="text-xs text-destructive-strong">Requester is required</p>}
              </div>
              <div className="space-y-2"><Label>Type <span className="text-destructive-strong">*</span></Label>
                <Select value={newWoType} onValueChange={(v: any) => setNewWoType(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="production">Production (line / machine)</SelectItem>
                    <SelectItem value="warehouse_service">Warehouse Service</SelectItem>
                  </SelectContent>
                </Select>
                {newWoType === "warehouse_service" && (
                  <p className="text-xs text-muted-foreground">Warehouse service requests are never counted as line downtime or OEE loss.</p>
                )}
              </div>
              {newWoType === "warehouse_service" ? (
                <div className="space-y-2"><Label>Warehouse Location <span className="text-destructive-strong">*</span></Label>
                  <ComboboxInput value={newWarehouseLocation} onChange={setNewWarehouseLocation} suggestions={WAREHOUSE_LOCATIONS} placeholder="Select or type a warehouse location" className={showErr("warehouseLocation", !newWarehouseLocation) ? "border-destructive focus-visible:ring-destructive" : ""} />
                  {showErr("warehouseLocation", !newWarehouseLocation) && <p className="text-xs text-destructive-strong">Warehouse location is required</p>}
                </div>
              ) : (
                <>
                  <div className="space-y-2"><Label>Line <span className="text-xs font-normal text-muted-foreground">(optional — narrows the machine list)</span></Label>
                    <Select value={newLineId || ANY_LINE} onValueChange={(v) => { setNewLineId(v === ANY_LINE ? "" : v); setNewMachine(""); }}>
                      <SelectTrigger><SelectValue placeholder="Any line" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ANY_LINE}>Any line — show all machines</SelectItem>
                        {lines?.map((l: any) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2"><Label>Machine <span className="text-destructive-strong">*</span></Label>
                    <Select value={newMachine} onValueChange={(v) => { setNewMachine(v); markTouched("machine"); }}>
                      <SelectTrigger className={showErr("machine", !newMachine) ? "border-destructive focus:ring-destructive" : ""}><SelectValue placeholder="Select machine..." /></SelectTrigger>
                      <SelectContent>
                        {machineOptions.map((m: any) => {
                          const isUuid = typeof m.code === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(m.code);
                          const showCode = m.code && !isUuid;
                          return (
                            <SelectItem key={m.id} value={m.name}>
                              {m.name}{showCode ? ` (${m.code})` : ""}
                              {!newLineId && m.line ? <span className="text-muted-foreground"> · {m.line}</span> : null}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                    {showErr("machine", !newMachine) && <p className="text-xs text-destructive-strong">Machine is required</p>}
                    <p className="text-xs text-muted-foreground">
                      {newLineId
                        ? `Showing the ${machineOptions.length} machine${machineOptions.length === 1 ? "" : "s"} on this line. Clear the line to see all machines.`
                        : "Every machine, including sealers, printers and warehouse assets. Pick a line above to narrow the list."}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>Line Status <span className="text-destructive-strong">*</span></Label>
                    <Select value={newLineStopped} onValueChange={(v: any) => { setNewLineStopped(v); markTouched("lineStopped"); }}>
                      <SelectTrigger className={showErr("lineStopped", !newLineStopped) ? "border-destructive focus:ring-destructive" : ""}><SelectValue placeholder="Select line status..." /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="stopped">Stopped</SelectItem>
                        <SelectItem value="running">Running</SelectItem>
                      </SelectContent>
                    </Select>
                    {showErr("lineStopped", !newLineStopped) && <p className="text-xs text-destructive-strong">Line status is required</p>}
                  </div>
                </>
              )}
              <div className="space-y-2"><Label>Problem Description <span className="text-destructive-strong">*</span></Label>
                <Select value={newDesc} onValueChange={(v) => { setNewDesc(v); markTouched("desc"); }}>
                  <SelectTrigger className={showErr("desc", !newDesc) ? "border-destructive focus:ring-destructive" : ""}><SelectValue placeholder="Select problem..." /></SelectTrigger>
                  <SelectContent>{problemDescriptions?.map((pd) => <SelectItem key={pd.id} value={pd.name}>{pd.name}</SelectItem>)}</SelectContent>
                </Select>
                {showErr("desc", !newDesc) && <p className="text-xs text-destructive-strong">Problem description is required</p>}
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
            <DialogHeader><DialogTitle>Edit Maintenance Order</DialogTitle><DialogDescription className="sr-only">Modify maintenance order details</DialogDescription></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2"><Label>Requested By</Label>
                <Input value={editRequester} onChange={(e) => setEditRequester(e.target.value)} placeholder="Your name / tablet" />
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

        <ForceCloseDialog wo={forceCloseWO} open={!!forceCloseWO} onOpenChange={(o) => { if (!o) setForceCloseWO(null); }} />
        <AssignEngineerDialog wo={assignWO} open={!!assignWO} onOpenChange={(o) => { if (!o) setAssignWO(null); }} />

        {/* Clear All WOs */}
        <AlertDialog open={showClearWOs} onOpenChange={(o) => { setShowClearWOs(o); if (!o) { setClearPin(""); setClearConfirmText(""); } }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Clear all maintenance orders?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete ALL maintenance orders, messages, photos, parts used records, and engineer scores. This action cannot be undone. Enter admin PIN and type CONFIRM to proceed.
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
                  toast({ title: "Maintenance orders cleared", description: "All maintenance order data has been removed." });
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
