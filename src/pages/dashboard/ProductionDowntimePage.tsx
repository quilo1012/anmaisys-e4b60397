import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, Download, Trash2, Clock, TrendingDown, Factory } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { formatMinutes } from "@/lib/formatDuration";
import { isNoPlannedShift } from "@/lib/downtimeBuckets";
function exportRowsAsCsv(filename: string, rows: Record<string, string | number>[]) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const escape = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.join(","), ...rows.map((r) => headers.map((h) => escape(r[h])).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

const CATEGORIES = [
  "Changeover",
  "Machine Fault",
  "Material Shortage",
  "Quality Issue",
  "Waiting",
  "Cleaning",
  "Meeting",
  "Break",
  "Other",
] as const;

interface PDRow {
  id: string;
  occurred_date: string;
  shift: "DAY" | "NIGHT";
  line: string;
  category: string;
  reason: string | null;
  duration_minutes: number;
  leader_name: string | null;
  notes: string | null;
  created_at: string;
}

export default function ProductionDowntimePage() {
  const qc = useQueryClient();
  const { role } = useAuth();
  const canDelete = role === "admin" || role === "manager";

  const today = format(new Date(), "yyyy-MM-dd");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [lineFilter, setLineFilter] = useState<string>("__all__");
  const [shiftFilter, setShiftFilter] = useState<string>("__all__");
  const [categoryFilter, setCategoryFilter] = useState<string>("__all__");

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    occurred_date: today,
    shift: "DAY" as "DAY" | "NIGHT",
    line: "",
    category: CATEGORIES[0] as string,
    reason: "",
    duration_minutes: 10,
    leader_name: "",
    notes: "",
  });

  const { data: lines = [] } = useQuery({
    queryKey: ["lines"],
    queryFn: async () => {
      const { data } = await supabase.from("lines").select("name").order("name");
      const rank = (n: string) => {
        const m = n.match(/(\d+)/);
        const num = m ? parseInt(m[1], 10) : 999;
        if (/filler/i.test(n) || /^line/i.test(n)) return num;
        return 100 + num;
      };
      return ((data ?? []) as { name: string }[]).sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
    },
  });


  const { data: rows = [], isLoading } = useQuery<PDRow[]>({
    queryKey: ["production_downtimes", from, to, lineFilter, shiftFilter, categoryFilter],
    queryFn: async () => {
      let q = (supabase as any)
        .from("production_downtimes")
        .select("*")
        .gte("occurred_date", from)
        .lte("occurred_date", to)
        .order("occurred_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (lineFilter !== "__all__") q = q.eq("line", lineFilter);
      if (shiftFilter !== "__all__") q = q.eq("shift", shiftFilter);
      if (categoryFilter !== "__all__") q = q.eq("category", categoryFilter);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as PDRow[];
    },
  });

  const createMut = useMutation({
    mutationFn: async () => {
      if (!form.line) throw new Error("Line is required");
      if (!form.duration_minutes || form.duration_minutes <= 0) throw new Error("Duration must be > 0");
      const { error } = await (supabase as any).from("production_downtimes").insert({
        occurred_date: form.occurred_date,
        shift: form.shift,
        line: form.line,
        category: form.category,
        reason: form.reason || null,
        duration_minutes: Math.round(form.duration_minutes),
        leader_name: form.leader_name || null,
        notes: form.notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Production downtime recorded");
      setOpen(false);
      setForm((f) => ({ ...f, reason: "", notes: "", duration_minutes: 10 }));
      qc.invalidateQueries({ queryKey: ["production_downtimes"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("production_downtimes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey: ["production_downtimes"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const kpis = useMemo(() => {
    // Exclude "No Planned Shift" — those are periods the line wasn't
    // scheduled to run, not real downtime.
    const eligible = rows.filter((r) => !isNoPlannedShift(r.reason, r.category));
    const total = eligible.reduce((a, r) => a + r.duration_minutes, 0);
    const byCat = new Map<string, number>();
    const byLine = new Map<string, number>();
    for (const r of eligible) {
      byCat.set(r.category, (byCat.get(r.category) ?? 0) + r.duration_minutes);
      byLine.set(r.line, (byLine.get(r.line) ?? 0) + r.duration_minutes);
    }
    const topCat = [...byCat.entries()].sort((a, b) => b[1] - a[1])[0];
    const topLine = [...byLine.entries()].sort((a, b) => b[1] - a[1])[0];
    return { total, count: eligible.length, topCat, topLine };
  }, [rows]);

  const onExport = () => {
    exportRowsAsCsv(
      `production-downtime-${from}_to_${to}.csv`,
      rows.map((r) => ({
        Date: r.occurred_date,
        Shift: r.shift,
        Line: r.line,
        Category: r.category,
        Reason: r.reason ?? "",
        "Duration (min)": r.duration_minutes,
        Leader: r.leader_name ?? "",
        Notes: r.notes ?? "",
      })),
    );
  };

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold">Production Downtime</h1>
            <p className="text-sm text-muted-foreground">Track production-side stoppages (separate from maintenance).</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onExport} disabled={!rows.length}>
              <Download className="h-4 w-4 mr-2" />Export CSV
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button><Plus className="h-4 w-4 mr-2" />Record downtime</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>New production downtime</DialogTitle></DialogHeader>
                <div className="grid gap-3 py-2">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Date</Label>
                      <Input type="date" value={form.occurred_date} onChange={(e) => setForm({ ...form, occurred_date: e.target.value })} />
                    </div>
                    <div>
                      <Label>Shift</Label>
                      <Select value={form.shift} onValueChange={(v) => setForm({ ...form, shift: v as "DAY" | "NIGHT" })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="DAY">Day</SelectItem>
                          <SelectItem value="NIGHT">Night</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Line</Label>
                      <Select value={form.line} onValueChange={(v) => setForm({ ...form, line: v })}>
                        <SelectTrigger><SelectValue placeholder="Select line" /></SelectTrigger>
                        <SelectContent>
                          {lines.map((l) => <SelectItem key={l.name} value={l.name}>{l.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Category</Label>
                      <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Duration (min)</Label>
                      <Input type="number" min={1} value={form.duration_minutes}
                        onChange={(e) => setForm({ ...form, duration_minutes: Number(e.target.value) })} />
                    </div>
                    <div>
                      <Label>Leader</Label>
                      <Input value={form.leader_name} onChange={(e) => setForm({ ...form, leader_name: e.target.value })} />
                    </div>
                  </div>
                  <div>
                    <Label>Reason</Label>
                    <Input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
                  </div>
                  <div>
                    <Label>Notes</Label>
                    <Textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button onClick={() => createMut.mutate()} disabled={createMut.isPending}>
                    {createMut.isPending ? "Saving…" : "Save"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <Card>
          <CardContent className="p-4 grid gap-3 md:grid-cols-2 lg:grid-cols-6 items-end">
            <div>
              <Label>From</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <Label>To</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div>
              <Label>Line</Label>
              <Select value={lineFilter} onValueChange={setLineFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All lines</SelectItem>
                  {lines.map((l) => <SelectItem key={l.name} value={l.name}>{l.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Shift</Label>
              <Select value={shiftFilter} onValueChange={setShiftFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All</SelectItem>
                  <SelectItem value="DAY">Day</SelectItem>
                  <SelectItem value="NIGHT">Night</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Category</Label>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All</SelectItem>
                  {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" onClick={() => { setLineFilter("__all__"); setShiftFilter("__all__"); setCategoryFilter("__all__"); }}>
              Reset
            </Button>
          </CardContent>
        </Card>

        <div className="grid gap-3 md:grid-cols-4">
          <Card><CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs"><Clock className="h-4 w-4" />Total downtime</div>
            <div className="text-2xl font-bold">{formatMinutes(kpis.total)}</div>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs"><TrendingDown className="h-4 w-4" />Events</div>
            <div className="text-2xl font-bold">{kpis.count}</div>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs">Top category</div>
            <div className="text-lg font-semibold">{kpis.topCat?.[0] ?? "—"}</div>
            <div className="text-xs text-muted-foreground">{kpis.topCat ? formatMinutes(kpis.topCat[1]) : ""}</div>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs"><Factory className="h-4 w-4" />Top line</div>
            <div className="text-lg font-semibold">{kpis.topLine?.[0] ?? "—"}</div>
            <div className="text-xs text-muted-foreground">{kpis.topLine ? formatMinutes(kpis.topLine[1]) : ""}</div>
          </CardContent></Card>
        </div>

        <Card>
          <CardHeader><CardTitle>Records</CardTitle></CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-6 text-muted-foreground">Loading…</div>
            ) : rows.length === 0 ? (
              <div className="p-6 text-muted-foreground">No production downtime in this period.</div>
            ) : (
              <>
                {/* Desktop table */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="text-left p-3">Date</th>
                        <th className="text-left p-3">Shift</th>
                        <th className="text-left p-3">Line</th>
                        <th className="text-left p-3">Category</th>
                        <th className="text-left p-3">Reason</th>
                        <th className="text-right p-3">Duration</th>
                        <th className="text-left p-3">Leader</th>
                        <th className="p-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.id} className="border-t">
                          <td className="p-3">{r.occurred_date}</td>
                          <td className="p-3"><Badge variant={r.shift === "DAY" ? "default" : "secondary"}>{r.shift}</Badge></td>
                          <td className="p-3">{r.line}</td>
                          <td className="p-3">{r.category}</td>
                          <td className="p-3">{r.reason ?? "—"}</td>
                          <td className="p-3 text-right font-medium">{formatMinutes(r.duration_minutes)}</td>
                          <td className="p-3">{r.leader_name ?? "—"}</td>
                          <td className="p-3 text-right">
                            {canDelete && (
                              <Button size="icon" variant="ghost" onClick={() => deleteMut.mutate(r.id)}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile cards */}
                <div className="md:hidden divide-y">
                  {rows.map((r) => (
                    <div key={r.id} className="p-3 space-y-1">
                      <div className="flex items-center justify-between">
                        <div className="font-semibold">{r.line} · {r.category}</div>
                        <Badge variant={r.shift === "DAY" ? "default" : "secondary"}>{r.shift}</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">{r.occurred_date} · {r.leader_name ?? "—"}</div>
                      {r.reason && <div className="text-sm">{r.reason}</div>}
                      <div className="flex items-center justify-between">
                        <div className="font-bold">{formatMinutes(r.duration_minutes)}</div>
                        {canDelete && (
                          <Button size="sm" variant="ghost" onClick={() => deleteMut.mutate(r.id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
