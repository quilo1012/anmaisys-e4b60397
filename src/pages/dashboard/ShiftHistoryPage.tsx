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
import { Download, Lock, Unlock, Pencil, Trash2, Upload } from "lucide-react";
import { ImportProductionDialog } from "@/components/ImportProductionDialog";
import { toast } from "sonner";
import { format, subDays } from "date-fns";
import { useLines, useLeaders, useSkuProducts } from "@/hooks/useProductionPlanner";
import { useAuth } from "@/contexts/AuthContext";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, ReferenceLine, CartesianGrid } from "recharts";

/**
 * Extract package weight from SKU code/name (e.g. "1kg", "500g", "2.5 KG", "750ml", "1L").
 * Returns weight in grams (or ml). Falls back to the stored sku.weight if no pattern matched.
 */
function parseWeightFromSku(code: string, name: string, fallback: number | null): number {
  const blob = `${code} ${name}`.toLowerCase();
  const m = blob.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l|lb|oz)\b/);
  if (m) {
    const n = parseFloat(m[1].replace(",", "."));
    const u = m[2];
    if (!isNaN(n)) {
      if (u === "kg") return Math.round(n * 1000);
      if (u === "l")  return Math.round(n * 1000);
      if (u === "lb") return Math.round(n * 453.592);
      if (u === "oz") return Math.round(n * 28.3495);
      return Math.round(n); // g, ml
    }
  }
  return Number(fallback ?? 0);
}

interface SessionRow {
  id: string; session_date: string; shift: string; line: string;
  leader_id: string | null; leader_name: string | null;
  staff_planned: number | null; staff_actual: number | null;
  locked: boolean; notes: string | null;
  production_items: { id: string; sku_id: string; target_qty: number | null; planned_qty: number | null; actual_qty: number | null; notes: string | null; blender_ref: string | null }[];
}

