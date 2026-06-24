import { useMemo, useState, useEffect } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronLeft, ChevronRight, Lock, Unlock, Plus, Trash2, Save } from "lucide-react";
import {
  useLines, useLeaders, useSkuProducts, useSessionsRange, useSession, useSessionItems,
  useUpsertSession, useSaveItems, useToggleSessionLock, type ProductionItem,
} from "@/hooks/useProductionPlanner";
import { useAuth } from "@/contexts/AuthContext";
import { format, parseISO, addDays, subDays } from "date-fns";

type Row = { sku_id: string; target_qty: number; actual_qty: number };

export default function ProductionPlannerPage() {
  const { role } = useAuth();
  const isManager = role === "admin" || role === "manager";

  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [shift, setShift] = useState("DAY");
  const [line, setLine] = useState<string>("");
  const [leaderId, setLeaderId] = useState<string>("");
  const [staffPlanned, setStaffPlanned] = useState(0);
  const [staffActual, setStaffActual] = useState(0);
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [historyLine, setHistoryLine] = useState<string>("__all__");

  const { data: lines = [] } = useLines();
  const { data: leaders = [] } = useLeaders();
  const { data: skus = [] } = useSkuProducts();

  const fromDate = format(subDays(new Date(), 30), "yyyy-MM-dd");
  const toDate = format(new Date(), "yyyy-MM-dd");
  const { data: history = [] } = useSessionsRange(
    fromDate, toDate, historyLine === "__all__" ? undefined : historyLine,
  );

  const todaySessions = useMemo(
    () => history.filter((s) => s.session_date === date),
    [history, date],
  );
  const existingId = useMemo(
    () => todaySessions.find((s) => s.line === line && s.shift === shift)?.id ?? null,
    [todaySessions, line, shift],
  );
  const { data: existing } = useSession(existingId);
  const { data: existingItems = [] } = useSessionItems(existingId);

  const upsertSession = useUpsertSession();
  const saveItems = useSaveItems();
  const toggleLock = useToggleSessionLock();

  useEffect(() => {
    if (existing) {
      setLeaderId(existing.leader_id ?? "");
      setStaffPlanned(existing.staff_planned ?? 0);
      setStaffActual(existing.staff_actual ?? 0);
      setNotes(existing.notes ?? "");
    } else {
      setLeaderId(""); setStaffPlanned(0); setStaffActual(0); setNotes("");
    }
  }, [existing]);

  useEffect(() => {
    if (existingItems.length) {
      setRows(existingItems.map((i) => ({
        sku_id: i.sku_id,
        target_qty: Number(i.target_qty ?? i.planned_qty ?? 0),
        actual_qty: Number(i.actual_qty ?? 0),
      })));
    } else {
      setRows([]);
    }
  }, [existingItems]);

  const locked = existing?.locked ?? false;
  const totalTarget = rows.reduce((a, r) => a + (r.target_qty || 0), 0);
  const totalActual = rows.reduce((a, r) => a + (r.actual_qty || 0), 0);
  const efficiency = totalTarget > 0 ? (totalActual / totalTarget) * 100 : 0;

  const kpis = useMemo(() => {
    const tgt = todaySessions.length;
    return { sessions: tgt };
  }, [todaySessions]);

  const addRow = () => setRows((r) => [...r, { sku_id: "", target_qty: 0, actual_qty: 0 }]);
  const updateRow = (i: number, patch: Partial<Row>) =>
    setRows((r) => r.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  const removeRow = (i: number) => setRows((r) => r.filter((_, idx) => idx !== i));

  const save = async () => {
    if (!line) return alert("Pick a line");
    const leader = leaders.find((l) => l.id === leaderId);
    const session = await upsertSession.mutateAsync({
      id: existingId ?? undefined,
      session_date: date, shift, line,
      leader_id: leaderId || null,
      leader_name: leader?.name ?? null,
      staff_planned: staffPlanned, staff_actual: staffActual,
      notes: notes || null,
    });
    await saveItems.mutateAsync({
      session_id: session.id,
      items: rows.filter((r) => r.sku_id).map((r) => ({
        sku_id: r.sku_id,
        target_qty: r.target_qty || 0,
        planned_qty: r.target_qty || 0,
        actual_qty: r.actual_qty || 0,
        notes: null,
      })),
    });
  };

  const loadSession = (id: string) => {
    const s = history.find((h) => h.id === id);
    if (!s) return;
    setDate(s.session_date); setShift(s.shift); setLine(s.line);
  };

  const effColor = (e: number) =>
    e >= 100 ? "text-green-500" : e >= 80 ? "text-amber-500" : "text-red-500";

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-2xl font-bold">Production Planner</h1>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => setDate(format(subDays(parseISO(date), 1), "yyyy-MM-dd"))}><ChevronLeft className="h-4 w-4" /></Button>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" />
            <Button variant="outline" size="icon" onClick={() => setDate(format(addDays(parseISO(date), 1), "yyyy-MM-dd"))}><ChevronRight className="h-4 w-4" /></Button>
            <Select value={shift} onValueChange={setShift}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="DAY">Day</SelectItem>
                <SelectItem value="NIGHT">Night</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Sessions today</div><div className="text-2xl font-bold">{kpis.sessions}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Target</div><div className="text-2xl font-bold">{totalTarget}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Actual</div><div className="text-2xl font-bold">{totalActual}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Efficiency</div><div className={`text-2xl font-bold ${effColor(efficiency)}`}>{efficiency.toFixed(1)}%</div></CardContent></Card>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Session</CardTitle>
            <div className="flex gap-2">
              {existingId && isManager && (
                <Button variant="outline" size="sm" onClick={() => toggleLock.mutate({ id: existingId, lock: !locked })}>
                  {locked ? <><Unlock className="h-4 w-4 mr-1" />Unlock</> : <><Lock className="h-4 w-4 mr-1" />Lock</>}
                </Button>
              )}
              <Button size="sm" onClick={save} disabled={locked || upsertSession.isPending || saveItems.isPending}>
                <Save className="h-4 w-4 mr-1" />Save
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-4">
              <div><Label>Line</Label>
                <Select value={line} onValueChange={setLine} disabled={locked}>
                  <SelectTrigger><SelectValue placeholder="Pick line" /></SelectTrigger>
                  <SelectContent>{lines.map((l: { id: string; name: string }) => <SelectItem key={l.id} value={l.name}>{l.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Leader</Label>
                <Select value={leaderId} onValueChange={setLeaderId} disabled={locked}>
                  <SelectTrigger><SelectValue placeholder="Pick leader" /></SelectTrigger>
                  <SelectContent>{leaders.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Staff Planned</Label><Input type="number" value={staffPlanned} onChange={(e) => setStaffPlanned(+e.target.value)} disabled={locked} /></div>
              <div><Label>Staff Actual</Label><Input type="number" value={staffActual} onChange={(e) => setStaffActual(+e.target.value)} disabled={locked} /></div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2"><Label>SKUs</Label>
                <Button variant="outline" size="sm" onClick={addRow} disabled={locked}><Plus className="h-4 w-4 mr-1" />Add SKU</Button>
              </div>
              <Table>
                <TableHeader><TableRow><TableHead>SKU</TableHead><TableHead>Target</TableHead><TableHead>Actual</TableHead><TableHead>Eff %</TableHead><TableHead /></TableRow></TableHeader>
                <TableBody>
                  {rows.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No SKUs yet</TableCell></TableRow>}
                  {rows.map((r, i) => {
                    const eff = r.target_qty > 0 ? (r.actual_qty / r.target_qty) * 100 : 0;
                    return (
                      <TableRow key={i}>
                        <TableCell>
                          <Select value={r.sku_id} onValueChange={(v) => updateRow(i, { sku_id: v })} disabled={locked}>
                            <SelectTrigger className="w-56"><SelectValue placeholder="Pick SKU" /></SelectTrigger>
                            <SelectContent>{skus.map((s) => <SelectItem key={s.id} value={s.id}>{s.code} — {s.name}</SelectItem>)}</SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell><Input type="number" value={r.target_qty} onChange={(e) => updateRow(i, { target_qty: +e.target.value })} disabled={locked} className="w-24" /></TableCell>
                        <TableCell><Input type="number" value={r.actual_qty} onChange={(e) => updateRow(i, { actual_qty: +e.target.value })} disabled={locked} className="w-24" /></TableCell>
                        <TableCell className={effColor(eff)}>{eff.toFixed(0)}%</TableCell>
                        <TableCell><Button variant="ghost" size="icon" onClick={() => removeRow(i)} disabled={locked}><Trash2 className="h-4 w-4" /></Button></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <div><Label>Notes</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} disabled={locked} /></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>History (30d)</CardTitle>
            <Select value={historyLine} onValueChange={setHistoryLine}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All lines</SelectItem>
                {lines.map((l: { id: string; name: string }) => <SelectItem key={l.id} value={l.name}>{l.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Shift</TableHead><TableHead>Line</TableHead><TableHead>Leader</TableHead><TableHead>Lock</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {history.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No sessions</TableCell></TableRow>}
                {history.map((s) => (
                  <TableRow key={s.id} className="cursor-pointer" onClick={() => loadSession(s.id)}>
                    <TableCell>{s.session_date}</TableCell>
                    <TableCell>{s.shift}</TableCell>
                    <TableCell>{s.line}</TableCell>
                    <TableCell>{s.leader_name ?? "—"}</TableCell>
                    <TableCell>{s.locked ? <Badge variant="secondary"><Lock className="h-3 w-3 mr-1" />Locked</Badge> : <Badge variant="outline">Open</Badge>}</TableCell>
                    <TableCell><Button variant="ghost" size="sm">Load</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
