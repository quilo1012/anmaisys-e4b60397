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
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Download, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { format, subDays } from "date-fns";

interface ActionType { id: string; code: string; label: string; points: number; active: boolean }
interface QualityAction { id: string; action_type_id: string; line: string | null; shift: string | null; leader_name: string | null; description: string | null; recorded_at: string; points: number | null }

export default function QualityActionsPage() {
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const qc = useQueryClient();

  const [days, setDays] = useState("30");
  const [filterLine, setFilterLine] = useState("__all__");
  const [filterLeader, setFilterLeader] = useState("__all__");
  const [open, setOpen] = useState(false);
  const [typesOpen, setTypesOpen] = useState(false);
  const [form, setForm] = useState<{ action_type_id: string; line: string; shift: string; leader_id: string; description: string }>({
    action_type_id: "", line: "", shift: "DAY", leader_id: "", description: "",
  });

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
    queryKey: ["leaders"],
    queryFn: async () => {
      const { data } = await supabase.rpc("list_active_profile_names");
      return (data ?? []) as { id: string; name: string }[];
    },
  });
  const { data: actions = [] } = useQuery({
    queryKey: ["quality_actions", from],
    queryFn: async () => {
      const { data, error } = await supabase.from("quality_actions").select("*").gte("recorded_at", from).order("recorded_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as QualityAction[];
    },
  });

  const filtered = useMemo(() =>
    actions.filter((a) => (filterLine === "__all__" || a.line === filterLine) && (filterLeader === "__all__" || a.leader_name === filterLeader)),
    [actions, filterLine, filterLeader]
  );

  const typeMap = useMemo(() => new Map(types.map((t) => [t.id, t])), [types]);

  const kpis = useMemo(() => ({
    issues: filtered.length,
    points: filtered.reduce((a, x) => a + (x.points ?? 0), 0),
    linesAffected: new Set(filtered.map((x) => x.line).filter(Boolean)).size,
    leaders: new Set(filtered.map((x) => x.leader_name).filter(Boolean)).size,
  }), [filtered]);

  const topIssues = useMemo(() => {
    const map = new Map<string, { label: string; count: number; points: number }>();
    for (const a of filtered) {
      const t = typeMap.get(a.action_type_id);
      const label = t?.label ?? "Unknown";
      const cur = map.get(label) ?? { label, count: 0, points: 0 };
      cur.count += 1; cur.points += a.points ?? 0;
      map.set(label, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count).slice(0, 5);
  }, [filtered, typeMap]);

  const create = useMutation({
    mutationFn: async () => {
      if (!form.action_type_id) throw new Error("Pick a type");
      const type = typeMap.get(form.action_type_id);
      const leader = leaders.find((l) => l.id === form.leader_id);
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from("quality_actions").insert({
        action_type_id: form.action_type_id,
        line: form.line || null,
        shift: form.shift || null,
        leader_id: form.leader_id || null,
        leader_name: leader?.name ?? null,
        description: form.description || null,
        points: type?.points ?? 1,
        recorded_by: u.user?.id ?? null,
        recorded_at: new Date().toISOString(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quality_actions"] });
      setOpen(false); setForm({ action_type_id: "", line: "", shift: "DAY", leader_id: "", description: "" });
      toast.success("Logged");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const exportCSV = () => {
    const rows = [["Date", "Type", "Points", "Line", "Shift", "Leader", "Notes"]];
    for (const a of filtered) {
      const t = typeMap.get(a.action_type_id);
      rows.push([a.recorded_at, t?.label ?? "", String(a.points ?? 0), a.line ?? "", a.shift ?? "", a.leader_name ?? "", (a.description ?? "").replace(/"/g, '""')]);
    }
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `quality-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-2xl font-bold">Quality Actions</h1>
          <div className="flex gap-2">
            {isAdmin && <Button variant="outline" onClick={() => setTypesOpen(true)}><Settings2 className="h-4 w-4 mr-1" />Types</Button>}
            <Button variant="outline" onClick={exportCSV}><Download className="h-4 w-4 mr-1" />Export</Button>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-1" />Log issue</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Log quality issue</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div><Label>Type</Label>
                    <Select value={form.action_type_id} onValueChange={(v) => setForm({ ...form, action_type_id: v })}>
                      <SelectTrigger><SelectValue placeholder="Pick type" /></SelectTrigger>
                      <SelectContent>{types.filter((t) => t.active).map((t) => <SelectItem key={t.id} value={t.id}>{t.label} ({t.points}p)</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
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
                  <div><Label>Leader</Label>
                    <Select value={form.leader_id} onValueChange={(v) => setForm({ ...form, leader_id: v })}>
                      <SelectTrigger><SelectValue placeholder="Pick leader" /></SelectTrigger>
                      <SelectContent>{leaders.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div><Label>Notes</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
                </div>
                <DialogFooter><Button onClick={() => create.mutate()} disabled={create.isPending}>Save</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Issues</div><div className="text-2xl font-bold">{kpis.issues}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Points</div><div className="text-2xl font-bold">{kpis.points}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Lines affected</div><div className="text-2xl font-bold">{kpis.linesAffected}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Leaders</div><div className="text-2xl font-bold">{kpis.leaders}</div></CardContent></Card>
        </div>

        <Card>
          <CardHeader><CardTitle>Top issues</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {topIssues.length === 0 && <span className="text-muted-foreground">No issues</span>}
              {topIssues.map((t) => <Badge key={t.label} variant="secondary" className="text-sm py-1 px-3">{t.label} • {t.count} • {t.points}p</Badge>)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle>Log</CardTitle>
              <div className="flex gap-2">
                <Select value={days} onValueChange={setDays}>
                  <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="7">7 days</SelectItem><SelectItem value="30">30 days</SelectItem><SelectItem value="90">90 days</SelectItem></SelectContent>
                </Select>
                <Select value={filterLine} onValueChange={setFilterLine}>
                  <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All lines</SelectItem>
                    {lines.map((l) => <SelectItem key={l.name} value={l.name}>{l.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={filterLeader} onValueChange={setFilterLeader}>
                  <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All leaders</SelectItem>
                    {leaders.map((l) => <SelectItem key={l.id} value={l.name}>{l.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Type</TableHead><TableHead>Points</TableHead><TableHead>Line</TableHead><TableHead>Shift</TableHead><TableHead>Leader</TableHead><TableHead>Notes</TableHead></TableRow></TableHeader>
              <TableBody>
                {filtered.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No actions</TableCell></TableRow>}
                {filtered.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>{format(new Date(a.recorded_at), "dd/MM HH:mm")}</TableCell>
                    <TableCell>{typeMap.get(a.action_type_id)?.label ?? "—"}</TableCell>
                    <TableCell>{a.points ?? 0}</TableCell>
                    <TableCell>{a.line ?? "—"}</TableCell>
                    <TableCell>{a.shift ?? "—"}</TableCell>
                    <TableCell>{a.leader_name ?? "—"}</TableCell>
                    <TableCell className="max-w-xs truncate">{a.description ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {isAdmin && (
          <Dialog open={typesOpen} onOpenChange={setTypesOpen}>
            <DialogContent>
              <DialogHeader><DialogTitle>Action types</DialogTitle></DialogHeader>
              <TypesManager types={types} onChange={() => qc.invalidateQueries({ queryKey: ["quality_action_types"] })} />
            </DialogContent>
          </Dialog>
        )}
      </div>
    </DashboardLayout>
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
