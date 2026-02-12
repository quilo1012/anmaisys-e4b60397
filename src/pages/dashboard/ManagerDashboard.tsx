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
import { LayoutDashboard, ClipboardList, Users, XCircle, Loader2, Download, Timer, Activity, Package, AlertTriangle, Plus, Pencil, Trash2, Settings, X, Search, LayoutGrid, List, ChevronLeft, ChevronRight } from "lucide-react";
import { useWorkOrders, useForceCloseWorkOrder, useCreateWorkOrder, useUpdateWorkOrder, useDeleteWorkOrder, type WOStatus, type WorkOrder } from "@/hooks/useWorkOrders";
import { useTotalPartsUsedToday, useProducts, usePartsCountByWOs } from "@/hooks/useStock";
import { useMachines, useAddMachine, useDeleteMachine } from "@/hooks/useMachines";
import { useProblemDescriptions, useAddProblemDescription, useDeleteProblemDescription } from "@/hooks/useProblemDescriptions";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { format, differenceInMinutes, subDays, startOfDay, endOfDay, startOfMonth } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { exportWorkOrdersCsv } from "@/lib/exportCsv";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useToast } from "@/hooks/use-toast";

const statusConfig: Record<string, { label: string; className: string }> = {
  open: { label: "Open", className: "bg-blue-100 text-blue-800 border-blue-200" },
  in_progress: { label: "In Progress", className: "bg-amber-100 text-amber-800 border-amber-200" },
  completed: { label: "Completed", className: "bg-green-100 text-green-800 border-green-200" },
  force_closed: { label: "Force Closed", className: "bg-gray-100 text-gray-800 border-gray-200" },
};

const ITEMS_PER_PAGE = 20;

