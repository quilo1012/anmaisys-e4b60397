import { useMemo, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Wrench, Plus, AlertTriangle, Clock, CheckCircle2, ChevronDown, ChevronRight,
  Trash2, Loader2, CalendarClock, History,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import {
  usePmSchedules, usePmTasks, usePmExecutions,
  useCreatePmSchedule, useUpdatePmSchedule, useDeletePmSchedule,
  useAddPmTask, useDeletePmTask, useRecordPmExecution,
  pmStatus, type PmSchedule, type PmStatus,
} from "@/hooks/usePreventiveMaintenance";
import { useMachines } from "@/hooks/useMachines";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const statusStyle: Record<PmStatus, { label: string; chip: string; ring: string }> = {
  overdue: { label: "Overdue", chip: "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/40", ring: "border-l-red-500" },
  due_soon: { label: "Due Soon", chip: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40", ring: "border-l-amber-500" },
  ok: { label: "Scheduled", chip: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40", ring: "border-l-emerald-500" },
  inactive: { label: "Inactive", chip: "bg-muted text-muted-foreground border-border", ring: "border-l-muted" },
};

export default function PreventiveMaintenancePage() {
  const { role } = useAuth();
  const { toast } = useToast();
  const canManage = role === "admin" || (role === "manager" || role === "maintenance_manager");

  const { data: schedules, isLoading } = usePmSchedules();
  const { data: machines } = useMachines();
  const createMut = useCreatePmSchedule();
  const deleteMut = useDeletePmSchedule();

  const [filter, setFilter] = useState<PmStatus | "all">("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [executeFor, setExecuteFor] = useState<PmSchedule | null>(null);

  // Create form state
  const [form, setForm] = useState({
    machine: "", title: "", description: "", interval_days: 30, priority: "medium",
  });

  const enriched = useMemo(() => {
    if (!schedules) return [];
    return schedules.map((s) => ({ ...s, _status: pmStatus(s) }));
  }, [schedules]);

  const kpis = useMemo(() => {
    return {
      overdue: enriched.filter((s) => s._status === "overdue").length,
      dueSoon: enriched.filter((s) => s._status === "due_soon").length,
      scheduled: enriched.filter((s) => s._status === "ok").length,
      total: enriched.length,
    };
  }, [enriched]);

  const filtered = useMemo(() => {
    if (filter === "all") return enriched;
    return enriched.filter((s) => s._status === filter);
  }, [enriched, filter]);

  const submitCreate = async () => {
    if (!form.machine || !form.title || !form.interval_days) {
      toast({ title: "Missing fields", description: "Machine, title and interval are required.", variant: "destructive" });
      return;
    }
    try {
      await createMut.mutateAsync(form as any);
      toast({ title: "Schedule created" });
      setForm({ machine: "", title: "", description: "", interval_days: 30, priority: "medium" });
      setCreateOpen(false);
    } catch (e: any) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-4 p-4 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Wrench className="h-6 w-6" /> Preventive Maintenance
            </h1>
            <p className="text-sm text-muted-foreground">
              Schedule recurring maintenance per machine with checklists and history.
            </p>
          </div>
          {canManage && (
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2"><Plus className="h-4 w-4" /> New Schedule</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>New PM Schedule</DialogTitle>
                  <DialogDescription>Plan recurring maintenance for a machine.</DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <div>
                    <Label>Machine</Label>
                    <Select value={form.machine} onValueChange={(v) => setForm((f) => ({ ...f, machine: v }))}>
                      <SelectTrigger><SelectValue placeholder="Select machine" /></SelectTrigger>
                      <SelectContent>
                        {(machines || []).map((m: any) => (
                          <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Title</Label>
                    <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Quarterly inspection" />
                  </div>
                  <div>
                    <Label>Description</Label>
                    <Textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={2} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Interval (days)</Label>
                      <Input type="number" min={1} value={form.interval_days} onChange={(e) => setForm((f) => ({ ...f, interval_days: parseInt(e.target.value || "0", 10) }))} />
                    </div>
                    <div>
                      <Label>Priority</Label>
                      <Select value={form.priority} onValueChange={(v) => setForm((f) => ({ ...f, priority: v }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="low">Low</SelectItem>
                          <SelectItem value="medium">Medium</SelectItem>
                          <SelectItem value="high">High</SelectItem>
                          <SelectItem value="critical">Critical</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                  <Button onClick={submitCreate} disabled={createMut.isPending}>
                    {createMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Create
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiTile icon={<AlertTriangle className="h-5 w-5" />} label="Overdue" value={kpis.overdue} tone={kpis.overdue ? "danger" : "ok"} onClick={() => setFilter("overdue")} active={filter === "overdue"} />
          <KpiTile icon={<Clock className="h-5 w-5" />} label="Due in 7 days" value={kpis.dueSoon} tone={kpis.dueSoon ? "warning" : "ok"} onClick={() => setFilter("due_soon")} active={filter === "due_soon"} />
          <KpiTile icon={<CalendarClock className="h-5 w-5" />} label="Scheduled" value={kpis.scheduled} tone="info" onClick={() => setFilter("ok")} active={filter === "ok"} />
          <KpiTile icon={<CheckCircle2 className="h-5 w-5" />} label="Total" value={kpis.total} tone="ok" onClick={() => setFilter("all")} active={filter === "all"} />
        </div>

        {/* List */}
        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
        ) : !filtered.length ? (
          <Card><CardContent className="py-12 text-center text-muted-foreground">No schedules match this filter.</CardContent></Card>
        ) : (
          <div className="space-y-2">
            {filtered.map((s) => (
              <ScheduleCard
                key={s.id}
                schedule={s}
                status={s._status}
                expanded={!!expanded[s.id]}
                onToggle={() => setExpanded((e) => ({ ...e, [s.id]: !e[s.id] }))}
                onExecute={() => setExecuteFor(s)}
                canManage={canManage}
                onDelete={async () => {
                  if (!confirm(`Delete schedule "${s.title}"?`)) return;
                  try {
                    await deleteMut.mutateAsync(s.id);
                    toast({ title: "Schedule deleted" });
                  } catch (e: any) {
                    toast({ title: "Failed", description: e.message, variant: "destructive" });
                  }
                }}
              />
            ))}
          </div>
        )}

        {/* Execution dialog */}
        {executeFor && (
          <ExecuteDialog schedule={executeFor} onClose={() => setExecuteFor(null)} />
        )}
      </div>
    </DashboardLayout>
  );
}

function KpiTile({
  icon, label, value, tone, onClick, active,
}: {
  icon: React.ReactNode; label: string; value: number;
  tone: "ok" | "warning" | "danger" | "info";
  onClick?: () => void; active?: boolean;
}) {
  const toneStyles: Record<string, string> = {
    ok: "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300",
    warning: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    danger: "border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-300",
    info: "border-blue-500/30 bg-blue-500/5 text-blue-700 dark:text-blue-300",
  };
  return (
    <Card
      onClick={onClick}
      className={cn("cursor-pointer transition-all border", toneStyles[tone], active && "ring-2 ring-primary/50")}
    >
      <CardContent className="p-4 flex items-center gap-3">
        <div className="opacity-80">{icon}</div>
        <div>
          <p className="text-[10px] uppercase tracking-wide opacity-70">{label}</p>
          <p className="text-2xl font-bold">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function ScheduleCard({
  schedule, status, expanded, onToggle, onExecute, canManage, onDelete,
}: {
  schedule: PmSchedule;
  status: PmStatus;
  expanded: boolean;
  onToggle: () => void;
  onExecute: () => void;
  canManage: boolean;
  onDelete: () => void;
}) {
  const sty = statusStyle[status];
  return (
    <Card className={cn("border-l-4", sty.ring)}>
      <Collapsible open={expanded} onOpenChange={onToggle}>
        <div className="flex items-center justify-between p-4 gap-3 flex-wrap">
          <CollapsibleTrigger asChild>
            <button className="flex items-center gap-3 flex-1 min-w-0 text-left">
              {expanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold truncate">{schedule.title}</span>
                  <Badge variant="outline" className={cn("text-xs", sty.chip)}>{sty.label}</Badge>
                  <Badge variant="secondary" className="text-xs">{schedule.machine}</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Every {schedule.interval_days}d ·{" "}
                  {schedule.next_due_at
                    ? <>Next: <span className="font-mono">{format(new Date(schedule.next_due_at), "dd/MM/yyyy")}</span> ({formatDistanceToNow(new Date(schedule.next_due_at), { addSuffix: true })})</>
                    : "Not scheduled yet"}
                  {schedule.last_done_at && <> · Last: {format(new Date(schedule.last_done_at), "dd/MM/yyyy")}</>}
                </p>
              </div>
            </button>
          </CollapsibleTrigger>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={onExecute} className="gap-1">
              <CheckCircle2 className="h-4 w-4" /> Mark done
            </Button>
            {canManage && (
              <Button size="sm" variant="ghost" onClick={onDelete} className="text-destructive">
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
        <CollapsibleContent>
          <div className="px-4 pb-4 border-t pt-3">
            <Tabs defaultValue="tasks">
              <TabsList>
                <TabsTrigger value="tasks">Checklist</TabsTrigger>
                <TabsTrigger value="history"><History className="h-3.5 w-3.5 mr-1" /> History</TabsTrigger>
              </TabsList>
              <TabsContent value="tasks">
                <TasksEditor scheduleId={schedule.id} canManage={canManage} />
              </TabsContent>
              <TabsContent value="history">
                <ExecutionsList scheduleId={schedule.id} />
              </TabsContent>
            </Tabs>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

function TasksEditor({ scheduleId, canManage }: { scheduleId: string; canManage: boolean }) {
  const { data: tasks, isLoading } = usePmTasks(scheduleId);
  const addTask = useAddPmTask();
  const delTask = useDeletePmTask();
  const [newTitle, setNewTitle] = useState("");
  const [required, setRequired] = useState(true);

  if (isLoading) return <p className="text-sm text-muted-foreground py-3">Loading…</p>;

  return (
    <div className="space-y-2 py-2">
      {!tasks?.length && <p className="text-sm text-muted-foreground">No checklist items yet.</p>}
      {tasks?.map((t) => (
        <div key={t.id} className="flex items-center gap-2 p-2 rounded bg-muted/40">
          <Checkbox checked disabled />
          <span className="flex-1 text-sm">{t.title}</span>
          {t.required && <Badge variant="outline" className="text-[10px]">required</Badge>}
          {canManage && (
            <Button size="icon" variant="ghost" onClick={() => delTask.mutate({ id: t.id, schedule_id: scheduleId })}>
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          )}
        </div>
      ))}
      {canManage && (
        <div className="flex items-center gap-2 pt-2 border-t">
          <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Add checklist item…" className="flex-1" />
          <label className="flex items-center gap-1 text-xs">
            <Checkbox checked={required} onCheckedChange={(v) => setRequired(!!v)} /> Required
          </label>
          <Button
            size="sm"
            onClick={async () => {
              if (!newTitle.trim()) return;
              await addTask.mutateAsync({
                schedule_id: scheduleId, title: newTitle.trim(), required, sort_order: (tasks?.length || 0) + 1,
              });
              setNewTitle("");
            }}
          >Add</Button>
        </div>
      )}
    </div>
  );
}

function ExecutionsList({ scheduleId }: { scheduleId: string }) {
  const { data: execs, isLoading } = usePmExecutions(scheduleId);
  if (isLoading) return <p className="text-sm text-muted-foreground py-3">Loading…</p>;
  if (!execs?.length) return <p className="text-sm text-muted-foreground py-3">No executions yet.</p>;
  return (
    <div className="space-y-2 py-2">
      {execs.map((e) => (
        <div key={e.id} className="p-3 rounded border bg-muted/30 text-sm">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <span className="font-medium">{e.done_by_name || "—"}</span>
            <span className="text-xs text-muted-foreground font-mono">{format(new Date(e.done_at), "dd/MM/yyyy HH:mm")}</span>
          </div>
          {e.notes && <p className="text-xs text-muted-foreground mt-1">{e.notes}</p>}
          {Array.isArray(e.checklist_state) && e.checklist_state.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs">
              {e.checklist_state.map((c, i) => (
                <li key={i} className={cn("flex items-center gap-1", c.checked ? "text-emerald-600" : "text-muted-foreground")}>
                  {c.checked ? <CheckCircle2 className="h-3 w-3" /> : <span className="h-3 w-3 rounded-full border" />}
                  {c.title}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

function ExecuteDialog({ schedule, onClose }: { schedule: PmSchedule; onClose: () => void }) {
  const { data: tasks } = usePmTasks(schedule.id);
  const record = useRecordPmExecution();
  const { toast } = useToast();
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState("");

  const requiredOk = (tasks || []).every((t) => !t.required || checked[t.id]);

  const submit = async () => {
    if (!requiredOk) {
      toast({ title: "Required tasks pending", description: "Tick all required items first.", variant: "destructive" });
      return;
    }
    try {
      await record.mutateAsync({
        schedule_id: schedule.id,
        notes,
        checklist_state: (tasks || []).map((t) => ({ task_id: t.id, title: t.title, checked: !!checked[t.id] })),
      });
      toast({ title: "Maintenance recorded" });
      onClose();
    } catch (e: any) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Mark "{schedule.title}" done</DialogTitle>
          <DialogDescription>
            {schedule.machine} · resets next due to today + {schedule.interval_days} days.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 max-h-[60vh] overflow-y-auto">
          {(tasks || []).length > 0 && (
            <div className="space-y-1.5">
              <Label>Checklist</Label>
              {tasks!.map((t) => (
                <label key={t.id} className="flex items-center gap-2 p-2 rounded bg-muted/40 cursor-pointer">
                  <Checkbox checked={!!checked[t.id]} onCheckedChange={(v) => setChecked((c) => ({ ...c, [t.id]: !!v }))} />
                  <span className="flex-1 text-sm">{t.title}</span>
                  {t.required && <Badge variant="outline" className="text-[10px]">required</Badge>}
                </label>
              ))}
            </div>
          )}
          <div>
            <Label>Notes</Label>
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observations, parts replaced…" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={record.isPending}>
            {record.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
