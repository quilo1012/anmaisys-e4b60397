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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { ClipboardList, XCircle, Loader2, Download, Plus, Pencil, Trash2, Search, LayoutGrid, List, ChevronLeft, ChevronRight, Printer, CheckCircle, AlertTriangle, SlidersHorizontal } from "lucide-react";
import { useWorkOrders, useForceCloseWorkOrder, useCloseWorkOrder, useCreateWorkOrder, useUpdateWorkOrder, useDeleteWorkOrder, type WOStatus, type WorkOrder } from "@/hooks/useWorkOrders";
import { usePartsCountByWOs } from "@/hooks/useStock";
import { useMachines } from "@/hooks/useMachines";
import { useActiveProblemDescriptions } from "@/hooks/useProblemDescriptions";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { format, subDays, startOfDay, endOfDay, startOfMonth } from "date-fns";
import { exportWorkOrdersCsv } from "@/lib/exportCsv";
import { useToast } from "@/hooks/use-toast";
import { useEngineerScores } from "@/hooks/useEngineerScores";
import { generatePdfReport } from "@/lib/generatePdfReport";
import { FileText } from "lucide-react";

const statusConfig: Record<string, { label: string; className: string }> = {
  open: { label: "Open", className: "bg-blue-100 text-blue-800 border-blue-200" },
  received: { label: "Received", className: "bg-indigo-100 text-indigo-800 border-indigo-200" },
  arrived: { label: "Arrived", className: "bg-purple-100 text-purple-800 border-purple-200" },
  in_progress: { label: "In Progress", className: "bg-amber-100 text-amber-800 border-amber-200" },
  finished: { label: "Finished", className: "bg-teal-100 text-teal-800 border-teal-200" },
  closed: { label: "Closed", className: "bg-green-100 text-green-800 border-green-200" },
  completed: { label: "Completed", className: "bg-green-100 text-green-800 border-green-200" },
  force_closed: { label: "Force Closed", className: "bg-gray-100 text-gray-800 border-gray-200" },
};

const priorityConfig: Record<string, { label: string; className: string }> = {
  low: { label: "Low", className: "bg-slate-100 text-slate-700" },
  medium: { label: "Medium", className: "bg-blue-100 text-blue-700" },
  high: { label: "High", className: "bg-orange-100 text-orange-700" },
  critical: { label: "Critical", className: "bg-red-100 text-red-700" },
};

const ITEMS_PER_PAGE = 20;

