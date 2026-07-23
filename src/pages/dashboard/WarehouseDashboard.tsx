import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useWorkOrders, useCreateWorkOrder } from "@/hooks/useWorkOrders";
import { useMachines, useDistinctMachineValues } from "@/hooks/useMachines";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { Package, Plus, Loader2, Search, ClipboardList, PlayCircle, CheckCircle2, CalendarDays, History } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { ComboboxInput } from "@/components/ComboboxInput";
import { DashboardLayout } from "@/components/DashboardLayout";
import { WAREHOUSE_LOCATIONS } from "@/lib/warehouseLocations";
import { cn } from "@/lib/utils";

const WAREHOUSE_LOCATIONS_LC = new Set(WAREHOUSE_LOCATIONS.map((l) => l.toLowerCase()));

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function startOfWeek() {
  const d = startOfToday();
  d.setDate(d.getDate() - d.getDay()); // Sunday-based week
  return d;
}
function isCompleted(status: string) {
  return status === "finished" || status === "closed";
}

export default function WarehouseDashboard() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { data: workOrders, isLoading } = useWorkOrders();
  const { data: machines } = useMachines();
  const { data: distinctVals } = useDistinctMachineValues();
  const createWO = useCreateWorkOrder();

  const [open, setOpen] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [requester, setRequester] = useState(profile?.name ?? "");
  const [location, setLocation] = useState("");
  const [priority, setPriority] = useState("medium");
  const [description, setDescription] = useState("");

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const warehouseWOs = useMemo(
    () => (workOrders ?? []).filter((w: any) => w.wo_type === "warehouse_service"),
    [workOrders],
  );

  const kpis = useMemo(() => {
    const total = warehouseWOs.length;
    const openCount = warehouseWOs.filter((w: any) => w.status === "open").length;
    const inProgress = warehouseWOs.filter((w: any) => w.status === "in_progress").length;
    const today = startOfToday().getTime();
    const week = startOfWeek().getTime();
    const doneToday = warehouseWOs.filter((w: any) => {
      if (!isCompleted(w.status)) return false;
      const ts = new Date(w.completed_at || w.closed_at || w.finished_at || w.created_at).getTime();
      return ts >= today;
    }).length;
    const doneWeek = warehouseWOs.filter((w: any) => {
      if (!isCompleted(w.status)) return false;
      const ts = new Date(w.completed_at || w.closed_at || w.finished_at || w.created_at).getTime();
      return ts >= week;
    }).length;
    return { total, openCount, inProgress, doneToday, doneWeek };
  }, [warehouseWOs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return warehouseWOs.filter((w: any) => {
      if (statusFilter !== "all") {
        if (statusFilter === "done") {
          if (!isCompleted(w.status)) return false;
        } else if (w.status !== statusFilter) return false;
      }
      if (q) {
        const hay = `${w.wo_number ?? ""} ${w.warehouse_location ?? ""} ${w.description ?? ""} ${w.requester_name ?? ""} ${w.machine ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [warehouseWOs, statusFilter, search]);

  const warehouseMachines = useMemo(() => {
    return (machines ?? []).filter((m: any) => {
      const loc = (m.current_location || "").trim().toLowerCase();
      return WAREHOUSE_LOCATIONS_LC.has(loc);
    });
  }, [machines]);

  // Combined location list for the modal combobox: defaults + distinct machine locations
  const locationSuggestions = useMemo(() => {
    const set = new Set<string>(WAREHOUSE_LOCATIONS);
    (distinctVals?.locations ?? []).forEach((l) => l && set.add(l));
    return Array.from(set).sort();
  }, [distinctVals]);


  const reset = () => {
    setRequester(profile?.name ?? "");
    setLocation("");
    setPriority("medium");
    setDescription("");
    setSubmitAttempted(false);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitAttempted(true);
    if (!requester.trim() || !location.trim() || !description.trim()) {
      toast({
        title: "Missing required fields",
        description: "Please fill Requested by, Warehouse location and Description.",
        variant: "destructive",
      });
      return;
    }
    try {
      await createWO.mutateAsync({
        requester_name: requester.trim(),
        wo_type: "warehouse_service",
        warehouse_location: location.trim(),
        priority,
        description: description.trim(),
      } as any);
      toast({ title: "Warehouse Service Request Created" });
      setOpen(false);
      reset();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const kpiCards = [
    { label: "Open Requests", value: kpis.openCount, icon: Package, tone: "text-amber-600 dark:text-amber-400" },
    { label: "In Progress", value: kpis.inProgress, icon: PlayCircle, tone: "text-blue-600 dark:text-blue-400" },
    { label: "Completed Today", value: kpis.doneToday, icon: CheckCircle2, tone: "text-emerald-600 dark:text-emerald-400" },
    { label: "Completed This Week", value: kpis.doneWeek, icon: CalendarDays, tone: "text-emerald-600 dark:text-emerald-400" },
    { label: "Total Requests", value: kpis.total, icon: ClipboardList, tone: "text-foreground" },
  ];

  const errRequester = submitAttempted && !requester.trim();
  const errLocation = submitAttempted && !location.trim();
  const errDescription = submitAttempted && !description.trim();

  return (
    <DashboardLayout>
      <div className="space-y-6 p-4 md:p-6">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Warehouse Admin</h1>
            <p className="text-sm text-muted-foreground">
              Track service requests and warehouse assets. Warehouse orders never count as production-line downtime.
            </p>
          </div>
          <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="h-4 w-4" /> New Request
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New Warehouse Service Request</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleCreate} className="space-y-4" noValidate>
                <div className="space-y-2">
                  <Label htmlFor="requester">Requested by *</Label>
                  <Input
                    id="requester"
                    value={requester}
                    onChange={(e) => setRequester(e.target.value)}
                    placeholder="Your name"
                    autoComplete="off"
                    aria-invalid={errRequester}
                    className={errRequester ? "border-destructive" : ""}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Warehouse *</Label>
                  <ComboboxInput
                    value={location}
                    onChange={setLocation}
                    suggestions={locationSuggestions}
                    placeholder="Select or type a warehouse"
                    className={`w-full ${errLocation ? "border-destructive" : ""}`}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Priority</Label>
                  <div className="grid grid-cols-3 gap-2">
                    {(["low", "medium", "high"] as const).map((p) => (
                      <Button
                        key={p}
                        type="button"
                        variant={priority === p ? "default" : "outline"}
                        className={cn(
                          "h-10 capitalize",
                          priority === p && p === "high" && "bg-red-600 hover:bg-red-600/90",
                          priority === p && p === "medium" && "bg-amber-500 hover:bg-amber-500/90",
                        )}
                        onClick={() => setPriority(p)}
                      >
                        {p}
                      </Button>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="desc">Description *</Label>
                  <Textarea
                    id="desc"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="What needs attention?"
                    rows={3}
                    aria-invalid={errDescription}
                    className={errDescription ? "border-destructive" : ""}
                  />
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button type="submit" disabled={createWO.isPending}>
                    {createWO.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Create
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {kpiCards.map((k) => (
            <Card key={k.label}>
              <CardContent className="flex items-center justify-between p-4">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">{k.label}</p>
                  <p className={`mt-1 text-2xl font-semibold ${k.tone}`}>{k.value}</p>
                </div>
                <k.icon className={`h-8 w-8 opacity-60 ${k.tone}`} />
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Service Requests table */}
        <Card>
          <CardHeader className="space-y-4">
            <CardTitle>Warehouse Service Requests</CardTitle>
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search WO#, location, asset, description or requester…"
                  className="pl-9"
                  autoComplete="off"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full md:w-[200px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="done">Completed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-10 text-muted-foreground">
                <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading…
              </div>
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={Package}
                title={warehouseWOs.length === 0 ? "No requests yet" : "No requests match your filters"}
                description={
                  warehouseWOs.length === 0
                    ? "Create your first warehouse service request using the button above."
                    : "Try clearing the search or changing the status filter."
                }
              />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>WO #</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Asset</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Requested by</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((wo: any) => (
                      <TableRow
                        key={wo.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => navigate(`/dashboard/wo/${wo.id}`)}
                      >
                        <TableCell className="font-mono text-xs">
                          WO-{new Date(wo.created_at).getFullYear()}-{String(wo.wo_number).padStart(6, "0")}
                        </TableCell>
                        <TableCell>{wo.warehouse_location || "—"}</TableCell>
                        <TableCell>{wo.machine || "—"}</TableCell>
                        <TableCell className="max-w-[280px] truncate">{wo.description}</TableCell>
                        <TableCell>{wo.requester_name}</TableCell>
                        <TableCell>
                          <StatusBadge status={wo.status} showIcon />
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(wo.created_at).toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Warehouse machines / assets */}
        <Card>
          <CardHeader>
            <CardTitle>Warehouse Machines / Assets</CardTitle>
            <p className="text-sm text-muted-foreground">
              Assets currently registered at {WAREHOUSE_LOCATIONS.join(", ")}.
            </p>
          </CardHeader>
          <CardContent>
            {warehouseMachines.length === 0 ? (
              <EmptyState
                icon={Package}
                title="No warehouse assets"
                description="No machines are currently registered at a warehouse location."
              />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {warehouseMachines.map((m: any) => (
                      <TableRow key={m.id}>
                        <TableCell className="font-medium">{m.name}</TableCell>
                        <TableCell>{m.current_location || "—"}</TableCell>
                        <TableCell>
                          <StatusBadge status={m.status || "active"} showIcon />
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1"
                            onClick={() => navigate(`/dashboard/machines/${encodeURIComponent(m.name)}/history`)}
                          >
                            <History className="h-3.5 w-3.5" /> History
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
