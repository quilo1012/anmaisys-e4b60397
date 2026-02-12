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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { ClipboardList, XCircle, Loader2, Download, Plus, Pencil, Trash2, Search, LayoutGrid, List, ChevronLeft, ChevronRight, Printer } from "lucide-react";
import { useWorkOrders, useForceCloseWorkOrder, useCreateWorkOrder, useUpdateWorkOrder, useDeleteWorkOrder, type WOStatus, type WorkOrder } from "@/hooks/useWorkOrders";
import { usePartsCountByWOs } from "@/hooks/useStock";
import { useMachines } from "@/hooks/useMachines";
import { useActiveProblemDescriptions } from "@/hooks/useProblemDescriptions";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { format, subDays, startOfDay, endOfDay, startOfMonth } from "date-fns";
import { exportWorkOrdersCsv } from "@/lib/exportCsv";
import { useToast } from "@/hooks/use-toast";

const statusConfig: Record<string, { label: string; className: string }> = {
  open: { label: "Open", className: "bg-blue-100 text-blue-800 border-blue-200" },
  in_progress: { label: "In Progress", className: "bg-amber-100 text-amber-800 border-amber-200" },
  completed: { label: "Completed", className: "bg-green-100 text-green-800 border-green-200" },
  force_closed: { label: "Force Closed", className: "bg-gray-100 text-gray-800 border-gray-200" },
};

const ITEMS_PER_PAGE = 20;