export default function WorkOrdersPage() {
  const { user, role } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  
  const [problemFilter, setProblemFilter] = useState<string>("all");
  const [machineFilter, setMachineFilter] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [viewMode, setViewMode] = useState<"table" | "board">("table");
  const [currentPage, setCurrentPage] = useState(1);
const [dateQuickFilter, setDateQuickFilter] = useState<string>("today");
  const [lineFilter, setLineFilter] = useState<string>("all");

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

  const filterStatuses = statusFilter === "all" ? undefined : [statusFilter as WOStatus];
  const { data: workOrders, isLoading } = useWorkOrders({ statusIn: filterStatuses });
  const forceClose = useForceCloseWorkOrder();
  const closeWO = useCloseWorkOrder();
  const createWO = useCreateWorkOrder();
  const updateWO = useUpdateWorkOrder();
  const deleteWO = useDeleteWorkOrder();

  const { data: machines } = useMachines();
  const { data: problemDescriptions } = useActiveProblemDescriptions();
  const { data: engineerScores } = useEngineerScores();

  const woIds = useMemo(() => workOrders?.map((w) => w.id) ?? [], [workOrders]);
  const { data: partsCounts } = usePartsCountByWOs(woIds);

  const [showCreate, setShowCreate] = useState(false);
  const [newRequester, setNewRequester] = useState("");
  const [newMachine, setNewMachine] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newNotes, setNewNotes] = useState("");
  

  const [editWO, setEditWO] = useState<WorkOrder | null>(null);
  const [editRequester, setEditRequester] = useState("");
  const [editMachine, setEditMachine] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editNotes, setEditNotes] = useState("");

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showClearWOs, setShowClearWOs] = useState(false);
  const [clearPin, setClearPin] = useState("");
  const [clearing, setClearing] = useState(false);

  // Build machine line lookup
  const machineLineMap = useMemo(() => {
    const map: Record<string, string> = {};
    machines?.forEach((m) => { map[m.name] = m.line || ""; });
    return map;
  }, [machines]);

  const distinctLines = useMemo(() => {
    const lines = new Set<string>();
    machines?.forEach((m) => { if (m.line) lines.add(m.line); });
    return Array.from(lines).sort();
  }, [machines]);

  const filteredWOs = useMemo(() => {
    if (!workOrders) return [];
    let filtered = workOrders;
    const now = new Date();
    if (dateQuickFilter === "today") {
      const start = startOfDay(now); const end = endOfDay(now);
      filtered = filtered.filter((w) => { const d = new Date(w.created_at); return d >= start && d <= end; });
    } else if (dateQuickFilter === "yesterday") {
      const start = startOfDay(subDays(now, 1)); const end = endOfDay(subDays(now, 1));
      filtered = filtered.filter((w) => { const d = new Date(w.created_at); return d >= start && d <= end; });
    } else if (dateQuickFilter === "7days") {
      filtered = filtered.filter((w) => new Date(w.created_at) >= startOfDay(subDays(now, 6)));
    } else if (dateQuickFilter === "month") {
      filtered = filtered.filter((w) => new Date(w.created_at) >= startOfMonth(now));
    } else {
      if (dateFrom) filtered = filtered.filter((w) => w.created_at >= dateFrom);
      if (dateTo) filtered = filtered.filter((w) => w.created_at <= dateTo + "T23:59:59");
    }
    if (problemFilter !== "all") filtered = filtered.filter((w) => w.description === problemFilter);
    if (machineFilter !== "all") filtered = filtered.filter((w) => w.machine === machineFilter);
    if (lineFilter !== "all") filtered = filtered.filter((w) => machineLineMap[w.machine] === lineFilter);
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
    // Sort: by line name first, then newest first
    filtered = [...filtered].sort((a, b) => {
      const lineA = machineLineMap[a.machine] || "zzz";
      const lineB = machineLineMap[b.machine] || "zzz";
      if (lineA !== lineB) return lineA.localeCompare(lineB);
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
    return filtered;
  }, [workOrders, dateQuickFilter, dateFrom, dateTo, problemFilter, machineFilter, lineFilter, searchTerm, machineLineMap]);

  const totalPages = Math.ceil((filteredWOs?.length ?? 0) / ITEMS_PER_PAGE);
  const paginatedWOs = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredWOs.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredWOs, currentPage]);

  useMemo(() => { setCurrentPage(1); }, [statusFilter, problemFilter, machineFilter, lineFilter, searchTerm, dateQuickFilter, dateFrom, dateTo]);

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
      await createWO.mutateAsync({ requester_name: newRequester.trim(), machine: newMachine.trim(), description: newDesc.trim(), notes: newNotes.trim(), priority: "medium" });
      toast({ title: "Work Order Created" });
      setShowCreate(false); setNewRequester(""); setNewMachine(""); setNewDesc(""); setNewNotes("");
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
            <span className="font-mono text-xs font-medium">WO-{new Date(wo.created_at).getFullYear()}-{String(wo.wo_number).padStart(6, "0")}</span>
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
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-2"><ClipboardList className="h-6 w-6" /> Work Orders</h2>
            <p className="text-muted-foreground">Manage and track all work orders</p>
          </div>
          <div className="flex gap-2">
            {role === "admin" && (
              <Button variant="destructive" size="sm" onClick={() => setShowClearWOs(true)}>
                <AlertTriangle className="h-4 w-4 mr-2" /> Clear WOs
              </Button>
            )}
            <Button onClick={() => setShowCreate(true)}><Plus className="h-4 w-4 mr-2" /> Create WO</Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex border rounded-md">
                  <Button variant={viewMode === "table" ? "default" : "ghost"} size="sm" onClick={() => setViewMode("table")} className="rounded-r-none"><List className="h-4 w-4" /></Button>
                  <Button variant={viewMode === "board" ? "default" : "ghost"} size="sm" onClick={() => setViewMode("board")} className="rounded-l-none"><LayoutGrid className="h-4 w-4" /></Button>
                </div>
                <div className="flex gap-1">
                  {([["today", "Today"], ["yesterday", "Yesterday"], ["7days", "7 Days"], ["month", "This Month"], ["all", "All"]] as const).map(([key, label]) => (
                    <Button key={key} variant={dateQuickFilter === key ? "default" : "outline"} size="sm" onClick={() => { setDateQuickFilter(key); setDateFrom(""); setDateTo(""); }}>{label}</Button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setDateQuickFilter(""); }} className="w-[140px]" />
                <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setDateQuickFilter(""); }} className="w-[140px]" />
                <Button variant="outline" size="sm" onClick={() => { if (filteredWOs) exportWorkOrdersCsv(filteredWOs, undefined, partsCounts); }}>
                  <Download className="h-4 w-4 mr-1" /> CSV
                </Button>
                <Button variant="outline" size="sm" onClick={() => {
                  if (!filteredWOs) return;
                  const allWOs = filteredWOs;
                  const engPerf = engineerScores?.map((s) => ({ name: s.engineer_name || "Unknown", score: s.score, completed: 0 })) || [];
                  const openWOs = allWOs.filter((w) => w.status === "open").length;
                  generatePdfReport({
                    workOrders: allWOs,
                    machineLineMap,
                    engineerRanking: engPerf,
                    kpis: { avgResponse: 0, avgMTTR: 0, totalWOs: allWOs.length, openWOs, slaRate: 0 },
                    dateRange: dateFrom && dateTo ? `${dateFrom} to ${dateTo}` : dateQuickFilter !== "all" ? dateQuickFilter : "All records",
                  });
                }}>
                  <FileText className="h-4 w-4 mr-1" /> PDF
                </Button>
                <Button variant="outline" size="sm" className="no-print" onClick={() => window.print()}>
                  <Printer className="h-4 w-4 mr-1" /> Print
                </Button>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm"><SlidersHorizontal className="h-4 w-4 mr-1" /> Columns</Button>
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
            <div className="flex items-center gap-2 flex-wrap mt-2 filters-section">
              <div className="relative flex-1 min-w-[200px] max-w-[300px]">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search WO#, requester, machine..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-8" />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[150px]"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="received">Received</SelectItem>
                  <SelectItem value="arrived">Arrived</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="finished">Finished</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                  <SelectItem value="force_closed">Force Closed</SelectItem>
                </SelectContent>
              </Select>
              <Select value={lineFilter} onValueChange={setLineFilter}>
                <SelectTrigger className="w-[150px]"><SelectValue placeholder="Line" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Lines</SelectItem>
                  {distinctLines.map((line) => <SelectItem key={line} value={line}>{line}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={problemFilter} onValueChange={setProblemFilter}>
                <SelectTrigger className="w-[170px]"><SelectValue placeholder="Problem" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Problems</SelectItem>
                  {problemDescriptions?.map((pd) => <SelectItem key={pd.id} value={pd.name}>{pd.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={machineFilter} onValueChange={setMachineFilter}>
                <SelectTrigger className="w-[170px]"><SelectValue placeholder="Machine" /></SelectTrigger>
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
              <p className="text-muted-foreground text-center py-8">No work orders found.</p>
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
                <Table>
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
                      const cfg = statusConfig[wo.status];
                      const canForceClose = ["open", "received", "arrived", "in_progress"].includes(wo.status);
                      const canClose = wo.status === "finished";
                      const woLine = machineLineMap[wo.machine] || "—";
                      return (
                        <TableRow key={wo.id}>
                          {isCol("wo") && <TableCell className="font-mono font-medium cursor-pointer hover:underline" onClick={() => navigate(`/dashboard/wo/${wo.id}`)}>WO-{new Date(wo.created_at).getFullYear()}-{String(wo.wo_number).padStart(6, "0")}</TableCell>}
                          {isCol("line") && <TableCell className="text-sm font-medium">{woLine}</TableCell>}
                          {isCol("machine") && <TableCell className="cursor-pointer hover:underline" onClick={() => navigate(`/dashboard/machines/${encodeURIComponent(wo.machine)}/history`)}>{wo.machine}</TableCell>}
                          {isCol("problem") && <TableCell className="text-sm text-muted-foreground truncate max-w-[200px]">{wo.description}</TableCell>}
                          {isCol("status") && <TableCell><Badge variant="outline" className={cfg.className}>{cfg.label}</Badge></TableCell>}
                          {isCol("requester") && <TableCell className="text-sm">{wo.requester_name}</TableCell>}
                          {isCol("engineer") && <TableCell className="text-sm">{wo.engineer?.name || "—"}</TableCell>}
                          {isCol("created") && <TableCell className="text-sm text-muted-foreground">{format(new Date(wo.created_at), "dd/MM HH:mm")}</TableCell>}
                          {isCol("parts") && <TableCell className="no-print">{partsCounts?.[wo.id] ? <Badge variant="secondary">{partsCounts[wo.id]}</Badge> : "—"}</TableCell>}
                          {isCol("actions") && <TableCell className="no-print">
                            <div className="flex gap-1">
                              <Button size="icon" variant="ghost" onClick={() => window.open(`/dashboard/wo/${wo.id}`, "_blank")}><Printer className="h-4 w-4" /></Button>
                              <Button size="icon" variant="ghost" onClick={() => openEdit(wo)}><Pencil className="h-4 w-4" /></Button>
                              <Button size="icon" variant="ghost" className="text-destructive" onClick={() => setDeleteId(wo.id)}><Trash2 className="h-4 w-4" /></Button>
                              {canClose && (
                                <Button size="sm" variant="default" onClick={() => closeWO.mutate(wo.id)} disabled={closeWO.isPending}>
                                  <CheckCircle className="h-3 w-3 mr-1" /> Close
                                </Button>
                              )}
                              {canForceClose && (
                                <Button size="sm" variant="destructive" onClick={() => forceClose.mutate(wo.id)} disabled={forceClose.isPending}>
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
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-2"><Label>Requested By</Label><Input value={newRequester} onChange={(e) => setNewRequester(e.target.value)} placeholder="e.g. John Smith" required /></div>
              <div className="space-y-2"><Label>Machine</Label>
                <Select value={newMachine} onValueChange={setNewMachine}>
                  <SelectTrigger><SelectValue placeholder="Select machine..." /></SelectTrigger>
                  <SelectContent>{machines?.map((m) => <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Problem Description</Label>
                <Select value={newDesc} onValueChange={setNewDesc}>
                  <SelectTrigger><SelectValue placeholder="Select problem..." /></SelectTrigger>
                  <SelectContent>{problemDescriptions?.map((pd) => <SelectItem key={pd.id} value={pd.name}>{pd.name}</SelectItem>)}</SelectContent>
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
              <div className="space-y-2"><Label>Requested By</Label><Input value={editRequester} onChange={(e) => setEditRequester(e.target.value)} /></div>
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
        <AlertDialog open={showClearWOs} onOpenChange={(o) => { setShowClearWOs(o); if (!o) setClearPin(""); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Clear all work orders?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete ALL work orders, messages, photos, parts used records, and engineer scores. This action cannot be undone. Enter the admin PIN to confirm.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="px-6 pb-2">
              <Label htmlFor="clear-pin">Security PIN</Label>
              <Input id="clear-pin" type="password" placeholder="Enter PIN..." value={clearPin} onChange={(e) => setClearPin(e.target.value)} maxLength={8} className="mt-1" />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={clearing}>Cancel</AlertDialogCancel>
              <Button variant="destructive" disabled={clearing || clearPin.length < 4} onClick={async () => {
                setClearing(true);
                try {
                  const { data: settings } = await (await import("@/integrations/supabase/client")).supabase.from("system_settings").select("admin_pin").limit(1).single();
                  if (!settings || clearPin !== settings.admin_pin) {
                    toast({ title: "Invalid PIN", description: "The PIN entered is incorrect.", variant: "destructive" });
                    setClearing(false);
                    return;
                  }
                  const { data: { session } } = await (await import("@/integrations/supabase/client")).supabase.auth.getSession();
                  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/clear-system`, {
                    method: "POST",
                    headers: { "Authorization": `Bearer ${session?.access_token}`, "Content-Type": "application/json" },
                  });
                  const result = await res.json();
                  if (!res.ok) throw new Error(result.error || "Failed");
                  toast({ title: "Work orders cleared", description: "All work order data has been removed." });
                  setShowClearWOs(false);
                  setClearPin("");
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
