import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useWorkOrders, useCreateWorkOrder } from "@/hooks/useWorkOrders";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { Package, Plus, Loader2, Search, ClipboardList, PlayCircle, CheckCircle2 } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { ComboboxInput } from "@/components/ComboboxInput";
import { DashboardLayout } from "@/components/DashboardLayout";

const WAREHOUSE_LOCATIONS = ["AC1", "AC2 - Warehouse", "K53", "Depot RD"];

const STATUS_STYLES: Record<string, string> = {
  open: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
  in_progress: "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30",
  finished: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  closed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
};

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  in_progress: "In Progress",
  finished: "Finished",
  closed: "Closed",
};

export default function WarehouseDashboard() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { data: workOrders, isLoading } = useWorkOrders();
  const createWO = useCreateWorkOrder();

  const [open, setOpen] = useState(false);
  const [requester, setRequester] = useState(profile?.name ?? "");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [locationFilter, setLocationFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const warehouseWOs = useMemo(
    () => (workOrders ?? []).filter((w: any) => w.wo_type === "warehouse_service"),
    [workOrders],
  );

  const kpis = useMemo(() => {
    const total = warehouseWOs.length;
    const openCount = warehouseWOs.filter((w: any) => w.status === "open").length;
    const inProgress = warehouseWOs.filter((w: any) => w.status === "in_progress").length;
    const done = warehouseWOs.filter((w: any) => w.status === "finished" || w.status === "closed").length;
    return { total, openCount, inProgress, done };
  }, [warehouseWOs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return warehouseWOs.filter((w: any) => {
      if (statusFilter !== "all") {
        if (statusFilter === "done") {
          if (w.status !== "finished" && w.status !== "closed") return false;
        } else if (w.status !== statusFilter) return false;
      }
      if (locationFilter !== "all" && w.warehouse_location !== locationFilter) return false;
      if (q) {
        const hay = `${w.wo_number ?? ""} ${w.warehouse_location ?? ""} ${w.description ?? ""} ${w.requester_name ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [warehouseWOs, statusFilter, locationFilter, search]);

  const reset = () => {
    setRequester(profile?.name ?? "");
    setLocation("");
    setDescription("");
    setNotes("");
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requester.trim()) {
      toast({ title: "Requester required", description: "Please enter who is requesting the work order.", variant: "destructive" });
      return;
    }
    if (!location.trim()) {
      toast({ title: "Warehouse location required", description: "Please provide the warehouse location.", variant: "destructive" });
      return;
    }
    if (!description.trim()) {
      toast({ title: "Problem description required", description: "Please describe what needs attention.", variant: "destructive" });
      return;
    }
    try {
      await createWO.mutateAsync({
        requester_name: requester.trim(),
        wo_type: "warehouse_service",
        warehouse_location: location.trim(),
        description: description.trim(),
        notes: notes.trim(),
      } as any);
      toast({ title: "Warehouse Service Request Created" });
      setOpen(false);
      reset();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const kpiCards = [
    { label: "Total Requests", value: kpis.total, icon: ClipboardList, tone: "text-foreground" },
    { label: "Open", value: kpis.openCount, icon: Package, tone: "text-amber-600 dark:text-amber-400" },
    { label: "In Progress", value: kpis.inProgress, icon: PlayCircle, tone: "text-blue-600 dark:text-blue-400" },
    { label: "Completed", value: kpis.done, icon: CheckCircle2, tone: "text-emerald-600 dark:text-emerald-400" },
  ];

  return (
    <DashboardLayout>
      <div className="space-y-6 p-4 md:p-6">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Warehouse Admin</h1>
            <p className="text-sm text-muted-foreground">
              Create service requests and track their status. Warehouse orders never count as line downtime.
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
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="requester">Requested by *</Label>
                  <Input id="requester" value={requester} onChange={(e) => setRequester(e.target.value)} placeholder="Your name" autoComplete="off" />
                </div>
                <div className="space-y-2">
                  <Label>Warehouse location *</Label>
                  <ComboboxInput
                    value={location}
                    onChange={(v) => setLocation(v)}
                    suggestions={WAREHOUSE_LOCATIONS}
                    placeholder="Select or type a warehouse location"
                    className="w-full"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="desc">Description *</Label>
                  <Textarea id="desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What needs attention?" rows={3} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="notes">Notes</Label>
                  <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
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

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
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

        <Card>
          <CardHeader className="space-y-4">
            <CardTitle>Warehouse Service Requests</CardTitle>
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search WO#, location, description or requester…"
                  className="pl-9"
                  autoComplete="off"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full md:w-[180px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="done">Completed</SelectItem>
                </SelectContent>
              </Select>
              <Select value={locationFilter} onValueChange={setLocationFilter}>
                <SelectTrigger className="w-full md:w-[200px]">
                  <SelectValue placeholder="Location" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All locations</SelectItem>
                  {WAREHOUSE_LOCATIONS.map((l) => (
                    <SelectItem key={l} value={l}>{l}</SelectItem>
                  ))}
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
                    : "Try clearing the search or changing status/location filters."
                }
              />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>WO #</TableHead>
                      <TableHead>Location</TableHead>
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
                        <TableCell className="max-w-[280px] truncate">{wo.description}</TableCell>
                        <TableCell>{wo.requester_name}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={STATUS_STYLES[wo.status] ?? ""}>
                            {STATUS_LABEL[wo.status] ?? wo.status}
                          </Badge>
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
      </div>
    </DashboardLayout>
  );
}
