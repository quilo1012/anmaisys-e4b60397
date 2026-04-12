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
import { Clock, Loader2, Plus, Pencil, Trash2, CheckCircle, AlertTriangle, Activity, TrendingUp } from "lucide-react";
import { useDowntime, useCreateDowntime, useUpdateDowntime, useDeleteDowntime, type DowntimeRecord } from "@/hooks/useDowntime";
import { useWorkOrders } from "@/hooks/useWorkOrders";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { format, differenceInMinutes, startOfDay, startOfWeek, startOfMonth } from "date-fns";

const CATEGORIES = ["Mechanical", "Electrical", "Human Error", "Material", "Planned", "Other"] as const;
const LINES = ["Line 1", "Line 2", "Line 3", "Line 4", "Line 5"] as const;

export default function DowntimePage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: records, isLoading } = useDowntime();
  const { data: workOrders } = useWorkOrders({ statusIn: ["open", "in_progress", "received", "arrived"] as any });
  const createDowntime = useCreateDowntime();
  const updateDowntime = useUpdateDowntime();
  const deleteDowntime = useDeleteDowntime();

  const [showCreate, setShowCreate] = useState(false);
  const [editRecord, setEditRecord] = useState<DowntimeRecord | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Filters
  const [filterLine, setFilterLine] = useState("all");
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");

  // Form state
  const [formLine, setFormLine] = useState("");
  const [formMachine, setFormMachine] = useState("");
  const [formCategory, setFormCategory] = useState("");
  const [formReason, setFormReason] = useState("");
  const [formStartedAt, setFormStartedAt] = useState("");
  const [formEndedAt, setFormEndedAt] = useState("");
  const [formWOId, setFormWOId] = useState("none");
  const [formNotes, setFormNotes] = useState("");

  const resetForm = () => {
    setFormLine(""); setFormMachine(""); setFormCategory(""); setFormReason("");
    setFormStartedAt(""); setFormEndedAt(""); setFormWOId("none"); setFormNotes("");
  };

  const openCreate = () => {
    resetForm();
    setShowCreate(true);
  };

  const openEdit = (r: DowntimeRecord) => {
    setEditRecord(r);
    setFormLine(r.line); setFormMachine(r.machine || ""); setFormCategory(r.category);
    setFormReason(r.reason); setFormStartedAt(r.started_at.slice(0, 16));
    setFormEndedAt(r.ended_at?.slice(0, 16) || ""); setFormWOId(r.work_order_id || "none");
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

  // KPIs
  const kpis = useMemo(() => {
    if (!records) return { totalToday: 0, active: 0, avgDuration: 0, mostAffected: "—" };
    const now = new Date();
    const todayStart = startOfDay(now);
    const weekStart = startOfWeek(now, { weekStartsOn: 1 });
    const monthStart = startOfMonth(now);

    const todayRecords = records.filter(r => new Date(r.started_at) >= todayStart);
    const totalToday = todayRecords.reduce((sum, r) => {
      const end = r.ended_at ? new Date(r.ended_at) : now;
      return sum + differenceInMinutes(end, new Date(r.started_at));
    }, 0);

    const active = records.filter(r => !r.ended_at).length;

    const weekRecords = records.filter(r => new Date(r.started_at) >= weekStart && r.ended_at);
    const avgDuration = weekRecords.length
      ? Math.round(weekRecords.reduce((s, r) => s + differenceInMinutes(new Date(r.ended_at!), new Date(r.started_at)), 0) / weekRecords.length)
      : 0;

    const monthRecords = records.filter(r => new Date(r.started_at) >= monthStart);
    const lineCount: Record<string, number> = {};
    monthRecords.forEach(r => { lineCount[r.line] = (lineCount[r.line] || 0) + 1; });
    const mostAffected = Object.entries(lineCount).sort((a, b) => b[1] - a[1])[0]?.[0] || "—";

    return { totalToday, active, avgDuration, mostAffected };
  }, [records]);

  // Filtered records
  const filteredRecords = useMemo(() => {
    if (!records) return [];
    return records.filter(r => {
      if (filterLine !== "all" && r.line !== filterLine) return false;
      if (filterCategory !== "all" && r.category !== filterCategory) return false;
      if (filterStatus === "active" && r.ended_at) return false;
      if (filterStatus === "resolved" && !r.ended_at) return false;
      return true;
    });
  }, [records, filterLine, filterCategory, filterStatus]);

  const getDuration = (r: DowntimeRecord) => {
    const end = r.ended_at ? new Date(r.ended_at) : new Date();
    const mins = differenceInMinutes(end, new Date(r.started_at));
    if (mins < 60) return `${mins}min`;
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  };

  const formFieldsJsx = (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Line *</Label>
          <Select value={formLine} onValueChange={setFormLine}>
            <SelectTrigger><SelectValue placeholder="Select line" /></SelectTrigger>
            <SelectContent>
              {LINES.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Machine</Label>
          <Input value={formMachine} onChange={e => setFormMachine(e.target.value)} placeholder="Machine name" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Category *</Label>
          <Select value={formCategory} onValueChange={setFormCategory}>
            <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
            <SelectContent>
              {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Reason *</Label>
          <Input value={formReason} onChange={e => setFormReason(e.target.value)} placeholder="Reason for downtime" required />
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
        <Select value={formWOId} onValueChange={setFormWOId}>
          <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
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
        <Textarea value={formNotes} onChange={e => setFormNotes(e.target.value)} placeholder="Optional notes" rows={2} />
      </div>
    </div>
  );

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-2"><Clock className="h-6 w-6" /> Downtime</h2>
            <p className="text-muted-foreground">Track and manage production line stoppages</p>
          </div>
          <Button className="bg-orange-600 hover:bg-orange-700 text-white" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-2" /> Register Downtime
          </Button>
        </div>

        {/* KPI Cards */}
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

        {/* Filters */}
        <Card>
          <CardHeader>
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
            <DialogHeader><DialogTitle>Edit Downtime</DialogTitle></DialogHeader>
            <FormFields />
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
