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
import { LayoutDashboard, ClipboardList, Users, XCircle, Loader2, Download, Timer, Activity, Package, AlertTriangle, Plus, Pencil, Trash2 } from "lucide-react";
import { useWorkOrders, useForceCloseWorkOrder, useCreateWorkOrder, useUpdateWorkOrder, useDeleteWorkOrder, type WOStatus, type WorkOrder } from "@/hooks/useWorkOrders";
import { useTotalPartsUsedToday, useProducts, usePartsCountByWOs } from "@/hooks/useStock";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { format, differenceInMinutes, subDays } from "date-fns";
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

export default function ManagerDashboard() {
  const { user } = useAuth();
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
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

  // Create WO state
  const [showCreate, setShowCreate] = useState(false);
  const [newLine, setNewLine] = useState("");
  const [newMachine, setNewMachine] = useState("");
  const [newDesc, setNewDesc] = useState("");

  // Edit WO state
  const [editWO, setEditWO] = useState<WorkOrder | null>(null);
  const [editLine, setEditLine] = useState("");
  const [editMachine, setEditMachine] = useState("");
  const [editDesc, setEditDesc] = useState("");

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

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createWO.mutateAsync({ line: newLine.trim(), machine: newMachine.trim(), description: newDesc.trim() });
      toast({ title: "Work Order Created", description: "Engineers on shift will receive a sound notification." });
      setShowCreate(false);
      setNewLine(""); setNewMachine(""); setNewDesc("");
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const openEdit = (wo: WorkOrder) => {
    setEditWO(wo);
    setEditLine(wo.line);
    setEditMachine(wo.machine);
    setEditDesc(wo.description);
  };

  const handleEdit = async () => {
    if (!editWO) return;
    try {
      await updateWO.mutateAsync({ id: editWO.id, line: editLine.trim(), machine: editMachine.trim(), description: editDesc.trim() });
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

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">Manager Dashboard</h2>
            <p className="text-muted-foreground">Full system overview and control</p>
          </div>
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-2" /> Create WO
          </Button>
        </div>

        {/* KPI cards - same as before */}
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
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <ClipboardList className="h-5 w-5" /> All Work Orders
              </CardTitle>
              <div className="flex items-center gap-2 flex-wrap">
                <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-[150px]" placeholder="From" />
                <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-[150px]" placeholder="To" />
                <Button variant="outline" size="sm" onClick={() => {
                  if (!workOrders) return;
                  let filtered = workOrders;
                  if (dateFrom) filtered = filtered.filter((w) => w.created_at >= dateFrom);
                  if (dateTo) filtered = filtered.filter((w) => w.created_at <= dateTo + "T23:59:59");
                  exportWorkOrdersCsv(filtered, undefined, partsCounts);
                }}>
                  <Download className="h-4 w-4 mr-1" /> Export CSV
                </Button>
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
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : !workOrders?.length ? (
              <p className="text-muted-foreground text-center py-8">No work orders found.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                     <TableHead>WO#</TableHead>
                     <TableHead>Line</TableHead>
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
                   {workOrders.map((wo) => {
                     const cfg = statusConfig[wo.status];
                     const canForceClose = wo.status === "open" || wo.status === "in_progress";
                     return (
                       <TableRow key={wo.id}>
                         <TableCell className="font-mono font-medium cursor-pointer hover:underline" onClick={() => navigate(`/dashboard/wo/${wo.id}`)}>WO-{String(wo.wo_number).padStart(4, "0")}</TableCell>
                         <TableCell>{wo.line}</TableCell>
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
            )}
          </CardContent>
        </Card>

        {/* Create WO Dialog */}
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogContent>
            <DialogHeader><DialogTitle>Create Work Order</DialogTitle></DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-2"><Label>Production Line</Label><Input value={newLine} onChange={(e) => setNewLine(e.target.value)} required /></div>
              <div className="space-y-2"><Label>Machine</Label><Input value={newMachine} onChange={(e) => setNewMachine(e.target.value)} required /></div>
              <div className="space-y-2"><Label>Problem Description</Label><Textarea value={newDesc} onChange={(e) => setNewDesc(e.target.value)} rows={3} required /></div>
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
              <div className="space-y-2"><Label>Production Line</Label><Input value={editLine} onChange={(e) => setEditLine(e.target.value)} /></div>
              <div className="space-y-2"><Label>Machine</Label><Input value={editMachine} onChange={(e) => setEditMachine(e.target.value)} /></div>
              <div className="space-y-2"><Label>Problem Description</Label><Textarea value={editDesc} onChange={(e) => setEditDesc(e.target.value)} rows={3} /></div>
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
      </div>
    </DashboardLayout>
  );
}