export default function WorkOrdersPage() {
  const { user } = useAuth();
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

  const filterStatuses = statusFilter === "all" ? undefined : [statusFilter as WOStatus];
  const { data: workOrders, isLoading } = useWorkOrders({ statusIn: filterStatuses });
  const forceClose = useForceCloseWorkOrder();
  const createWO = useCreateWorkOrder();
  const updateWO = useUpdateWorkOrder();
  const deleteWO = useDeleteWorkOrder();

  const { data: machines } = useMachines();
  const { data: problemDescriptions } = useActiveProblemDescriptions();

  const woIds = useMemo(() => workOrders?.map((w) => w.id) ?? [], [workOrders]);
  const { data: partsCounts } = usePartsCountByWOs(woIds);

  // Create WO state
  const [showCreate, setShowCreate] = useState(false);
  const [newRequester, setNewRequester] = useState("");
  const [newMachine, setNewMachine] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newNotes, setNewNotes] = useState("");

  // Edit WO state
  const [editWO, setEditWO] = useState<WorkOrder | null>(null);
  const [editRequester, setEditRequester] = useState("");
  const [editMachine, setEditMachine] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editNotes, setEditNotes] = useState("");

  const [deleteId, setDeleteId] = useState<string | null>(null);

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
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter((w) =>
        `WO-${String(w.wo_number).padStart(4, "0")}`.toLowerCase().includes(term) ||
        w.requester_name.toLowerCase().includes(term) ||
        w.machine.toLowerCase().includes(term) ||
        w.description.toLowerCase().includes(term) ||
        (w.operator?.name || "").toLowerCase().includes(term) ||
        (w.engineer?.name || "").toLowerCase().includes(term)
      );
    }
    return filtered;
  }, [workOrders, dateQuickFilter, dateFrom, dateTo, problemFilter, machineFilter, searchTerm]);

  const totalPages = Math.ceil((filteredWOs?.length ?? 0) / ITEMS_PER_PAGE);
  const paginatedWOs = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredWOs.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredWOs, currentPage]);

  useMemo(() => { setCurrentPage(1); }, [statusFilter, problemFilter, machineFilter, searchTerm, dateQuickFilter, dateFrom, dateTo]);

  const kanbanColumns = useMemo(() => ({
    open: filteredWOs.filter((w) => w.status === "open"),
    inProgress: filteredWOs.filter((w) => w.status === "in_progress"),
    completed: filteredWOs.filter((w) => w.status === "completed" || w.status === "force_closed"),
  }), [filteredWOs]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createWO.mutateAsync({ requester_name: newRequester.trim(), machine: newMachine.trim(), description: newDesc.trim(), notes: newNotes.trim() });
      toast({ title: "Work Order Created" });
      setShowCreate(false); setNewRequester(""); setNewMachine(""); setNewDesc(""); setNewNotes("");
    } catch (err: any) { toast({ title: "Error", description: err.message, variant: "destructive" }); }
  };

  const openEdit = (wo: WorkOrder) => {
    setEditWO(wo); setEditRequester(wo.requester_name); setEditMachine(wo.machine); setEditDesc(wo.description); setEditNotes((wo as any).notes || "");
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

  const KanbanCard = ({ wo, borderColor }: { wo: WorkOrder; borderColor: string }) => (
    <Card className={`cursor-pointer hover:shadow-md transition-shadow border-l-4 ${borderColor}`} onClick={() => navigate(`/dashboard/wo/${wo.id}`)}>
      <CardContent className="p-3 space-y-1">
        <div className="flex justify-between items-center">
          <span className="font-mono text-xs font-medium">WO-{String(wo.wo_number).padStart(4, "0")}</span>
          <span className="text-xs text-muted-foreground">{format(new Date(wo.created_at), "dd/MM HH:mm")}</span>
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

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-2"><ClipboardList className="h-6 w-6" /> Work Orders</h2>
            <p className="text-muted-foreground">Manage and track all work orders</p>
          </div>
          <Button onClick={() => setShowCreate(true)}><Plus className="h-4 w-4 mr-2" /> Create WO</Button>
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
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap mt-2">
              <div className="relative flex-1 min-w-[200px] max-w-[300px]">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search WO#, requester, machine..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-8" />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[150px]"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="force_closed">Force Closed</SelectItem>
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
            {isLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : !filteredWOs?.length ? (
              <p className="text-muted-foreground text-center py-8">No work orders found.</p>
            ) : viewMode === "board" ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 mb-3"><div className="w-3 h-3 rounded-full bg-blue-500" /><h3 className="font-semibold text-sm">Open ({kanbanColumns.open.length})</h3></div>
                  {kanbanColumns.open.map((wo) => <KanbanCard key={wo.id} wo={wo} borderColor="border-l-blue-500" />)}
                  {!kanbanColumns.open.length && <p className="text-muted-foreground text-xs text-center py-4">No open WOs</p>}
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2 mb-3"><div className="w-3 h-3 rounded-full bg-amber-500" /><h3 className="font-semibold text-sm">In Progress ({kanbanColumns.inProgress.length})</h3></div>
                  {kanbanColumns.inProgress.map((wo) => <KanbanCard key={wo.id} wo={wo} borderColor="border-l-amber-500" />)}
                  {!kanbanColumns.inProgress.length && <p className="text-muted-foreground text-xs text-center py-4">No WOs in progress</p>}
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2 mb-3"><div className="w-3 h-3 rounded-full bg-green-500" /><h3 className="font-semibold text-sm">Completed ({kanbanColumns.completed.length})</h3></div>
                  {kanbanColumns.completed.map((wo) => <KanbanCard key={wo.id} wo={wo} borderColor="border-l-green-500" />)}
                  {!kanbanColumns.completed.length && <p className="text-muted-foreground text-xs text-center py-4">No completed WOs</p>}
                </div>
              </div>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>WO#</TableHead><TableHead>Requester</TableHead><TableHead>Machine</TableHead>
                      <TableHead>Status</TableHead><TableHead>Operator</TableHead><TableHead>Engineer</TableHead>
                      <TableHead>Created</TableHead><TableHead>Parts</TableHead><TableHead>Started</TableHead>
                      <TableHead>Completed</TableHead><TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedWOs.map((wo) => {
                      const cfg = statusConfig[wo.status];
                      const canForceClose = wo.status === "open" || wo.status === "in_progress";
                      return (
                        <TableRow key={wo.id}>
                          <TableCell className="font-mono font-medium cursor-pointer hover:underline" onClick={() => navigate(`/dashboard/wo/${wo.id}`)}>WO-{String(wo.wo_number).padStart(4, "0")}</TableCell>
                          <TableCell>{wo.requester_name}</TableCell>
                          <TableCell>{wo.machine}</TableCell>
                          <TableCell><Badge variant="outline" className={cfg.className}>{cfg.label}</Badge></TableCell>
                          <TableCell className="text-sm">{wo.operator?.name || "—"}</TableCell>
                          <TableCell className="text-sm">{wo.engineer?.name || "—"}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{format(new Date(wo.created_at), "dd/MM HH:mm")}</TableCell>
                          <TableCell>{partsCounts?.[wo.id] ? <Badge variant="secondary">{partsCounts[wo.id]}</Badge> : "—"}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{wo.started_at ? format(new Date(wo.started_at), "dd/MM HH:mm") : "—"}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{wo.completed_at ? format(new Date(wo.completed_at), "dd/MM HH:mm") : "—"}</TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button size="icon" variant="ghost" onClick={() => window.open(`/dashboard/wo/${wo.id}`, "_blank")}><Printer className="h-4 w-4" /></Button>
                              <Button size="icon" variant="ghost" onClick={() => openEdit(wo)}><Pencil className="h-4 w-4" /></Button>
                              <Button size="icon" variant="ghost" className="text-destructive" onClick={() => setDeleteId(wo.id)}><Trash2 className="h-4 w-4" /></Button>
                              {canForceClose && (
                                <Button size="sm" variant="destructive" onClick={() => forceClose.mutate(wo.id)} disabled={forceClose.isPending}>
                                  <XCircle className="h-3 w-3 mr-1" /> Close
                                </Button>
                              )}
                            </div>
                          </TableCell>
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
              </>
            )}
          </CardContent>
        </Card>

        {/* Create WO Dialog */}
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogContent>
            <DialogHeader><DialogTitle>Create Work Order</DialogTitle></DialogHeader>
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
            <DialogHeader><DialogTitle>Edit Work Order</DialogTitle></DialogHeader>
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
      </div>
    </DashboardLayout>
  );
}
