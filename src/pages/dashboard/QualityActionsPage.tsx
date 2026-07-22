import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Download, Settings2, List, BarChart3, Tags, Trash2, Upload } from "lucide-react";
import { QualityImportDialog } from "@/components/QualityImportDialog";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { format, subDays } from "date-fns";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { cn } from "@/lib/utils";
import { QUALITY_LABELS, QUALITY_DEPARTMENTS, QUALITY_STATUSES, statusMeta } from "@/lib/qualityConstants";
import { useQualityOptions, useAllQualityOptions, type QualityOption } from "@/hooks/useQualityOptions";
import { useRole } from "@/hooks/useRole";

interface ActionType { id: string; code: string; label: string; points: number; active: boolean }
interface QualityAction {
  id: string; action_no: string | null; action_type_id: string; line: string | null; shift: string | null;
  leader_name: string | null; department: string | null; status: string; labels: string[] | null;
  description: string | null; recorded_at: string; points: number | null;
}

const emptyForm = {
  action_no: "", action_type_id: "", line: "", shift: "DAY", leader_id: "",
  department: "", status: "todo", labels: [] as string[], description: "",
};

export function QualityActionsView() {
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const { can } = useRole();
  const canManage = can("quality.manage");
  const qc = useQueryClient();

  const { data: qOpts } = useQualityOptions();
  const LABELS = qOpts?.labels ?? [...QUALITY_LABELS];
  const DEPTS = qOpts?.departments ?? [...QUALITY_DEPARTMENTS];

  const [view, setView] = useState<"list" | "analytics">("list");
  const [listsOpen, setListsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [days, setDays] = useState("30");
  const [filterLine, setFilterLine] = useState("__all__");
  const [filterLeader, setFilterLeader] = useState("__all__");
  const [filterStatus, setFilterStatus] = useState("__all__");
  const [filterDept, setFilterDept] = useState("__all__");
  const [open, setOpen] = useState(false);
  const [typesOpen, setTypesOpen] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });

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
      (filterDept === "__all__" || a.department === filterDept)),
    [actions, filterLine, filterLeader, filterStatus, filterDept]
  );

  const typeMap = useMemo(() => new Map(types.map((t) => [t.id, t])), [types]);

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
      const type = typeMap.get(form.action_type_id);
      const leader = leaders.find((l) => l.id === form.leader_id);
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from("quality_actions").insert({
        action_no: form.action_no || null,
        action_type_id: form.action_type_id || null,
        line: form.line || null,
        shift: form.shift || null,
        leader_id: form.leader_id || null,
        leader_name: leader?.name ?? null,
        department: form.department || null,
        status: form.status,
        labels: form.labels,
        description: form.description || null,
        points: type?.points ?? 1,
        recorded_by: u.user?.id ?? null,
        recorded_at: new Date().toISOString(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quality_actions"] });
      setOpen(false); setForm({ ...emptyForm });
      toast.success("Logged");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("quality_actions").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["quality_actions"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const exportCSV = () => {
    const rows = [["Date", "Action #", "Status", "Type", "Points", "Line", "Shift", "Leader", "Department", "Labels", "Notes"]];
    for (const a of filtered) {
      const t = typeMap.get(a.action_type_id);
      rows.push([
        a.recorded_at, a.action_no ?? "", statusMeta(a.status).label, t?.label ?? "", String(a.points ?? 0),
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
              <button type="button" onClick={() => setView("analytics")} className={cn("inline-flex items-center gap-1 rounded px-3 py-1 text-sm font-medium transition-colors", view === "analytics" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                <BarChart3 className="h-4 w-4" /> Analytics
              </button>
            </div>
            {canManage && <Button variant="outline" onClick={() => setListsOpen(true)}><Tags className="h-4 w-4 mr-1" />Lists</Button>}
            {isAdmin && <Button variant="outline" onClick={() => setTypesOpen(true)}><Settings2 className="h-4 w-4 mr-1" />Types</Button>}
            {canManage && <Button variant="outline" onClick={() => setImportOpen(true)}><Upload className="h-4 w-4 mr-1" />Import</Button>}
            <Button variant="outline" onClick={exportCSV}><Download className="h-4 w-4 mr-1" />Export</Button>
            <Dialog open={open} onOpenChange={setOpen}>
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
                  <div><Label>Type (optional)</Label>
                    <Select value={form.action_type_id} onValueChange={(v) => setForm({ ...form, action_type_id: v })}>
                      <SelectTrigger><SelectValue placeholder="Pick type (optional)" /></SelectTrigger>
                      <SelectContent>{types.filter((t) => t.active).map((t) => <SelectItem key={t.id} value={t.id}>{t.label} ({t.points}p)</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Line</Label>
                      <Select value={form.line} onValueChange={(v) => setForm({ ...form, line: v })}>
                        <SelectTrigger><SelectValue placeholder="Pick line" /></SelectTrigger>
                        <SelectContent>{lines.map((l) => <SelectItem key={l.name} value={l.name}>{l.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div><Label>Shift</Label>
                      <Select value={form.shift} onValueChange={(v) => setForm({ ...form, shift: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="DAY">Day</SelectItem><SelectItem value="NIGHT">Night</SelectItem></SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Leader</Label>
                      <Select value={form.leader_id} onValueChange={(v) => setForm({ ...form, leader_id: v })}>
                        <SelectTrigger><SelectValue placeholder="Pick leader" /></SelectTrigger>
                        <SelectContent>{leaders.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div><Label>Department</Label>
                      <Select value={form.department} onValueChange={(v) => setForm({ ...form, department: v })}>
                        <SelectTrigger><SelectValue placeholder="Pick dept" /></SelectTrigger>
                        <SelectContent>{DEPTS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
                      </Select>
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
            <SelectContent><SelectItem value="__all__">All status</SelectItem>{QUALITY_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={filterLine} onValueChange={setFilterLine}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="__all__">All lines</SelectItem>{lines.map((l) => <SelectItem key={l.name} value={l.name}>{l.name}</SelectItem>)}</SelectContent>
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
          <QualityAnalytics actions={filtered} typeMap={typeMap} />
        ) : (
          <Card>
            <CardHeader><CardTitle>Log ({filtered.length})</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>When</TableHead><TableHead>#</TableHead><TableHead>Status</TableHead>
                  <TableHead>Type</TableHead><TableHead>Line</TableHead><TableHead>Leader</TableHead>
                  <TableHead>Dept</TableHead><TableHead>Labels</TableHead><TableHead>Notes</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {filtered.length === 0 && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground">No actions</TableCell></TableRow>}
                  {filtered.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="whitespace-nowrap">{format(new Date(a.recorded_at), "dd/MM HH:mm")}</TableCell>
                      <TableCell className="font-mono text-xs">{a.action_no ?? "—"}</TableCell>
                      <TableCell>
                        <Select value={a.status} onValueChange={(v) => setStatus.mutate({ id: a.id, status: v })}>
                          <SelectTrigger className={cn("h-7 w-32 border text-xs", statusMeta(a.status).badge)}><SelectValue /></SelectTrigger>
                          <SelectContent>{QUALITY_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>{typeMap.get(a.action_type_id)?.label ?? "—"}</TableCell>
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
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {isAdmin && (
          <Dialog open={typesOpen} onOpenChange={setTypesOpen}>
            <DialogContent>
              <DialogHeader><DialogTitle>Action types</DialogTitle></DialogHeader>
              <TypesManager types={types} onChange={() => qc.invalidateQueries({ queryKey: ["quality_action_types"] })} />
            </DialogContent>
          </Dialog>
        )}

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
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => remove(o)}><Trash2 className="h-4 w-4" /></Button>
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
function QualityAnalytics({ actions, typeMap }: { actions: QualityAction[]; typeMap: Map<string, ActionType> }) {
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

  const byType = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of actions) { const t = typeMap.get(a.action_type_id)?.label ?? "—"; m.set(t, (m.get(t) ?? 0) + 1); }
    return Array.from(m.entries()).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count).slice(0, 10);
  }, [actions, typeMap]);

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

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Actions by label" data={byLabel} color="hsl(217 91% 60%)" />
        <ChartCard title="Actions by department" data={byDept} color="hsl(262 83% 58%)" />
      </div>
      <ChartCard title="Top action types" data={byType} color="hsl(142 71% 45%)" />
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

function TypesManager({ types, onChange }: { types: ActionType[]; onChange: () => void }) {
  const [code, setCode] = useState(""); const [label, setLabel] = useState(""); const [points, setPoints] = useState(1);
  const add = async () => {
    if (!code || !label) return;
    const { error } = await supabase.from("quality_action_types").insert({ code, label, points, active: true });
    if (error) { toast.error(error.message); return; }
    setCode(""); setLabel(""); setPoints(1); onChange();
  };
  const toggle = async (t: ActionType) => {
    const { error } = await supabase.from("quality_action_types").update({ active: !t.active }).eq("id", t.id);
    if (error) { toast.error(error.message); return; }
    onChange();
  };
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-2">
        <Input placeholder="Code" value={code} onChange={(e) => setCode(e.target.value)} />
        <Input placeholder="Label" value={label} onChange={(e) => setLabel(e.target.value)} className="col-span-2" />
        <Input type="number" placeholder="Points" value={points} onChange={(e) => setPoints(+e.target.value)} />
      </div>
      <Button onClick={add} className="w-full">Add</Button>
      <div className="divide-y">
        {types.map((t) => (
          <div key={t.id} className="flex items-center justify-between py-2">
            <div><span className="font-mono text-xs mr-2">{t.code}</span>{t.label} <Badge variant="outline">{t.points}p</Badge></div>
            <Button size="sm" variant="outline" onClick={() => toggle(t)}>{t.active ? "Deactivate" : "Activate"}</Button>
          </div>
        ))}
      </div>
    </div>
  );
}