export default function ShiftHistoryPage() {
  const qc = useQueryClient();
  const { role } = useAuth();
  const isAdmin = role === "admin" || role === "manager" || role === "maintenance_manager";
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
  
  const [editing, setEditing] = useState<SessionRow | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<{ id: string; sku_id: string; code: string; target: number; actual: number; notes: string | null } | null>(null);
  const [editActual, setEditActual] = useState<string>("");
  const [editUnit, setEditUnit] = useState<"tubs" | "bags">("tubs");
  const [editSkuId, setEditSkuId] = useState<string>("");
  const [importOpen, setImportOpen] = useState(false);


  const { data: sessions = [] } = useQuery({
    queryKey: ["shift_history", from, to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production_sessions")
        .select("id, session_date, shift, line, leader_id, leader_name, staff_planned, staff_actual, locked, notes, production_items(id, sku_id, target_qty, planned_qty, actual_qty, notes, blender_ref)")
        .gte("session_date", from).lte("session_date", to)
        .order("session_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as SessionRow[];
    },
  });

  const lineRank = (name: string) => {
    const n = (name ?? "").toLowerCase().trim();
    const m = n.match(/line\s*(\d+)/);
    if (m) return parseInt(m[1], 10);
    if (n.includes("capsule")) return 100;
    return 200;
  };
  const sortedLines = useMemo(
    () => [...lines].sort((a, b) => lineRank(a.name) - lineRank(b.name) || a.name.localeCompare(b.name)),
    [lines]
  );
  const filtered = useMemo(() => sessions.filter((s) =>
    (fLine === "__all__" || s.line === fLine) &&
    (fShift === "__all__" || s.shift === fShift) &&
    (fLeader === "__all__" || s.leader_name === fLeader) &&
    (fSku === "__all__" || s.production_items.some((i) => i.sku_id === fSku))
  ).sort((a, b) => {
    if (a.session_date !== b.session_date) return a.session_date < b.session_date ? 1 : -1;
    const lr = lineRank(a.line) - lineRank(b.line);
    if (lr !== 0) return lr;
    return (a.line ?? "").localeCompare(b.line ?? "");
  }), [sessions, fLine, fShift, fLeader, fSku]);

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

  const delItemMut = useMutation({
    mutationFn: async (itemId: string) => {
      const { error } = await supabase.from("production_items").delete().eq("id", itemId);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["shift_history"] }); toast.success("SKU removed"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveItemActual = useMutation({
    mutationFn: async ({ id, actual, unit, prevNotes, sku_id }: { id: string; actual: number; unit: "tubs" | "bags"; prevNotes: string | null; sku_id?: string }) => {
      const stripped = (prevNotes ?? "").replace(/\[unit:(tubs|bags)\]\s*/gi, "").trim();
      const newNotes = `[unit:${unit}]${stripped ? " " + stripped : ""}`;
      const payload: { actual_qty: number; notes: string; sku_id?: string } = { actual_qty: actual, notes: newNotes };
      if (sku_id) payload.sku_id = sku_id;
      const { error } = await supabase.from("production_items").update(payload).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["shift_history"] }); setEditingItem(null); toast.success("Saved"); },
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
          <h1 className="text-2xl font-bold">Production Control</h1>
          <div className="flex items-center gap-2 flex-wrap">
            {isAdmin && (
              <Button variant="outline" size="sm" onClick={async () => {
                const XLSX = await import("xlsx");
                const headers = ["Date","Assembly Number","Work Centre","Product Code","Product Description","Weight","QTY","Start Time","Finish Time","Shift"];
                const sample = [
                  ["25/06/2026","ASM-0001","Line 1","SKU-001","Sample Product A","0.500","1200","06:00","14:00","DAY"],
                  ["25/06/2026","ASM-0002","Line 2","SKU-002","Sample Product B","0.750","850","18:00","02:00","NIGHT"],
                ];
                const ws = XLSX.utils.aoa_to_sheet([headers, ...sample]);
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, "Template");
                XLSX.writeFile(wb, `production-template-${format(new Date(), "yyyy-MM-dd")}.xlsx`);
              }}>
                <Download className="h-4 w-4 mr-1" />Export Template
              </Button>
            )}
            {isAdmin && (
              <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
                <Upload className="h-4 w-4 mr-1" />Import Production
              </Button>
            )}
            <Button variant="outline" onClick={exportCSV}><Download className="h-4 w-4 mr-1" />Export CSV</Button>
          </div>
        </div>

        <ImportProductionDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          onImported={() => qc.invalidateQueries({ queryKey: ["shift_history"] })}
        />


        <Card>
          <CardContent className="p-4 grid gap-3 md:grid-cols-6">
            <div className="md:col-span-1">
              <Label className="text-xs">Date (single)</Label>
              <Input
                type="date"
                value={from === to ? from : ""}
                onChange={(e) => { setFrom(e.target.value); setTo(e.target.value); }}
              />
            </div>
            <div><Label className="text-xs">From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div><Label className="text-xs">To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
            <div><Label className="text-xs">Shift</Label>
              <Select value={fShift} onValueChange={setFShift}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="__all__">All shifts</SelectItem><SelectItem value="DAY">Day</SelectItem><SelectItem value="NIGHT">Night</SelectItem></SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Filler Line</Label>
              <Select value={fLine} onValueChange={setFLine}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="__all__">All lines</SelectItem>{sortedLines.map((l) => <SelectItem key={l.id} value={l.name}>{l.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Leader</Label>
              <Select value={fLeader} onValueChange={setFLeader}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="__all__">All leaders</SelectItem>{leaders.map((l) => <SelectItem key={l.id} value={l.name}>{l.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="md:col-span-5"><Label className="text-xs">SKU</Label>
              <Select value={fSku} onValueChange={setFSku}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="__all__">All SKUs</SelectItem>{skus.map((s) => <SelectItem key={s.id} value={s.id}>{s.code} — {s.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-2">
              <Button variant="outline" size="sm" className="w-full" onClick={() => {
                const t = format(new Date(), "yyyy-MM-dd"); setFrom(t); setTo(t); setFShift("__all__"); setFLine("__all__"); setFLeader("__all__"); setFSku("__all__");
              }}>Today</Button>
              <Button variant="ghost" size="sm" className="w-full" onClick={() => {
                setFrom(format(subDays(new Date(), 14), "yyyy-MM-dd")); setTo(format(new Date(), "yyyy-MM-dd")); setFShift("__all__"); setFLine("__all__"); setFLeader("__all__"); setFSku("__all__");
              }}>Reset</Button>
            </div>
          </CardContent>
        </Card>



        <Card>
          <CardContent className="p-0 overflow-x-auto">
            {filtered.length === 0 ? (
              <div className="p-6 text-muted-foreground text-center">No sessions</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase">
                  <tr>
                    <th className="text-left p-2">Date</th>
                    <th className="text-left p-2">Shift</th>
                    <th className="text-left p-2">Filler Line</th>
                    <th className="text-left p-2">SKU</th>
                    <th className="text-left p-2">Product Description</th>
                    <th className="text-left p-2">Batch</th>
                    <th className="text-right p-2">Weight</th>
                    <th className="text-right p-2">Bag</th>
                    <th className="text-right p-2">Tubs</th>
                    <th className="text-right p-2 w-32">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filtered.flatMap((s) =>
                    (s.production_items.length === 0
                      ? [{ id: `${s.id}-empty`, sku_id: "", target_qty: 0, planned_qty: 0, actual_qty: 0, notes: null, blender_ref: null }]
                      : s.production_items
                    ).map((i, idx) => {
                      const sku = skuMap.get(i.sku_id);
                      const code = sku?.code ?? "";
                      const name = sku?.name ?? (i.sku_id ? "Unknown" : "—");
                      const weight = parseWeightFromSku(code, name, (sku as { weight?: number | null } | undefined)?.weight ?? null);
                      const a = Number(i.actual_qty ?? 0);
                      const t = Number(i.target_qty ?? i.planned_qty ?? 0);
                      const blob = `${code} ${name}`.toLowerCase();
                      const isTub = /tub/.test(blob);
                      const isBag = /bag|sach|pouch/.test(blob);
                      const noteUnit = /\[unit:tubs\]/i.test(i.notes ?? "") ? "tubs" : /\[unit:bags\]/i.test(i.notes ?? "") ? "bags" : null;
                      const effIsTub = noteUnit ? noteUnit === "tubs" : isTub;
                      const effIsBag = noteUnit ? noteUnit === "bags" : isBag;
                      const bag = effIsBag ? a : 0;
                      const tubs = effIsTub ? a : 0;
                      return (
                        <tr key={`${s.id}-${i.id ?? idx}`} className="hover:bg-muted/20">
                          <td className="p-2 whitespace-nowrap">{s.session_date}</td>
                          <td className="p-2"><Badge variant="outline">{s.shift}</Badge></td>
                          <td className="p-2 whitespace-nowrap">{s.line}</td>
                          <td className="p-2 font-mono text-xs">{code || "—"}</td>
                          <td className="p-2">{name}</td>
                          <td className="p-2">
                            {i.sku_id && !s.locked ? (
                              <input
                                type="text"
                                defaultValue={i.blender_ref ?? ""}
                                placeholder="B#"
                                className="w-16 h-7 px-1 text-xs font-mono rounded border bg-background"
                                onBlur={async (e) => {
                                  const v = e.target.value.trim() || null;
                                  if (v === (i.blender_ref ?? null)) return;
                                  const { error } = await supabase.from("production_items").update({ blender_ref: v }).eq("id", i.id);
                                  if (error) toast.error(error.message);
                                  else { toast.success("Batch saved"); qc.invalidateQueries({ queryKey: ["shift_history"] }); }
                                }}
                              />
                            ) : (
                              <span className="text-xs font-mono">{i.blender_ref || "—"}</span>
                            )}
                          </td>
                          <td className="p-2 text-right tabular-nums">{weight ? weight.toLocaleString() : "—"}</td>
                          <td className="p-2 text-right tabular-nums">{bag ? bag.toLocaleString() : "—"}</td>
                          <td className="p-2 text-right tabular-nums">{tubs ? tubs.toLocaleString() : "—"}</td>
                          <td className="p-2">
                            <div className="flex items-center justify-end gap-1">
                              {!s.locked && i.id && i.sku_id && (
                                <Button size="icon" variant="ghost" title="Edit actual" onClick={() => { setEditingItem({ id: i.id, sku_id: i.sku_id, code, target: t, actual: a, notes: i.notes }); setEditActual(String(a)); setEditUnit(noteUnit ?? (isBag && !isTub ? "bags" : "tubs")); setEditSkuId(i.sku_id); }}>
                                  <Pencil className="h-4 w-4" />
                                </Button>
                              )}
                              <Button size="icon" variant="ghost" title="Edit session" onClick={() => setEditing(s)}>
                                <Pencil className="h-4 w-4 opacity-60" />
                              </Button>
                              <Button size="icon" variant="ghost" title="Lock/unlock" onClick={() => lockMut.mutate({ id: s.id, lock: !s.locked })}>
                                {s.locked ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                              </Button>
                              <Button size="icon" variant="ghost" title="Delete session" onClick={() => setDeleting(s.id)}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Edit session</DialogTitle></DialogHeader>
            {editing && (
              <div className="space-y-3">
                <div><Label>Leader</Label>
                  <Input
                    list="leader-options"
                    placeholder="Type or pick a leader"
                    value={editing.leader_name ?? ""}
                    onChange={(e) => {
                      const name = e.target.value;
                      const match = leaders.find((x) => x.name.toLowerCase() === name.toLowerCase());
                      setEditing({ ...editing, leader_name: name || null, leader_id: match?.id ?? null });
                    }}
                  />
                  <datalist id="leader-options">
                    {leaders.map((l) => <option key={l.id} value={l.name} />)}
                  </datalist>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div><Label>Staff planned</Label><Input type="number" placeholder="" value={editing.staff_planned == null || editing.staff_planned === 0 ? "" : editing.staff_planned} onChange={(e) => setEditing({ ...editing, staff_planned: e.target.value === "" ? null : +e.target.value })} /></div>
                  <div><Label>Staff actual</Label><Input type="number" placeholder="" value={editing.staff_actual == null || editing.staff_actual === 0 ? "" : editing.staff_actual} onChange={(e) => setEditing({ ...editing, staff_actual: e.target.value === "" ? null : +e.target.value })} /></div>
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

        <Dialog open={!!editingItem} onOpenChange={(o) => !o && setEditingItem(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Edit actual — {editingItem?.code}</DialogTitle></DialogHeader>
            {editingItem && (
              <div className="space-y-3">
                <div className="text-sm text-muted-foreground">Target: <span className="font-semibold text-foreground">{editingItem.target.toLocaleString()}</span></div>
                {isAdmin && (
                  <div>
                    <Label>SKU</Label>
                    <Select value={editSkuId} onValueChange={setEditSkuId}>
                      <SelectTrigger><SelectValue placeholder="Pick a SKU" /></SelectTrigger>
                      <SelectContent className="max-h-72">
                        {skus.map((s) => (
                          <SelectItem key={s.id} value={s.id}>{s.code} — {s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div>
                  <Label>Unit type</Label>
                  <Select value={editUnit} onValueChange={(v) => setEditUnit(v as "tubs" | "bags")}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="tubs">Tubs</SelectItem>
                      <SelectItem value="bags">Bags</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Actual quantity ({editUnit})</Label>
                  <Input type="number" value={editActual} onChange={(e) => setEditActual(e.target.value)} autoFocus />
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditingItem(null)}>Cancel</Button>
              <Button
                onClick={() => editingItem && saveItemActual.mutate({ id: editingItem.id, actual: Number(editActual) || 0, unit: editUnit, prevNotes: editingItem.notes, sku_id: isAdmin && editSkuId && editSkuId !== editingItem.sku_id ? editSkuId : undefined })}
                disabled={saveItemActual.isPending}
              >Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      </div>
    </DashboardLayout>
  );
}
