import { useMemo, useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Download, List, BarChart3, Tags, Trash2, Upload, Columns3, Camera, Clock, X, Loader2, ClipboardCheck } from "lucide-react";
import { QualityImportDialog } from "@/components/QualityImportDialog";
import { toast } from "sonner";
import { format, subDays } from "date-fns";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { cn } from "@/lib/utils";
import { QUALITY_LABELS, QUALITY_DEPARTMENTS, QUALITY_STATUSES, QUALITY_SEVERITIES, statusMeta, severityMeta } from "@/lib/qualityConstants";
import { useQualityOptions, useAllQualityOptions, type QualityOption } from "@/hooks/useQualityOptions";
import { useRole } from "@/hooks/useRole";
import { useQualityHistory, getQualityPhotoUrl, useUploadQualityPhoto, useDeleteQualityPhoto, type QualityHistoryRow } from "@/hooks/useQualityIssue";
import { LeaderScorecard } from "@/components/LeaderScorecard";

interface ActionType { id: string; code: string; label: string; points: number; active: boolean }
interface QualityAction {
  id: string; action_no: string | null; action_type_id: string; line: string | null; shift: string | null;
  leader_name: string | null; department: string | null; status: string; labels: string[] | null;
  description: string | null; recorded_at: string; points: number | null;
  severity: string | null; attachments: string[] | null;
}

const todayISO = () => new Date().toISOString().slice(0, 10);
const makeEmptyForm = () => ({
  action_no: "", action_type_id: "", line: "", shift: "DAY", leader_id: "", leader_name: "",
  date: todayISO(), sku: "", batch: "",
  department: "", status: "todo", severity: "", labels: [] as string[], description: "",
});