export default function ManagerDashboard() {
  const { user } = useAuth();
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [problemFilter, setProblemFilter] = useState<string>("all");
  const [machineFilter, setMachineFilter] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [viewMode, setViewMode] = useState<"table" | "board">("table");
  const [currentPage, setCurrentPage] = useState(1);
  const filterStatuses = statusFilter === "all" ? undefined : [statusFilter as WOStatus];
  const { data: workOrders, isLoading } = useWorkOrders({ statusIn: filterStatuses });
  const { data: allWOs } = useWorkOrders();
  const forceClose = useForceCloseWorkOrder();
  const createWO = useCreateWorkOrder();
  const updateWO = useUpdateWorkOrder();
  const deleteWO = useDeleteWorkOrder();
  const navigate = useNavigate();
  const { data: partsToday } = useTotalPartsUsedToday();
  const { data: products } = useProducts();
  const woIds = useMemo(() => workOrders?.map((w) => w.id) ?? [], [workOrders]);
  const { data: partsCounts } = usePartsCountByWOs(woIds);
  const { toast } = useToast();
  const { data: machines } = useMachines();
  const addMachine = useAddMachine();
  const deleteMachine = useDeleteMachine();
  const [newMachineName, setNewMachineName] = useState("");
  const [showMachines, setShowMachines] = useState(false);
  const [dateQuickFilter, setDateQuickFilter] = useState<string>("today");
  const { data: problemDescriptions } = useProblemDescriptions();
  const addProblem = useAddProblemDescription();
  const deleteProblem = useDeleteProblemDescription();
  const [showProblems, setShowProblems] = useState(false);
  const [newProblemName, setNewProblemName] = useState("");

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

  // Delete WO state
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: userCount } = useQuery({
    queryKey: ["user_count"],
    queryFn: async () => {
      const { count, error } = await supabase.from("profiles").select("*", { count: "exact", head: true });
      if (error) throw error;
      return count ?? 0;
    },
  });

  // Parts used by category query
  const { data: partsByCategory } = useQuery({
    queryKey: ["parts_by_category"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("parts_used")
        .select("quantity, product:products(category)");
      if (error) throw error;
      return data;
    },
  });

  const partsCategoryChart = useMemo(() => {
    if (!partsByCategory) return [];
    const cats: Record<string, number> = {};
    partsByCategory.forEach((pu: any) => {
      const cat = pu.product?.category || "Unknown";
      cats[cat] = (cats[cat] || 0) + pu.quantity;
    });
    return Object.entries(cats)
      .sort((a, b) => b[1] - a[1])
      .map(([category, count]) => ({ category, count }));
  }, [partsByCategory]);

  const today = new Date().toDateString();
  const openCount = allWOs?.filter((w) => w.status === "open").length ?? 0;
  const inProgressCount = allWOs?.filter((w) => w.status === "in_progress").length ?? 0;
  const completedToday = allWOs?.filter((w) => w.status === "completed" && w.completed_at && new Date(w.completed_at).toDateString() === today).length ?? 0;
  const lowStockCount = products?.filter((p) => p.quantity <= p.min_stock).length ?? 0;

  const kpis = useMemo(() => {
    if (!allWOs) return { avgResponse: 0, avgMTTR: 0 };
    const completed = allWOs.filter((w) => w.status === "completed" && w.started_at && w.completed_at);
    let totalResp = 0, totalMTTR = 0, count = 0;
    completed.forEach((wo) => {
      totalResp += differenceInMinutes(new Date(wo.started_at!), new Date(wo.created_at));
      totalMTTR += differenceInMinutes(new Date(wo.completed_at!), new Date(wo.started_at!));
      count++;
    });
    return {
      avgResponse: count ? Math.round(totalResp / count) : 0,
      avgMTTR: count ? Math.round(totalMTTR / count) : 0,
    };
  }, [allWOs]);

  // Date filtering logic
  const filteredWOs = useMemo(() => {
    if (!workOrders) return [];
    let filtered = workOrders;
    const now = new Date();
    if (dateQuickFilter === "today") {
      const start = startOfDay(now);
      const end = endOfDay(now);
      filtered = filtered.filter((w) => { const d = new Date(w.created_at); return d >= start && d <= end; });
    } else if (dateQuickFilter === "yesterday") {
      const start = startOfDay(subDays(now, 1));
      const end = endOfDay(subDays(now, 1));
      filtered = filtered.filter((w) => { const d = new Date(w.created_at); return d >= start && d <= end; });
    } else if (dateQuickFilter === "7days") {
      const start = startOfDay(subDays(now, 6));
      filtered = filtered.filter((w) => new Date(w.created_at) >= start);
    } else if (dateQuickFilter === "month") {
      const start = startOfMonth(now);
      filtered = filtered.filter((w) => new Date(w.created_at) >= start);
    } else {
      if (dateFrom) filtered = filtered.filter((w) => w.created_at >= dateFrom);
      if (dateTo) filtered = filtered.filter((w) => w.created_at <= dateTo + "T23:59:59");
    }
    if (problemFilter !== "all") {
      filtered = filtered.filter((w) => w.description === problemFilter);
    }
    if (machineFilter !== "all") {
      filtered = filtered.filter((w) => w.machine === machineFilter);
    }
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

  // Pagination
  const totalPages = Math.ceil((filteredWOs?.length ?? 0) / ITEMS_PER_PAGE);
  const paginatedWOs = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredWOs.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredWOs, currentPage]);

  // Reset page when filters change
  useMemo(() => { setCurrentPage(1); }, [statusFilter, problemFilter, machineFilter, searchTerm, dateQuickFilter, dateFrom, dateTo]);

  const wosPerDay = useMemo(() => {
    if (!allWOs) return [];
    const days: { date: string; count: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = subDays(new Date(), i);
      const dateStr = format(d, "dd/MM");
      const count = allWOs.filter((w) => new Date(w.created_at).toDateString() === d.toDateString()).length;
      days.push({ date: dateStr, count });
    }
    return days;
  }, [allWOs]);

  const topMachines = useMemo(() => {
    if (!allWOs) return [];
    const machineCount: Record<string, number> = {};
    allWOs.forEach((w) => { machineCount[w.machine] = (machineCount[w.machine] || 0) + 1; });
    return Object.entries(machineCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([machine, count]) => ({ machine, count }));
  }, [allWOs]);

  const topProblems = useMemo(() => {
    if (!allWOs) return [];
    const counts: Record<string, number> = {};
    allWOs.forEach((w) => { counts[w.description] = (counts[w.description] || 0) + 1; });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([problem, count]) => ({ problem, count }));
  }, [allWOs]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createWO.mutateAsync({ requester_name: newRequester.trim(), machine: newMachine.trim(), description: newDesc.trim(), notes: newNotes.trim() });
      toast({ title: "Work Order Created", description: "Engineers on shift will receive a sound notification." });
      setShowCreate(false);
      setNewRequester(""); setNewMachine(""); setNewDesc(""); setNewNotes("");
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const openEdit = (wo: WorkOrder) => {
    setEditWO(wo);
    setEditRequester(wo.requester_name);
    setEditMachine(wo.machine);
    setEditDesc(wo.description);
    setEditNotes((wo as any).notes || "");
  };

  const handleEdit = async () => {
    if (!editWO) return;
    try {
      await updateWO.mutateAsync({ id: editWO.id, requester_name: editRequester.trim(), machine: editMachine.trim(), description: editDesc.trim(), notes: editNotes.trim() });
      toast({ title: "Work Order Updated" });
      setEditWO(null);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteWO.mutateAsync(deleteId);
      toast({ title: "Work Order Deleted" });
      setDeleteId(null);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  // Kanban groups
  const kanbanColumns = useMemo(() => {
    const open = filteredWOs.filter((w) => w.status === "open");
    const inProgress = filteredWOs.filter((w) => w.status === "in_progress");
    const completed = filteredWOs.filter((w) => w.status === "completed" || w.status === "force_closed");
    return { open, inProgress, completed };
  }, [filteredWOs]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-2xl font-bold">Manager Dashboard</h2>
            <p className="text-muted-foreground">Full system overview and control</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setShowProblems(true)}>
              <ClipboardList className="h-4 w-4 mr-2" /> Problems
            </Button>
            <Button variant="outline" onClick={() => setShowMachines(true)}>
              <Settings className="h-4 w-4 mr-2" /> Machines
            </Button>
            <Button onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4 mr-2" /> Create WO
            </Button>
          </div>
        </div>

        {/* KPI cards */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Open WOs</CardTitle>
              <ClipboardList className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent><div className="text-2xl font-bold">{openCount}</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">In Progress</CardTitle>
              <LayoutDashboard className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent><div className="text-2xl font-bold">{inProgressCount}</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Completed Today</CardTitle>
              <ClipboardList className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent><div className="text-2xl font-bold">{completedToday}</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Users</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent><div className="text-2xl font-bold">{userCount ?? "—"}</div></CardContent>
          </Card>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Avg Response</CardTitle>
              <Timer className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent><div className="text-2xl font-bold">{kpis.avgResponse} min</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Avg MTTR</CardTitle>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent><div className="text-2xl font-bold">{kpis.avgMTTR} min</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Parts Today</CardTitle>
              <Package className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent><div className="text-2xl font-bold">{partsToday ?? 0}</div></CardContent>
          </Card>
          <Card className={lowStockCount > 0 ? "border-destructive" : ""}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Low Stock</CardTitle>
              <AlertTriangle className={`h-4 w-4 ${lowStockCount > 0 ? "text-destructive" : "text-muted-foreground"}`} />
            </CardHeader>
            <CardContent><div className={`text-2xl font-bold ${lowStockCount > 0 ? "text-destructive" : ""}`}>{lowStockCount}</div></CardContent>
          </Card>
        </div>

        {/* Charts */}
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="text-base">WOs per Day (Last 7 Days)</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={wosPerDay}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Top 5 Machines by WO Count</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={topMachines} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" allowDecimals={false} />
                  <YAxis type="category" dataKey="machine" width={120} />
                  <Tooltip />
                  <Bar dataKey="count" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Top 5 Problems by WO Count</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={topProblems} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" allowDecimals={false} />
                  <YAxis type="category" dataKey="problem" width={120} />
                  <Tooltip />
                  <Bar dataKey="count" fill="hsl(var(--accent))" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Parts Used by Category</CardTitle></CardHeader>
            <CardContent>
              {!partsCategoryChart.length ? (
                <p className="text-muted-foreground text-sm text-center py-8">No parts usage data available.</p>
              ) : (
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={partsCategoryChart} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" allowDecimals={false} />
                    <YAxis type="category" dataKey="category" width={120} />
                    <Tooltip />
                    <Bar dataKey="count" fill="hsl(var(--chart-4, var(--primary)))" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Work Orders section */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className="flex items-center gap-2">
                <ClipboardList className="h-5 w-5" /> All Work Orders
              </CardTitle>
              <div className="flex items-center gap-2 flex-wrap">
                {/* View toggle */}
                <div className="flex border rounded-md">
                  <Button variant={viewMode === "table" ? "default" : "ghost"} size="sm" onClick={() => setViewMode("table")} className="rounded-r-none">
                    <List className="h-4 w-4" />
                  </Button>
                  <Button variant={viewMode === "board" ? "default" : "ghost"} size="sm" onClick={() => setViewMode("board")} className="rounded-l-none">
                    <LayoutGrid className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex gap-1">
                  {([["today", "Today"], ["yesterday", "Yesterday"], ["7days", "7 Days"], ["month", "This Month"], ["all", "All"]] as const).map(([key, label]) => (
                    <Button key={key} variant={dateQuickFilter === key ? "default" : "outline"} size="sm" onClick={() => { setDateQuickFilter(key); setDateFrom(""); setDateTo(""); }}>
                      {label}
                    </Button>
                  ))}
                </div>
                <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setDateQuickFilter(""); }} className="w-[150px]" placeholder="From" />
                <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setDateQuickFilter(""); }} className="w-[150px]" placeholder="To" />
                <Button variant="outline" size="sm" onClick={() => {
                  if (!filteredWOs) return;
                  exportWorkOrdersCsv(filteredWOs, undefined, partsCounts);
                }}>
                  <Download className="h-4 w-4 mr-1" /> Export CSV
                </Button>
              </div>
            </div>
            {/* Filters row */}
            <div className="flex items-center gap-2 flex-wrap mt-2">
              <div className="relative flex-1 min-w-[200px] max-w-[300px]">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search WO#, requester, machine..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-8" />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="Filter status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="force_closed">Force Closed</SelectItem>
                </SelectContent>
              </Select>
              <Select value={problemFilter} onValueChange={setProblemFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Filter problem" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Problems</SelectItem>
                  {problemDescriptions?.map((pd) => (
                    <SelectItem key={pd.id} value={pd.name}>{pd.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={machineFilter} onValueChange={setMachineFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Filter machine" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Machines</SelectItem>
                  {machines?.map((m) => (
                    <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>
                  ))}
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
              /* Kanban Board View */
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Open column */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-3 h-3 rounded-full bg-blue-500" />
                    <h3 className="font-semibold text-sm">Open ({kanbanColumns.open.length})</h3>
                  </div>
                  {kanbanColumns.open.map((wo) => (
                    <Card key={wo.id} className="cursor-pointer hover:shadow-md transition-shadow border-l-4 border-l-blue-500" onClick={() => navigate(`/dashboard/wo/${wo.id}`)}>
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
                  ))}
                  {!kanbanColumns.open.length && <p className="text-muted-foreground text-xs text-center py-4">No open WOs</p>}
                </div>
                {/* In Progress column */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-3 h-3 rounded-full bg-amber-500" />
                    <h3 className="font-semibold text-sm">In Progress ({kanbanColumns.inProgress.length})</h3>
                  </div>
                  {kanbanColumns.inProgress.map((wo) => (
                    <Card key={wo.id} className="cursor-pointer hover:shadow-md transition-shadow border-l-4 border-l-amber-500" onClick={() => navigate(`/dashboard/wo/${wo.id}`)}>
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
                  ))}
                  {!kanbanColumns.inProgress.length && <p className="text-muted-foreground text-xs text-center py-4">No WOs in progress</p>}
                </div>
                {/* Completed column */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-3 h-3 rounded-full bg-green-500" />
                    <h3 className="font-semibold text-sm">Completed ({kanbanColumns.completed.length})</h3>
                  </div>
                  {kanbanColumns.completed.map((wo) => (
                    <Card key={wo.id} className="cursor-pointer hover:shadow-md transition-shadow border-l-4 border-l-green-500" onClick={() => navigate(`/dashboard/wo/${wo.id}`)}>
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
                  ))}
                  {!kanbanColumns.completed.length && <p className="text-muted-foreground text-xs text-center py-4">No completed WOs</p>}
                </div>
              </div>
            ) : (
              /* Table View */
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                       <TableHead>WO#</TableHead>
                       <TableHead>Requester</TableHead>
                       <TableHead>Machine</TableHead>
                       <TableHead>Status</TableHead>
                       <TableHead>Operator</TableHead>
                       <TableHead>Engineer</TableHead>
                       <TableHead>Created</TableHead>
                       <TableHead>Parts</TableHead>
                       <TableHead>Started</TableHead>
                       <TableHead>Completed</TableHead>
                       <TableHead>Actions</TableHead>
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
                            <TableCell className="text-sm font-medium">{partsCounts?.[wo.id] ? <Badge variant="secondary">{partsCounts[wo.id]}</Badge> : "—"}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">{wo.started_at ? format(new Date(wo.started_at), "dd/MM HH:mm") : "—"}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">{wo.completed_at ? format(new Date(wo.completed_at), "dd/MM HH:mm") : "—"}</TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button size="icon" variant="ghost" onClick={() => openEdit(wo)}><Pencil className="h-4 w-4" /></Button>
                              <Button size="icon" variant="ghost" className="text-destructive" onClick={() => setDeleteId(wo.id)}><Trash2 className="h-4 w-4" /></Button>
                              {canForceClose && (
                                <Button size="sm" variant="destructive" onClick={() => forceClose.mutate(wo.id)} disabled={forceClose.isPending}>
                                  <XCircle className="h-3 w-3 mr-1" /> Force Close
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between mt-4">
                    <p className="text-sm text-muted-foreground">
                      Showing {((currentPage - 1) * ITEMS_PER_PAGE) + 1}–{Math.min(currentPage * ITEMS_PER_PAGE, filteredWOs.length)} of {filteredWOs.length}
                    </p>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setCurrentPage((p) => p - 1)}>
                        <ChevronLeft className="h-4 w-4 mr-1" /> Previous
                      </Button>
                      <Button variant="outline" size="sm" disabled={currentPage === totalPages} onClick={() => setCurrentPage((p) => p + 1)}>
                        Next <ChevronRight className="h-4 w-4 ml-1" />
                      </Button>
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
                <Textarea value={newNotes} onChange={(e) => setNewNotes(e.target.value)} placeholder="Additional notes or context..." rows={3} />
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
                <Textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} placeholder="Additional notes or context..." rows={3} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditWO(null)}>Cancel</Button>
              <Button onClick={handleEdit} disabled={updateWO.isPending}>
                {updateWO.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete WO Confirmation */}
        <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete work order?</AlertDialogTitle>
              <AlertDialogDescription>This action cannot be undone. The work order will be permanently removed.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Manage Machines Dialog */}
        <Dialog open={showMachines} onOpenChange={setShowMachines}>
          <DialogContent>
            <DialogHeader><DialogTitle>Manage Machines</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="flex gap-2">
                <Input value={newMachineName} onChange={(e) => setNewMachineName(e.target.value)} placeholder="New machine name..." />
                <Button onClick={async () => {
                  if (!newMachineName.trim()) return;
                  try {
                    await addMachine.mutateAsync(newMachineName.trim());
                    setNewMachineName("");
                    toast({ title: "Machine added" });
                  } catch (err: any) { toast({ title: "Error", description: err.message, variant: "destructive" }); }
                }} disabled={addMachine.isPending}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              <div className="space-y-1 max-h-60 overflow-y-auto">
                {machines?.map((m) => (
                  <div key={m.id} className="flex items-center justify-between rounded-md px-3 py-2 hover:bg-muted">
                    <span className="text-sm">{m.name}</span>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => deleteMachine.mutate(m.id)}>
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
                {!machines?.length && <p className="text-muted-foreground text-sm text-center py-4">No machines yet.</p>}
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Manage Problem Descriptions Dialog */}
        <Dialog open={showProblems} onOpenChange={setShowProblems}>
          <DialogContent>
            <DialogHeader><DialogTitle>Manage Problem Descriptions</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="flex gap-2">
                <Input value={newProblemName} onChange={(e) => setNewProblemName(e.target.value)} placeholder="New problem description..." />
                <Button onClick={async () => {
                  if (!newProblemName.trim()) return;
                  try {
                    await addProblem.mutateAsync(newProblemName.trim());
                    setNewProblemName("");
                    toast({ title: "Problem description added" });
                  } catch (err: any) { toast({ title: "Error", description: err.message, variant: "destructive" }); }
                }} disabled={addProblem.isPending}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              <div className="space-y-1 max-h-60 overflow-y-auto">
                {problemDescriptions?.map((pd) => (
                  <div key={pd.id} className="flex items-center justify-between rounded-md px-3 py-2 hover:bg-muted">
                    <span className="text-sm">{pd.name}</span>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => deleteProblem.mutate(pd.id)}>
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
                {!problemDescriptions?.length && <p className="text-muted-foreground text-sm text-center py-4">No problem descriptions yet.</p>}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
