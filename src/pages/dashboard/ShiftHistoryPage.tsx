import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { ChevronDown, ChevronRight, Download, Lock, Unlock, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { format, subDays } from "date-fns";
import { useLines, useLeaders, useSkuProducts } from "@/hooks/useProductionPlanner";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, ReferenceLine, CartesianGrid } from "recharts";

interface SessionRow {
  id: string; session_date: string; shift: string; line: string;
  leader_id: string | null; leader_name: string | null;
  staff_planned: number | null; staff_actual: number | null;
  locked: boolean; notes: string | null;
  production_items: { sku_id: string; target_qty: number | null; planned_qty: number | null; actual_qty: number | null; notes: string | null }[];
}

export default function ShiftHistoryPage() {
  const qc = useQueryClient();
  const { data: lines = [] } = useLines();
  const { data: leaders = [] } = useLeaders();
  const { data: skus = [] } = useSkuProducts(false);
  const skuMap = useMemo(() => new Map(skus.map((s) => [s.id, s])), [skus]);

  const [from, setFrom] = useState(format(subDays(new Date(), 14), "yyyy-MM-dd"));
  const [to, setTo] = useState(format(new Date(), "yyyy-MM-dd"));
  const [fLine, setFLine] = useState("__all__");
  const [fShift, setFShift] = useState("__all__");
  const [fLeader, setFLeader] = useState("__all__");
  const [fSku, setFSku] = useState("__all__");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<SessionRow | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const { data: sessions = [] } = useQuery({
    queryKey: ["shift_history", from, to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production_sessions")
        .select("id, session_date, shift, line, leader_id, leader_name, staff_planned, staff_actual, locked, notes, production_items(sku_id, target_qty, planned_qty, actual_qty, notes)")
        .gte("session_date", from).lte("session_date", to)
        .order("session_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as SessionRow[];
    },
  });

  const filtered = useMemo(() => sessions.filter((s) =>
    (fLine === "__all__" || s.line === fLine) &&
    (fShift === "__all__" || s.shift === fShift) &&
    (fLeader === "__all__" || s.leader_name === fLeader) &&
    (fSku === "__all__" || s.production_items.some((i) => i.sku_id === fSku))
  ), [sessions, fLine, fShift, fLeader, fSku]);

  const trendData = useMemo(() => {
    const byDate = new Map<string, { date: string; DAY: number[]; NIGHT: number[] }>();
    for (const s of filtered) {
      const target = s.production_items.reduce((a, i) => a + Number(i.target_qty ?? i.planned_qty ?? 0), 0);
      const actual = s.production_items.reduce((a, i) => a + Number(i.actual_qty ?? 0), 0);
      if (target <= 0) continue;
      const eff = (actual / target) * 100;
      const row = byDate.get(s.session_date) ?? { date: s.session_date, DAY: [], NIGHT: [] };
      if (s.shift === "DAY") row.DAY.push(eff);
      else if (s.shift === "NIGHT") row.NIGHT.push(eff);
      byDate.set(s.session_date, row);
    }
    return Array.from(byDate.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((r) => ({
        date: r.date,
        DAY: r.DAY.length ? +(r.DAY.reduce((a, b) => a + b, 0) / r.DAY.length).toFixed(1) : null,
        NIGHT: r.NIGHT.length ? +(r.NIGHT.reduce((a, b) => a + b, 0) / r.NIGHT.length).toFixed(1) : null,
      }));
  }, [filtered]);

  const toggle = (id: string) => {
    const n = new Set(expanded);
    n.has(id) ? n.delete(id) : n.add(id);
    setExpanded(n);
  };

  const lockMut = useMutation({
    mutationFn: async ({ id, lock }: { id: string; lock: boolean }) => {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from("production_sessions")
        .update({ locked: lock, locked_at: lock ? new Date().toISOString() : null, locked_by: lock ? u.user?.id ?? null : null })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["shift_history"] }); toast.success("Updated"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("production_sessions").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["shift_history"] }); setDeleting(null); toast.success("Deleted"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveEdit = useMutation({
    mutationFn: async (s: SessionRow) => {
      const { error } = await supabase.from("production_sessions").update({
        leader_id: s.leader_id, leader_name: s.leader_name,
        staff_planned: s.staff_planned, staff_actual: s.staff_actual,
        notes: s.notes,
      }).eq("id", s.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["shift_history"] }); setEditing(null); toast.success("Saved"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const exportCSV = () => {
    const rows = [["Date", "Shift", "Line", "Leader", "Staff", "SKU", "Target", "Actual", "Eff%", "Notes"]];
    for (const s of filtered) {
      if (s.production_items.length === 0) {
        rows.push([s.session_date, s.shift, s.line, s.leader_name ?? "", String(s.staff_actual ?? ""), "", "", "", "", s.notes ?? ""]);
      } else {
        for (const i of s.production_items) {
          const sku = skuMap.get(i.sku_id);
          const t = Number(i.target_qty ?? i.planned_qty ?? 0);
          const a = Number(i.actual_qty ?? 0);
          rows.push([s.session_date, s.shift, s.line, s.leader_name ?? "", String(s.staff_actual ?? ""), sku?.code ?? "", String(t), String(a), t > 0 ? ((a / t) * 100).toFixed(0) : "0", s.notes ?? ""]);
        }
      }
    }
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `shift-history-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-2xl font-bold">Shift History</h1>
          <Button variant="outline" onClick={exportCSV}><Download className="h-4 w-4 mr-1" />Export CSV</Button>
        </div>

        <Card>
          <CardContent className="p-4 grid gap-3 md:grid-cols-6">
            <div><Label className="text-xs">From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div><Label className="text-xs">To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
            <div><Label className="text-xs">Line</Label>
              <Select value={fLine} onValueChange={setFLine}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="__all__">All</SelectItem>{lines.map((l) => <SelectItem key={l.id} value={l.name}>{l.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Shift</Label>
              <Select value={fShift} onValueChange={setFShift}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="__all__">All</SelectItem><SelectItem value="DAY">Day</SelectItem><SelectItem value="NIGHT">Night</SelectItem></SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Leader</Label>
              <Select value={fLeader} onValueChange={setFLeader}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="__all__">All</SelectItem>{leaders.map((l) => <SelectItem key={l.id} value={l.name}>{l.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">SKU</Label>
              <Select value={fSku} onValueChange={setFSku}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="__all__">All</SelectItem>{skus.map((s) => <SelectItem key={s.id} value={s.id}>{s.code} — {s.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {trendData.length >= 2 && (
          <Card>
            <CardHeader className="py-3"><CardTitle className="text-sm">Performance trend — DAY vs NIGHT</CardTitle></CardHeader>
            <CardContent className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} domain={[0, (dataMax: number) => Math.max(120, dataMax)]} unit="%" />
                  <Tooltip formatter={(v: number) => `${v}%`} />
                  <Legend />
                  <ReferenceLine y={100} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" />
                  <Line type="monotone" dataKey="DAY" stroke="#3b82f6" strokeWidth={2} connectNulls />
                  <Line type="monotone" dataKey="NIGHT" stroke="#a855f7" strokeWidth={2} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        <div className="space-y-2">
          {filtered.length === 0 && <Card><CardContent className="p-6 text-muted-foreground text-center">No sessions</CardContent></Card>}
          {filtered.map((s) => {
            const target = s.production_items.reduce((a, i) => a + Number(i.target_qty ?? i.planned_qty ?? 0), 0);
            const actual = s.production_items.reduce((a, i) => a + Number(i.actual_qty ?? 0), 0);
            const eff = target > 0 ? (actual / target) * 100 : 0;
            const isOpen = expanded.has(s.id);
            return (
              <Card key={s.id}>
                <CardHeader className="cursor-pointer py-3" onClick={() => toggle(s.id)}>
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      <span className="font-semibold">{s.session_date}</span>
                      <Badge variant="outline">{s.shift}</Badge>
                      <Badge>{s.line}</Badge>
                      <span className="text-sm text-muted-foreground">{s.leader_name ?? "—"}</span>
                      {s.locked && <Badge variant="secondary"><Lock className="h-3 w-3 mr-1" />Locked</Badge>}
                    </div>
                    <div className="flex items-center gap-3 text-sm">
                      <span className="text-muted-foreground">{actual} / {target}</span>
                      <span className={`font-bold ${eff >= 100 ? "text-green-500" : eff >= 80 ? "text-amber-500" : "text-red-500"}`}>{eff.toFixed(0)}%</span>
                      <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setEditing(s); }}><Pencil className="h-3 w-3" /></Button>
                      <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); lockMut.mutate({ id: s.id, lock: !s.locked }); }}>
                        {s.locked ? <Unlock className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setDeleting(s.id); }}><Trash2 className="h-3 w-3 text-destructive" /></Button>
                    </div>
                  </div>
                </CardHeader>
                {isOpen && (
                  <CardContent className="pt-0">
                    {s.notes && <p className="text-sm text-muted-foreground mb-3 italic">"{s.notes}"</p>}
                    {s.production_items.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No SKUs recorded</p>
                    ) : (
                      <div className="border rounded-md divide-y">
                        {s.production_items.map((i, idx) => {
                          const sku = skuMap.get(i.sku_id);
                          const t = Number(i.target_qty ?? i.planned_qty ?? 0);
                          const a = Number(i.actual_qty ?? 0);
                          const e = t > 0 ? (a / t) * 100 : 0;
                          return (
                            <div key={idx} className="flex items-center justify-between p-2 text-sm">
                              <div>
                                <span className="font-mono text-xs mr-2">{sku?.code ?? "?"}</span>
                                <span>{sku?.name ?? "Unknown"}</span>
                              </div>
                              <div className="flex items-center gap-4">
                                <span className="text-muted-foreground">{a} / {t}</span>
                                <span className={`font-semibold w-12 text-right ${e >= 100 ? "text-green-500" : e >= 80 ? "text-amber-500" : "text-red-500"}`}>{e.toFixed(0)}%</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>

        <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Edit session</DialogTitle></DialogHeader>
            {editing && (
              <div className="space-y-3">
                <div><Label>Leader</Label>
                  <Select value={editing.leader_id ?? ""} onValueChange={(v) => {
                    const l = leaders.find((x) => x.id === v);
                    setEditing({ ...editing, leader_id: v, leader_name: l?.name ?? null });
                  }}>
                    <SelectTrigger><SelectValue placeholder="Pick leader" /></SelectTrigger>
                    <SelectContent>{leaders.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div><Label>Staff planned</Label><Input type="number" value={editing.staff_planned ?? ""} onChange={(e) => setEditing({ ...editing, staff_planned: e.target.value ? +e.target.value : null })} /></div>
                  <div><Label>Staff actual</Label><Input type="number" value={editing.staff_actual ?? ""} onChange={(e) => setEditing({ ...editing, staff_actual: e.target.value ? +e.target.value : null })} /></div>
                </div>
                <div><Label>Notes</Label><Textarea value={editing.notes ?? ""} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} /></div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              <Button onClick={() => editing && saveEdit.mutate(editing)} disabled={saveEdit.isPending}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete session?</AlertDialogTitle>
              <AlertDialogDescription>This permanently removes the session and all its SKU records.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => deleting && delMut.mutate(deleting)} className="bg-destructive">Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </DashboardLayout>
  );
}
