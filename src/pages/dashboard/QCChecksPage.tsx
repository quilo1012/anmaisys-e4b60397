import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Loader2, CheckCircle2, XCircle, MinusCircle } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { format, subDays } from "date-fns";
import { cn } from "@/lib/utils";
import { useRole } from "@/hooks/useRole";

const QC_CHECKPOINTS = [
  { key: "weight", label: "Weight", numeric: true, unit: "g" },
  { key: "temperature", label: "Temperature", numeric: true, unit: "°C" },
  { key: "metal_detector", label: "Metal detector", numeric: false, unit: "" },
  { key: "sealing", label: "Sealing", numeric: false, unit: "" },
  { key: "labelling", label: "Labelling", numeric: false, unit: "" },
  { key: "samples", label: "Samples taken", numeric: false, unit: "" },
] as const;

const RELEASE_OPTS = [
  { value: "pending", label: "Pending", badge: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/40" },
  { value: "released", label: "Released", badge: "bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/40" },
  { value: "hold", label: "On hold", badge: "bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/40" },
  { value: "rejected", label: "Rejected", badge: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/40" },
];
function releaseMeta(v: string) { return RELEASE_OPTS.find((r) => r.value === v) ?? RELEASE_OPTS[0]; }

interface CheckResult { result?: string; value?: number | null; note?: string }
interface QcInspection {
  id: string; line: string | null; batch_code: string | null; shift: string | null;
  inspected_on: string; inspector_name: string | null; checks: Record<string, CheckResult>;
  release: string; notes: string | null; status: string;
}

interface QcForm {
  id?: string; inspected_on: string; line: string; batch_code: string; shift: string;
  inspector_name: string; checks: Record<string, { result?: string; value?: string; note?: string }>;
  release: string; notes: string; status: string;
}
function blankForm(): QcForm {
  return { inspected_on: format(new Date(), "yyyy-MM-dd"), line: "", batch_code: "", shift: "DAY", inspector_name: "", checks: {}, release: "pending", notes: "", status: "draft" };
}
function toForm(i: QcInspection): QcForm {
  const checks: QcForm["checks"] = {};
  for (const c of QC_CHECKPOINTS) {
    const r = i.checks?.[c.key];
    if (r) checks[c.key] = { result: r.result, value: r.value == null ? "" : String(r.value), note: r.note };
  }
  return {
    id: i.id, inspected_on: i.inspected_on, line: i.line ?? "", batch_code: i.batch_code ?? "", shift: i.shift ?? "DAY",
    inspector_name: i.inspector_name ?? "", checks, release: i.release ?? "pending", notes: i.notes ?? "", status: i.status ?? "draft",
  };
}

function tally(checks: Record<string, CheckResult>) {
  let pass = 0, fail = 0;
  for (const c of QC_CHECKPOINTS) {
    const r = checks?.[c.key]?.result;
    if (r === "pass") pass++;
    else if (r === "fail") fail++;
  }
  return { pass, fail };
}

export function QCChecksView() {
  const { user } = useAuth();
  const { can } = useRole();
  const canManage = can("quality.manage");
  const qc = useQueryClient();

  const [days, setDays] = useState("30");
  const [filterLine, setFilterLine] = useState("__all__");
  const [filterRelease, setFilterRelease] = useState("__all__");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<QcForm>(() => blankForm());

  const from = useMemo(() => format(subDays(new Date(), Number(days)), "yyyy-MM-dd"), [days]);

  const { data: lines = [] } = useQuery({
    queryKey: ["lines"],
    queryFn: async () => {
      const { data } = await supabase.from("lines").select("name").order("name");
      return (data ?? []) as { name: string }[];
    },
  });
  const { data: inspections = [] } = useQuery({
    queryKey: ["qc_inspections", from],
    queryFn: async () => {
      const { data, error } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not in generated types yet
        .from("qc_inspections" as any)
        .select("*")
        .gte("inspected_on", from)
        .order("inspected_on", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as QcInspection[];
    },
  });

  const filtered = useMemo(() =>
    inspections.filter((i) =>
      (filterLine === "__all__" || i.line === filterLine) &&
      (filterRelease === "__all__" || i.release === filterRelease)),
    [inspections, filterLine, filterRelease]
  );

  const kpis = useMemo(() => ({
    total: filtered.length,
    released: filtered.filter((i) => i.release === "released").length,
    hold: filtered.filter((i) => i.release === "hold").length,
    rejected: filtered.filter((i) => i.release === "rejected").length,
  }), [filtered]);

  const newInspection = () => { setForm(blankForm()); setOpen(true); };
  const editInspection = (i: QcInspection) => { setForm(toForm(i)); setOpen(true); };

  const setCheck = (key: string, patch: Partial<{ result: string; value: string; note: string }>) =>
    setForm((f) => ({ ...f, checks: { ...f.checks, [key]: { ...f.checks[key], ...patch } } }));

  const save = useMutation({
    mutationFn: async () => {
      const checks: Record<string, CheckResult> = {};
      for (const c of QC_CHECKPOINTS) {
        const r = form.checks[c.key];
        if (!r || (!r.result && !r.value && !r.note)) continue;
        checks[c.key] = {
          result: r.result || undefined,
          value: c.numeric && r.value !== undefined && r.value !== "" ? Number(r.value) : null,
          note: r.note || undefined,
        };
      }
      const payload = {
        inspected_on: form.inspected_on,
        line: form.line || null,
        batch_code: form.batch_code || null,
        shift: form.shift || null,
        inspector_name: form.inspector_name || null,
        checks,
        release: form.release,
        notes: form.notes || null,
        status: form.status,
      };
      if (form.id) {
        const { error } = await supabase
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not in generated types yet
          .from("qc_inspections" as any)
          .update(payload as unknown as never)
          .eq("id", form.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not in generated types yet
          .from("qc_inspections" as any)
          .insert({ ...payload, created_by: user?.id ?? null } as unknown as never);
        if (error) throw error;
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["qc_inspections"] }); setOpen(false); toast.success("Inspection saved"); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        {canManage && <Button onClick={newInspection}><Plus className="mr-1 h-4 w-4" />New inspection</Button>}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Inspections</div><div className="text-2xl font-bold">{kpis.total}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Released</div><div className="text-2xl font-bold text-green-600 dark:text-green-400">{kpis.released}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">On hold</div><div className="text-2xl font-bold text-orange-600 dark:text-orange-400">{kpis.hold}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Rejected</div><div className="text-2xl font-bold text-red-600 dark:text-red-400">{kpis.rejected}</div></CardContent></Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="7">7 days</SelectItem><SelectItem value="30">30 days</SelectItem><SelectItem value="90">90 days</SelectItem></SelectContent>
        </Select>
        <Select value={filterLine} onValueChange={setFilterLine}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="__all__">All lines</SelectItem>{lines.map((l) => <SelectItem key={l.name} value={l.name}>{l.name}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={filterRelease} onValueChange={setFilterRelease}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="__all__">All release</SelectItem>{RELEASE_OPTS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader><CardTitle>Inspections ({filtered.length})</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Date</TableHead><TableHead>Line</TableHead><TableHead>Batch code</TableHead>
              <TableHead>Shift</TableHead><TableHead>Inspector</TableHead><TableHead>Checks</TableHead>
              <TableHead>Release</TableHead><TableHead>Status</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {filtered.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">No inspections</TableCell></TableRow>}
              {filtered.map((i) => {
                const t = tally(i.checks);
                const rel = releaseMeta(i.release);
                return (
                  <TableRow key={i.id} className={cn(canManage && "cursor-pointer")} onClick={() => canManage && editInspection(i)}>
                    <TableCell className="whitespace-nowrap">{format(new Date(i.inspected_on + "T00:00:00"), "dd/MM/yyyy")}</TableCell>
                    <TableCell>{i.line ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{i.batch_code ?? "—"}</TableCell>
                    <TableCell>{i.shift ?? "—"}</TableCell>
                    <TableCell>{i.inspector_name ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      <span className="text-green-600 dark:text-green-400">{t.pass} pass</span>
                      {t.fail > 0 && <span className="text-red-600 dark:text-red-400"> · {t.fail} fail</span>}
                    </TableCell>
                    <TableCell><Badge variant="outline" className={cn("text-[10px]", rel.badge)}>{rel.label}</Badge></TableCell>
                    <TableCell className="text-xs capitalize text-muted-foreground">{i.status}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader><DialogTitle>{form.id ? "Edit inspection" : "New QC inspection"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Date</Label><Input type="date" value={form.inspected_on} onChange={(e) => setForm({ ...form, inspected_on: e.target.value })} /></div>
              <div><Label>Line</Label>
                <Select value={form.line || "__none__"} onValueChange={(v) => setForm({ ...form, line: v === "__none__" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="Pick line" /></SelectTrigger>
                  <SelectContent><SelectItem value="__none__">—</SelectItem>{lines.map((l) => <SelectItem key={l.name} value={l.name}>{l.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Batch code</Label><Input value={form.batch_code} onChange={(e) => setForm({ ...form, batch_code: e.target.value })} /></div>
              <div><Label>Shift</Label>
                <Select value={form.shift} onValueChange={(v) => setForm({ ...form, shift: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="DAY">Day</SelectItem><SelectItem value="NIGHT">Night</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>Inspector</Label><Input value={form.inspector_name} onChange={(e) => setForm({ ...form, inspector_name: e.target.value })} /></div>

            {/* Checkpoints */}
            <div>
              <Label>Checkpoints</Label>
              <div className="mt-1 space-y-2 rounded border p-2">
                {QC_CHECKPOINTS.map((c) => {
                  const cur = form.checks[c.key] ?? {};
                  return (
                    <div key={c.key} className="grid grid-cols-12 items-center gap-2">
                      <span className="col-span-4 text-sm">{c.label}{c.unit ? <span className="text-muted-foreground"> ({c.unit})</span> : null}</span>
                      {c.numeric ? (
                        <Input type="number" className="col-span-3 h-8" placeholder="value" value={cur.value ?? ""} onChange={(e) => setCheck(c.key, { value: e.target.value })} />
                      ) : <span className="col-span-3" />}
                      <div className="col-span-5 flex gap-1">
                        {(["pass", "fail", "na"] as const).map((r) => {
                          const on = cur.result === r;
                          const style = r === "pass" ? "border-green-500 bg-green-500/15 text-green-600" : r === "fail" ? "border-red-500 bg-red-500/15 text-red-600" : "border-slate-400 bg-slate-400/15 text-slate-500";
                          return (
                            <button key={r} type="button" onClick={() => setCheck(c.key, { result: on ? "" : r })}
                              className={cn("inline-flex items-center gap-1 rounded border px-2 py-1 text-xs transition-colors", on ? style : "text-muted-foreground hover:bg-accent")}>
                              {r === "pass" ? <CheckCircle2 className="h-3.5 w-3.5" /> : r === "fail" ? <XCircle className="h-3.5 w-3.5" /> : <MinusCircle className="h-3.5 w-3.5" />}
                              {r === "na" ? "N/A" : r === "pass" ? "Pass" : "Fail"}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div><Label>Release decision</Label>
                <Select value={form.release} onValueChange={(v) => setForm({ ...form, release: v })}>
                  <SelectTrigger className={cn("border", releaseMeta(form.release).badge)}><SelectValue /></SelectTrigger>
                  <SelectContent>{RELEASE_OPTS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="draft">Draft</SelectItem><SelectItem value="complete">Complete</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>Notes</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          <DialogFooter><Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