export function QualityActionsView() {
  const { can } = useRole();
  const canManage = can("quality.manage");
  const qc = useQueryClient();

  const { data: qOpts } = useQualityOptions();
  const LABELS = qOpts?.labels ?? [...QUALITY_LABELS];
  const DEPTS = qOpts?.departments ?? [...QUALITY_DEPARTMENTS];

  const [view, setView] = useState<"list" | "kanban" | "analytics">("list");
  const [listsOpen, setListsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [days, setDays] = useState("30");
  const [filterLine, setFilterLine] = useState("__all__");
  const [filterLeader, setFilterLeader] = useState("__all__");
  const [filterStatus, setFilterStatus] = useState("__all__");
  const [filterDept, setFilterDept] = useState("__all__");
  const [filterSeverity, setFilterSeverity] = useState("__all__");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(makeEmptyForm());

  const from = useMemo(() => format(subDays(new Date(), Number(days)), "yyyy-MM-dd"), [days]);

  const { data: types = [] } = useQuery({
    queryKey: ["quality_action_types"],
    queryFn: async () => {
      const { data, error } = await supabase.from("quality_action_types").select("*").order("label");
      if (error) throw error;
      return (data ?? []) as ActionType[];
    },
  });
  const { data: lines = [] } = useQuery({
    queryKey: ["lines"],
    queryFn: async () => {
      const { data } = await supabase.from("lines").select("name").order("name");
      return (data ?? []) as { name: string }[];
    },
  });
  const { data: leaders = [] } = useQuery({
    queryKey: ["line_leaders_active"],
    queryFn: async () => {
      const { data } = await supabase.from("line_leaders").select("id, name").eq("active", true).order("name");
      return (data ?? []) as { id: string; name: string }[];
    },
  });
  const { data: actions = [] } = useQuery({
    queryKey: ["quality_actions", from],
    queryFn: async () => {
      const { data, error } = await supabase.from("quality_actions").select("*").gte("recorded_at", from).order("recorded_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as QualityAction[];
    },
  });

  const filtered = useMemo(() =>
    actions.filter((a) =>
      (filterLine === "__all__" || a.line === filterLine) &&
      (filterLeader === "__all__" || a.leader_name === filterLeader) &&
      (filterStatus === "__all__" || a.status === filterStatus) &&
      (filterDept === "__all__" || a.department === filterDept) &&
      (filterSeverity === "__all__" || (a.severity ?? "") === filterSeverity)),
    [actions, filterLine, filterLeader, filterStatus, filterDept, filterSeverity]
  );

  const detailAction = useMemo(() => actions.find((a) => a.id === detailId) ?? null, [actions, detailId]);


  const kpis = useMemo(() => ({
    total: filtered.length,
    todo: filtered.filter((x) => x.status === "todo").length,
    in_progress: filtered.filter((x) => x.status === "in_progress").length,
    complete: filtered.filter((x) => x.status === "complete").length,
  }), [filtered]);

  const toggleLabel = (l: string) =>
    setForm((f) => ({ ...f, labels: f.labels.includes(l) ? f.labels.filter((x) => x !== l) : [...f.labels, l] }));

  const create = useMutation({
    mutationFn: async () => {
      const leader = leaders.find((l) => l.id === form.leader_id);
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from("quality_actions").insert({
        action_no: form.action_no || null,
        action_type_id: null,
        line: form.line || null,
        shift: form.shift || null,
        leader_id: null,
        leader_name: leader?.name ?? (form.leader_name || null),
        sku: form.sku || null,
        batch: form.batch || null,
        department: form.department || null,
        status: form.status,
        severity: form.severity || null,
        labels: form.labels,
        description: form.description || null,
        points: 1,
        recorded_by: u.user?.id ?? null,
        recorded_at: new Date(`${form.date || todayISO()}T12:00:00`).toISOString(),
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quality_actions"] });
      setOpen(false); setForm(makeEmptyForm());
      toast.success("Logged");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Auto-pull leader / SKU / batch from the production data once line + date + shift are set.
  // The supervisor only corrects what's wrong afterwards.
  useEffect(() => {
    if (!open || !form.line || !form.date || !form.shift) return;
    let cancelled = false;
    (async () => {
      const { data: sess } = await supabase
        .from("production_sessions")
        .select("id, leader_name")
        .eq("line", form.line)
        .eq("session_date", form.date)
        .eq("shift", form.shift)
        .maybeSingle();
      if (cancelled || !sess) return;
      let sku = "";
      let batch = "";
      const { data: items } = await (supabase as any)
        .from("production_items")
        .select("blender_ref, sku_code_text, sku:sku_id(code)")
        .eq("session_id", (sess as any).id)
        .order("created_at", { ascending: false })
        .limit(1);
      const it = (items ?? [])[0];
      if (it) { sku = it.sku?.code ?? it.sku_code_text ?? ""; batch = it.blender_ref ?? ""; }
      if (cancelled) return;
      const leaderName = (sess as any).leader_name ?? "";
      const matched = leaders.find((l) => l.name === leaderName);
      setForm((f) => ({
        ...f,
        leader_name: leaderName || f.leader_name,
        leader_id: matched?.id ?? f.leader_id,
        sku: sku || f.sku,
        batch: batch || f.batch,
      }));
    })();
    return () => { cancelled = true; };
  }, [open, form.line, form.date, form.shift, leaders]);

  // As soon as a batch code is typed, pull the SKU from production (by batch/blender_ref).
  // If the operator hasn't logged that batch yet, the action still saves with the batch and
  // the SKU is back-filled automatically once the production is entered (DB trigger).
  useEffect(() => {
    if (!open || !form.batch.trim()) return;
    const t = setTimeout(async () => {
      const { data } = await (supabase as any)
        .from("production_items")
        .select("sku_code_text, sku:sku_id(code)")
        .eq("blender_ref", form.batch.trim())
        .order("created_at", { ascending: false })
        .limit(1);
      const it = (data ?? [])[0];
      const sku = it?.sku?.code ?? it?.sku_code_text ?? "";
      if (sku) setForm((f) => ({ ...f, sku }));
    }, 400);
    return () => clearTimeout(t);
  }, [open, form.batch]);

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("quality_actions").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["quality_actions"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const setSeverity = useMutation({
    mutationFn: async ({ id, severity }: { id: string; severity: string | null }) => {
      const { error } = await supabase.from("quality_actions").update({ severity }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["quality_actions"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteAction = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("quality_actions").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["quality_actions"] }); toast.success("Action deleted"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const exportCSV = () => {
    const rows = [["Date", "Action #", "Status", "Severity", "Line", "Shift", "Leader", "Department", "Labels", "Notes"]];
    for (const a of filtered) {
      rows.push([
        a.recorded_at, a.action_no ?? "", statusMeta(a.status).label, severityMeta(a.severity)?.label ?? "",
        a.line ?? "", a.shift ?? "", a.leader_name ?? "", a.department ?? "", (a.labels ?? []).join("; "),
        (a.description ?? "").replace(/"/g, '""'),
      ]);
    }
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `quality-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
        <div className="flex items-center justify-end flex-wrap gap-3">
          <div className="flex flex-wrap gap-2">
            <div className="inline-flex rounded-md border p-0.5">
              <button type="button" onClick={() => setView("list")} className={cn("inline-flex items-center gap-1 rounded px-3 py-1 text-sm font-medium transition-colors", view === "list" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                <List className="h-4 w-4" /> List
              </button>
              <button type="button" onClick={() => setView("kanban")} className={cn("inline-flex items-center gap-1 rounded px-3 py-1 text-sm font-medium transition-colors", view === "kanban" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                <Columns3 className="h-4 w-4" /> Kanban
              </button>
              <button type="button" onClick={() => setView("analytics")} className={cn("inline-flex items-center gap-1 rounded px-3 py-1 text-sm font-medium transition-colors", view === "analytics" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                <BarChart3 className="h-4 w-4" /> Analytics
              </button>
            </div>
            {canManage && <Button variant="outline" onClick={() => setListsOpen(true)}><Tags className="h-4 w-4 mr-1" />Lists</Button>}
            {canManage && <Button variant="outline" onClick={() => setImportOpen(true)}><Upload className="h-4 w-4 mr-1" />Import</Button>}
            <Button variant="outline" onClick={exportCSV}><Download className="h-4 w-4 mr-1" />Export</Button>
            <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setForm(makeEmptyForm()); }}>
              <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-1" />Log action</Button></DialogTrigger>
              <DialogContent className="max-h-[90vh] overflow-y-auto">
                <DialogHeader><DialogTitle>Log quality action</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Action #</Label>
                      <Input placeholder="e.g. AC-6114" value={form.action_no} onChange={(e) => setForm({ ...form, action_no: e.target.value })} />
                    </div>
                    <div><Label>Status</Label>
                      <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{QUALITY_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div><Label>Severity</Label>
                    <Select value={form.severity || "__none__"} onValueChange={(v) => setForm({ ...form, severity: v === "__none__" ? "" : v })}>
                      <SelectTrigger><SelectValue placeholder="Pick severity" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— None —</SelectItem>
                        {QUALITY_SEVERITIES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div><Label>Line</Label>
                      <Select value={form.line} onValueChange={(v) => setForm({ ...form, line: v })}>
                        <SelectTrigger><SelectValue placeholder="Pick line" /></SelectTrigger>
                        <SelectContent>{lines.map((l) => <SelectItem key={l.name} value={l.name}>{l.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div><Label>Date</Label>
                      <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
                    </div>
                    <div><Label>Shift</Label>
                      <Select value={form.shift} onValueChange={(v) => setForm({ ...form, shift: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="DAY">Day</SelectItem><SelectItem value="NIGHT">Night</SelectItem></SelectContent>
                      </Select>
                    </div>
                  </div>
                  <p className="-mt-1 text-[11px] text-muted-foreground">Pick line, date &amp; shift — leader, SKU and batch fill in automatically. Correct anything that's wrong.</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Leader</Label>
                      <Select value={form.leader_id} onValueChange={(v) => setForm({ ...form, leader_id: v })}>
                        <SelectTrigger><SelectValue placeholder={form.leader_name || "Pick leader"} /></SelectTrigger>
                        <SelectContent>
                          {form.leader_name && !leaders.some((l) => l.name === form.leader_name) && (
                            <SelectItem value="__auto__">{form.leader_name} (from production)</SelectItem>
                          )}
                          {leaders.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div><Label>Department</Label>
                      <Select value={form.department} onValueChange={(v) => setForm({ ...form, department: v })}>
                        <SelectTrigger><SelectValue placeholder="Pick dept" /></SelectTrigger>
                        <SelectContent>{DEPTS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>SKU</Label>
                      <Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="auto from production" />
                    </div>
                    <div><Label>Batch code</Label>
                      <Input value={form.batch} onChange={(e) => setForm({ ...form, batch: e.target.value })} placeholder="auto from production" />
                    </div>
                  </div>
                  <div>
                    <Label>Labels</Label>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {LABELS.map((l) => {
                        const on = form.labels.includes(l);
                        return (
                          <button key={l} type="button" onClick={() => toggleLabel(l)}
                            className={cn("rounded-full border px-2.5 py-1 text-xs transition-colors", on ? "border-primary bg-primary text-primary-foreground" : "bg-muted/40 hover:bg-accent")}>
                            {l}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div><Label>Notes</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
                </div>
                <DialogFooter><Button onClick={() => create.mutate()} disabled={create.isPending}>Save</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* KPIs */}
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Total actions</div><div className="text-2xl font-bold">{kpis.total}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">To do</div><div className="text-2xl font-bold text-amber-600 dark:text-amber-400">{kpis.todo}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">In progress</div><div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{kpis.in_progress}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Complete</div><div className="text-2xl font-bold text-green-600 dark:text-green-400">{kpis.complete}</div></CardContent></Card>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2">
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="7">7 days</SelectItem><SelectItem value="30">30 days</SelectItem><SelectItem value="90">90 days</SelectItem></SelectContent>
          </Select>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="__all__">All Statuses</SelectItem>{QUALITY_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={filterSeverity} onValueChange={setFilterSeverity}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="__all__">All severity</SelectItem>{QUALITY_SEVERITIES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={filterLine} onValueChange={setFilterLine}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="__all__">All Lines</SelectItem>{lines.map((l) => <SelectItem key={l.name} value={l.name}>{l.name}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={filterDept} onValueChange={setFilterDept}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="__all__">All departments</SelectItem>{DEPTS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={filterLeader} onValueChange={setFilterLeader}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="__all__">All leaders</SelectItem>{leaders.map((l) => <SelectItem key={l.id} value={l.name}>{l.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>

        {view === "analytics" ? (
          <QualityAnalytics actions={filtered} from={from} />
        ) : view === "kanban" ? (
          <IssueKanban actions={filtered} canManage={canManage} onOpen={setDetailId} onMove={(id, status) => setStatus.mutate({ id, status })} />
        ) : (
          <Card>
            <CardHeader><CardTitle>Log ({filtered.length})</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>When</TableHead><TableHead>#</TableHead><TableHead>Status</TableHead><TableHead>Severity</TableHead>
                  <TableHead>Line</TableHead><TableHead>Leader</TableHead>
                  <TableHead>Dept</TableHead><TableHead>Labels</TableHead><TableHead>Notes</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {filtered.length === 0 && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground">No actions</TableCell></TableRow>}
                  {filtered.map((a) => {
                    const sev = severityMeta(a.severity);
                    return (
                    <TableRow key={a.id} className="cursor-pointer" onClick={() => setDetailId(a.id)}>
                      <TableCell className="whitespace-nowrap">{format(new Date(a.recorded_at), "dd/MM HH:mm")}</TableCell>
                      <TableCell className="font-mono text-xs">{a.action_no ?? "—"}</TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Select value={a.status} onValueChange={(v) => setStatus.mutate({ id: a.id, status: v })}>
                          <SelectTrigger className={cn("h-7 w-32 border text-xs", statusMeta(a.status).badge)}><SelectValue /></SelectTrigger>
                          <SelectContent>{QUALITY_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>{sev ? <Badge variant="outline" className={cn("text-[10px]", sev.badge)}>{sev.label}</Badge> : <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell>{a.line ?? "—"}</TableCell>
                      <TableCell>{a.leader_name ?? "—"}</TableCell>
                      <TableCell>{a.department ?? "—"}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {(a.labels ?? []).map((l) => <Badge key={l} variant="secondary" className="text-[10px]">{l}</Badge>)}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-xs truncate">{a.description ?? "—"}</TableCell>
                    </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        <QualityIssueDetail
          action={detailAction}
          canManage={canManage}
          onOpenChange={(o) => { if (!o) setDetailId(null); }}
          onStatus={(status) => detailAction && setStatus.mutate({ id: detailAction.id, status })}
          onSeverity={(severity) => detailAction && setSeverity.mutate({ id: detailAction.id, severity })}
          onDelete={() => { if (detailAction) { deleteAction.mutate(detailAction.id); setDetailId(null); } }}
        />

        {canManage && (
          <Dialog open={listsOpen} onOpenChange={setListsOpen}>
            <DialogContent className="max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle>Manage labels &amp; departments</DialogTitle></DialogHeader>
              <QualityListsManager />
            </DialogContent>
          </Dialog>
        )}

        {canManage && (
          <QualityImportDialog
            open={importOpen}
            onOpenChange={setImportOpen}
            types={types}
            onImported={() => qc.invalidateQueries({ queryKey: ["quality_actions"] })}
          />
        )}
      </div>
  );
}

// ============================================================
// Kanban board
// ============================================================
function IssueKanban({ actions, canManage, onOpen, onMove }: {
  actions: QualityAction[]; canManage: boolean;
  onOpen: (id: string) => void; onMove: (id: string, status: string) => void;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {QUALITY_STATUSES.map((col) => {
        const items = actions.filter((a) => a.status === col.value);
        return (
          <div key={col.value} className="rounded-lg border bg-muted/20">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <span className="inline-flex items-center gap-2 text-sm font-semibold">
                <span className={cn("h-2.5 w-2.5 rounded-full")} style={{ backgroundColor: col.color }} />
                {col.label}
              </span>
              <Badge variant="secondary">{items.length}</Badge>
            </div>
            <div className="min-h-[80px] space-y-2 p-2">
              {items.length === 0 && <p className="px-2 py-4 text-center text-xs text-muted-foreground">Empty</p>}
              {items.map((a) => <IssueCard key={a.id} a={a} canManage={canManage} onOpen={onOpen} onMove={onMove} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function IssueCard({ a, canManage, onOpen, onMove }: {
  a: QualityAction; canManage: boolean;
  onOpen: (id: string) => void; onMove: (id: string, status: string) => void;
}) {
  const sev = severityMeta(a.severity);
  const nPhotos = a.attachments?.length ?? 0;
  return (
    <div onClick={() => onOpen(a.id)}
      className={cn("cursor-pointer rounded-md border border-l-4 bg-background p-2.5 shadow-sm transition-colors hover:bg-accent/50", sev?.accent ?? "border-l-transparent")}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs text-muted-foreground">{a.action_no ?? "—"}</span>
        {sev && <Badge variant="outline" className={cn("text-[10px]", sev.badge)}>{sev.label}</Badge>}
      </div>
      {a.description && <p className="mt-1 line-clamp-2 text-xs">{a.description}</p>}
      {(a.labels?.length ?? 0) > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {(a.labels ?? []).slice(0, 4).map((l) => <Badge key={l} variant="secondary" className="text-[10px]">{l}</Badge>)}
        </div>
      )}
      <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
        <span className="truncate">{a.line ?? "—"}{a.leader_name ? ` · ${a.leader_name}` : ""}</span>
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          {nPhotos > 0 && <span className="inline-flex items-center gap-0.5"><Camera className="h-3 w-3" />{nPhotos}</span>}
          {format(new Date(a.recorded_at), "dd/MM")}
        </span>
      </div>
      {canManage && (
        <div className="mt-2" onClick={(e) => e.stopPropagation()}>
          <Select value={a.status} onValueChange={(v) => onMove(a.id, v)}>
            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{QUALITY_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>Move to {s.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Issue detail — photos + audit history
// ============================================================
function DetailMeta({ label, value }: { label: string; value: string | null | undefined }) {
  return <div><span className="text-muted-foreground">{label}: </span>{value || "—"}</div>;
}

function describeHistory(h: QualityHistoryRow): string {
  if (h.field === "created") return "Issue created";
  if (h.field === "status") return `Status: ${statusMeta(h.old_value).label} → ${statusMeta(h.new_value).label}`;
  if (h.field === "severity") return `Severity: ${severityMeta(h.old_value)?.label ?? "None"} → ${severityMeta(h.new_value)?.label ?? "None"}`;
  return `${h.field}: ${h.old_value ?? "—"} → ${h.new_value ?? "—"}`;
}

function PhotoThumb({ path, canDelete, onDelete }: { path: string; canDelete: boolean; onDelete: () => void }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let ok = true;
    getQualityPhotoUrl(path).then((u) => { if (ok) setUrl(u); });
    return () => { ok = false; };
  }, [path]);
  return (
    <div className="group relative aspect-square overflow-hidden rounded border bg-muted">
      {url
        ? <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="Quality issue attachment" className="h-full w-full object-cover" /></a>
        : <div className="flex h-full items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>}
      {canDelete && (
        <button type="button" onClick={onDelete}
          className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white opacity-0 transition-opacity group-hover:opacity-100">
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

function QualityIssueDetail({ action, canManage, onOpenChange, onStatus, onSeverity, onDelete }: {
  action: QualityAction | null; canManage: boolean;
  onOpenChange: (open: boolean) => void; onStatus: (status: string) => void; onSeverity: (severity: string | null) => void;
  onDelete: () => void;
}) {
  const { data: history = [] } = useQualityHistory(action?.id);
  const upload = useUploadQualityPhoto();
  const del = useDeleteQualityPhoto();
  const fileRef = useRef<HTMLInputElement>(null);
  const attachments = action?.attachments ?? [];

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f && action) {
      upload.mutate(
        { actionId: action.id, file: f, current: attachments },
        { onError: (err) => toast.error((err as Error).message) },
      );
    }
    e.target.value = "";
  };

  return (
    <Dialog open={!!action} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        {action && (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm">{action.action_no ?? "Issue"}</span>
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Status</Label>
                  <Select value={action.status} onValueChange={onStatus} disabled={!canManage}>
                    <SelectTrigger className={cn("border", statusMeta(action.status).badge)}><SelectValue /></SelectTrigger>
                    <SelectContent>{QUALITY_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>Severity</Label>
                  <Select value={action.severity || "__none__"} onValueChange={(v) => onSeverity(v === "__none__" ? null : v)} disabled={!canManage}>
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— None —</SelectItem>
                      {QUALITY_SEVERITIES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <DetailMeta label="Line" value={action.line} />
                <DetailMeta label="Shift" value={action.shift} />
                <DetailMeta label="Leader" value={action.leader_name} />
                <DetailMeta label="Department" value={action.department} />
                <DetailMeta label="Logged" value={format(new Date(action.recorded_at), "dd/MM/yyyy HH:mm")} />
              </div>

              {(action.labels?.length ?? 0) > 0 && (
                <div className="flex flex-wrap gap-1">{(action.labels ?? []).map((l) => <Badge key={l} variant="secondary" className="text-[10px]">{l}</Badge>)}</div>
              )}
              {action.description && <p className="whitespace-pre-wrap rounded border bg-muted/30 p-2 text-sm">{action.description}</p>}

              {/* Photos */}
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <Label className="flex items-center gap-1"><Camera className="h-4 w-4" /> Photos ({attachments.length})</Label>
                  {canManage && (
                    <>
                      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPick} />
                      <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={upload.isPending}>
                        {upload.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Camera className="mr-1 h-4 w-4" />}Add photo
                      </Button>
                    </>
                  )}
                </div>
                {attachments.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No photos.</p>
                ) : (
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {attachments.map((p) => (
                      <PhotoThumb key={p} path={p} canDelete={canManage}
                        onDelete={() => del.mutate({ actionId: action.id, path: p, current: attachments }, { onError: (e) => toast.error((e as Error).message) })} />
                    ))}
                  </div>
                )}
              </div>

              {/* History */}
              <div>
                <Label className="flex items-center gap-1"><Clock className="h-4 w-4" /> History</Label>
                <div className="mt-1.5 space-y-1.5">
                  {history.length === 0 && <p className="text-xs text-muted-foreground">No history yet.</p>}
                  {history.map((h) => (
                    <div key={h.id} className="flex items-start gap-2 text-xs">
                      <span className="whitespace-nowrap text-muted-foreground">{format(new Date(h.changed_at), "dd/MM HH:mm")}</span>
                      <span>{describeHistory(h)}</span>
                    </div>
                  ))}
                </div>
              </div>

              {canManage && (
                <div className="flex justify-end border-t pt-3">
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
                        <Trash2 className="h-4 w-4 mr-1" /> Delete action
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete this action?</AlertDialogTitle>
                        <AlertDialogDescription>
                          {action.action_no ? `Action ${action.action_no}` : "This action"} will be permanently removed. This cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={onDelete}>Delete</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}


function QualityListsManager() {
  const qc = useQueryClient();
  const { data: options = [] } = useAllQualityOptions();
  const [kind, setKind] = useState<"label" | "department">("label");
  const [value, setValue] = useState("");

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["quality_options_all"] });
    qc.invalidateQueries({ queryKey: ["quality_options"] });
  };

  const add = async () => {
    const v = value.trim();
    if (!v) return;
    const maxSort = options.filter((o) => o.kind === kind).reduce((m, o) => Math.max(m, o.sort), 0);
    const { error } = await supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not in generated types yet
      .from("quality_options" as any)
      .insert({ kind, value: v, sort: maxSort + 1, active: true } as unknown as never);
    if (error) { toast.error(error.message); return; }
    setValue(""); refresh();
  };
  const toggle = async (o: QualityOption) => {
    const { error } = await supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not in generated types yet
      .from("quality_options" as any)
      .update({ active: !o.active } as unknown as never)
      .eq("id", o.id);
    if (error) { toast.error(error.message); return; }
    refresh();
  };
  const remove = async (o: QualityOption) => {
    const { error } = await supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not in generated types yet
      .from("quality_options" as any)
      .delete()
      .eq("id", o.id);
    if (error) { toast.error(error.message); return; }
    refresh();
  };

  const groups: { kind: "label" | "department"; title: string }[] = [
    { kind: "label", title: "Labels" },
    { kind: "department", title: "Departments" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Select value={kind} onValueChange={(v) => setKind(v as "label" | "department")}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="label">Label</SelectItem><SelectItem value="department">Department</SelectItem></SelectContent>
        </Select>
        <Input placeholder="New value..." value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
        <Button onClick={add}>Add</Button>
      </div>
      {groups.map((g) => (
        <div key={g.kind}>
          <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">{g.title}</p>
          <div className="divide-y rounded border">
            {options.filter((o) => o.kind === g.kind).length === 0 && (
              <p className="px-3 py-2 text-sm text-muted-foreground">None yet.</p>
            )}
            {options.filter((o) => o.kind === g.kind).map((o) => (
              <div key={o.id} className="flex items-center justify-between px-3 py-1.5">
                <span className={cn("text-sm", !o.active && "text-muted-foreground line-through")}>{o.value}</span>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => toggle(o)}>{o.active ? "Hide" : "Show"}</Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive"><Trash2 className="h-4 w-4" /></Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Remove "{o.value}"?</AlertDialogTitle>
                        <AlertDialogDescription>This removes the option from the list. You can add it again later.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => remove(o)}>Remove</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// Analytics
// ============================================================
function QualityAnalytics({ actions, from }: { actions: QualityAction[]; from: string }) {
  const [selectedLeader, setSelectedLeader] = useState<string | null>(null);
  const byDay = useMemo(() => {
    const m = new Map<string, { key: string; label: string; todo: number; in_progress: number; complete: number }>();
    for (const a of actions) {
      const d = new Date(a.recorded_at);
      const key = format(d, "yyyy-MM-dd");
      const cur = m.get(key) ?? { key, label: format(d, "dd/MM"), todo: 0, in_progress: 0, complete: 0 };
      const s = (a.status === "in_progress" || a.status === "complete") ? a.status : "todo";
      cur[s] += 1;
      m.set(key, cur);
    }
    return Array.from(m.values()).sort((a, b) => a.key.localeCompare(b.key));
  }, [actions]);

  const byLabel = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of actions) for (const l of a.labels ?? []) m.set(l, (m.get(l) ?? 0) + 1);
    return Array.from(m.entries()).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
  }, [actions]);

  const byDept = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of actions) { const d = a.department ?? "—"; m.set(d, (m.get(d) ?? 0) + 1); }
    return Array.from(m.entries()).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
  }, [actions]);

  const [leaderSearch, setLeaderSearch] = useState("");
  const byLeader = useMemo(() => {
    const m = new Map<string, { count: number; critical: number; high: number }>();
    for (const a of actions) {
      const l = a.leader_name?.trim() || "—";
      const cur = m.get(l) ?? { count: 0, critical: 0, high: 0 };
      cur.count += 1;
      if (a.severity === "critical") cur.critical += 1;
      else if (a.severity === "high") cur.high += 1;
      m.set(l, cur);
    }
    return Array.from(m.entries()).map(([label, v]) => ({ label, ...v })).sort((a, b) => b.count - a.count);
  }, [actions]);
  const filteredLeaders = useMemo(() => {
    const q = leaderSearch.trim().toLowerCase();
    const list = q ? byLeader.filter((l) => l.label.toLowerCase().includes(q)) : byLeader;
    return list.slice(0, 15);
  }, [byLeader, leaderSearch]);

  const gridStroke = "hsl(var(--border))";

  if (actions.length === 0) {
    return <Card><CardContent className="p-8 text-center text-muted-foreground">No actions in this period.</CardContent></Card>;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Actions by status over time</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={byDay} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
              <XAxis dataKey="label" fontSize={11} tickLine={false} />
              <YAxis fontSize={11} allowDecimals={false} tickLine={false} />
              <Tooltip contentStyle={{ fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="todo" stackId="s" fill={statusMeta("todo").color} name="To do" />
              <Bar dataKey="in_progress" stackId="s" fill={statusMeta("in_progress").color} name="In progress" />
              <Bar dataKey="complete" stackId="s" fill={statusMeta("complete").color} name="Complete" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Leaderboard — who has the most actions */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
          <CardTitle className="text-base">Actions by leader</CardTitle>
          <Input value={leaderSearch} onChange={(e) => setLeaderSearch(e.target.value)} placeholder="Search leader…" className="h-8 w-48" />
        </CardHeader>
        <CardContent>
          {filteredLeaders.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No leaders match “{leaderSearch}”.</p>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={Math.max(160, filteredLeaders.length * 34)}>
                <BarChart data={filteredLeaders} layout="vertical" margin={{ top: 0, right: 24, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} horizontal={false} />
                  <XAxis type="number" allowDecimals={false} fontSize={11} tickLine={false} />
                  <YAxis type="category" dataKey="label" width={130} fontSize={11} tickLine={false} />
                  <Tooltip contentStyle={{ fontSize: 12 }} cursor={{ fill: "hsl(var(--muted))" }} />
                  <Bar dataKey="count" name="Actions" fill="hsl(0 72% 51%)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <p className="mt-2 mb-1 text-[11px] text-muted-foreground">Click a leader to open the scorecard.</p>
              <div>
                {filteredLeaders.map((l, i) => (
                  <button key={l.label} type="button" onClick={() => l.label !== "—" && setSelectedLeader(l.label)}
                    className="flex w-full items-center justify-between border-b py-1 text-left text-sm transition-colors last:border-0 hover:bg-accent/50 disabled:cursor-default disabled:hover:bg-transparent"
                    disabled={l.label === "—"}>
                    <span className="truncate"><span className="mr-2 text-xs text-muted-foreground">#{i + 1}</span>{l.label}</span>
                    <span className="flex items-center gap-2 whitespace-nowrap">
                      {l.critical > 0 && <Badge variant="outline" className={cn("text-[10px]", severityMeta("critical")?.badge)}>{l.critical} critical</Badge>}
                      {l.high > 0 && <Badge variant="outline" className={cn("text-[10px]", severityMeta("high")?.badge)}>{l.high} high</Badge>}
                      <span className="font-semibold tabular-nums">{l.count}</span>
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Actions by label" data={byLabel} color="hsl(217 91% 60%)" />
        <ChartCard title="Actions by department" data={byDept} color="hsl(262 83% 58%)" />
      </div>

      <LeaderScorecard leaderName={selectedLeader} fromDate={from} onClose={() => setSelectedLeader(null)} />
    </div>
  );
}

function ChartCard({ title, data, color }: { title: string; data: { label: string; count: number }[]; color: string }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No data</p>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(160, data.length * 34)}>
            <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
              <XAxis type="number" allowDecimals={false} fontSize={11} tickLine={false} />
              <YAxis type="category" dataKey="label" width={120} fontSize={11} tickLine={false} />
              <Tooltip contentStyle={{ fontSize: 12 }} cursor={{ fill: "hsl(var(--muted))" }} />
              <Bar dataKey="count" fill={color} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

