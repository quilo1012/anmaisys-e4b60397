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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Progress } from "@/components/ui/progress";
import { ChevronLeft, ChevronRight, Lock, Unlock, Plus, Trash2, Save, Search, Check, Upload, Download } from "lucide-react";
import { ImportProductionDialog } from "@/components/ImportProductionDialog";
import { useQueryClient } from "@tanstack/react-query";
import {
  useLines, useLeaders, useSkuProducts, useSessionsRange, useSession, useSessionItems,
  useUpsertSession, useSaveItems, useToggleSessionLock,
} from "@/hooks/useProductionPlanner";
import { useAuth } from "@/contexts/AuthContext";
import { format, parseISO, addDays, subDays } from "date-fns";
import { cn } from "@/lib/utils";

type Row = { sku_id: string; sku_name: string; target_qty: number; actual_qty: number };

function SkuCombobox({
  value, onPick, skus, disabled,
}: { value: string; onPick: (id: string, name: string) => void; skus: { id: string; code: string; name: string }[]; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const current = skus.find((s) => s.id === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" disabled={disabled} className="w-full justify-between font-normal">
          <span className="flex items-center gap-2 truncate">
            <Search className="h-4 w-4 opacity-50 shrink-0" />
            {current ? current.code : "Search SKU…"}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0 pointer-events-auto" align="start">
        <Command>
          <CommandInput placeholder="Search by code or name…" />
          <CommandList>
            <CommandEmpty>No SKU found.</CommandEmpty>
            <CommandGroup>
              {skus.slice(0, 200).map((s) => (
                <CommandItem key={s.id} value={`${s.code} ${s.name}`} onSelect={() => { onPick(s.id, s.name); setOpen(false); }}>
                  <Check className={cn("mr-2 h-4 w-4", value === s.id ? "opacity-100" : "opacity-0")} />
                  <span className="font-mono text-xs mr-2">{s.code}</span>
                  <span className="truncate">{s.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export default function ProductionPlannerPage() {
  const { role } = useAuth();
  const queryClient = useQueryClient();
  const isManager = role === "admin" || (role === "manager" || role === "maintenance_manager");
  const [importOpen, setImportOpen] = useState(false);

  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [shift, setShift] = useState("DAY");
  const [line, setLine] = useState<string>("");
  const [leaderId, setLeaderId] = useState<string>("");
  const [leaderName, setLeaderName] = useState<string>("");
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

  const todaySessions = useMemo(() => history.filter((s) => s.session_date === date), [history, date]);
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
      setLeaderName(existing.leader_name ?? "");
      setStaffPlanned(existing.staff_planned ?? 0);
      setStaffActual(existing.staff_actual ?? 0);
      setNotes(existing.notes ?? "");
    } else {
      setLeaderId(""); setLeaderName(""); setStaffPlanned(0); setStaffActual(0); setNotes("");
    }
  }, [existing]);

  useEffect(() => {
    if (existingItems.length) {
      setRows(existingItems.map((i) => {
        const sku = skus.find((s) => s.id === i.sku_id);
        return {
          sku_id: i.sku_id,
          sku_name: sku?.name ?? "",
          target_qty: Number(i.target_qty ?? i.planned_qty ?? 0),
          actual_qty: Number(i.actual_qty ?? 0),
        };
      }));
    } else {
      setRows([]);
    }
  }, [existingItems, skus]);

  const locked = existing?.locked ?? false;
  const totalTarget = rows.reduce((a, r) => a + (r.target_qty || 0), 0);
  const totalActual = rows.reduce((a, r) => a + (r.actual_qty || 0), 0);
  const efficiency = totalTarget > 0 ? (totalActual / totalTarget) * 100 : 0;

  const addRow = () => setRows((r) => [...r, { sku_id: "", sku_name: "", target_qty: 0, actual_qty: 0 }]);
  const updateRow = (i: number, patch: Partial<Row>) =>
    setRows((r) => r.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  const removeRow = (i: number) => setRows((r) => r.filter((_, idx) => idx !== i));

  const save = async () => {
    if (!line) return alert("Pick a production line");
    const leader = leaders.find((l) => l.id === leaderId);
    try {
      const session = await upsertSession.mutateAsync({
        id: existingId ?? undefined,
        session_date: date, shift, line,
        leader_id: leaderId || null,
        leader_name: leader?.name ?? (leaderName.trim() || null),
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
    } catch (err: any) {
      const code = err?.code ?? "";
      const msg = String(err?.message ?? "");
      if (code === "23505") {
        alert("A session already exists for this line, date and shift. It has been updated.");
      } else if (code === "42P01" || msg.includes("does not exist")) {
        alert("Database tables not found. Please apply migrations.");
      } else {
        alert(`Could not save session: ${msg || "unknown error"}`);
      }
    }
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
            {isManager && (
              <Button variant="outline" size="sm" onClick={() => {
                const headers = ["Date","Assembly Number","Work Centre","Product Code","Product Description","Weight","QTY","Start Time","Finish Time","Shift"];
                const sample = [
                  ["25/06/2026","ASM-0001","Line 1","SKU-001","Sample Product A","0.500","1200","06:00","14:00","DAY"],
                  ["25/06/2026","ASM-0002","Line 2","SKU-002","Sample Product B","0.750","850","18:00","02:00","NIGHT"],
                ];
                const csv = [headers, ...sample].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
                const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url; a.download = `production-template-${format(new Date(), "yyyy-MM-dd")}.csv`;
                a.click(); URL.revokeObjectURL(url);
              }}>
                <Download className="h-4 w-4 mr-1" />Export Template
              </Button>
            )}
            {isManager && (
              <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
                <Upload className="h-4 w-4 mr-1" />Import Production
              </Button>
            )}
            {existingId && isManager && (
              <Button variant="outline" size="sm" onClick={() => toggleLock.mutate({ id: existingId, lock: !locked })}>
                {locked ? <><Unlock className="h-4 w-4 mr-1" />Unlock</> : <><Lock className="h-4 w-4 mr-1" />Lock</>}
              </Button>
            )}
          </div>
        </div>
        <ImportProductionDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          onImported={() => {
            queryClient.invalidateQueries({ queryKey: ["planner-sessions"] });
            queryClient.invalidateQueries({ queryKey: ["planner-session"] });
            queryClient.invalidateQueries({ queryKey: ["planner-items"] });
          }}
        />

        {/* Shift Information — horizontal row */}
        <Card>
          <CardHeader><CardTitle className="text-base">Shift Information</CardTitle></CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-4">
              <div>
                <Label>Date</Label>
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="icon" onClick={() => setDate(format(subDays(parseISO(date), 1), "yyyy-MM-dd"))}><ChevronLeft className="h-4 w-4" /></Button>
                  <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="flex-1" />
                  <Button variant="outline" size="icon" onClick={() => setDate(format(addDays(parseISO(date), 1), "yyyy-MM-dd"))}><ChevronRight className="h-4 w-4" /></Button>
                </div>
              </div>
              <div>
                <Label>Shift</Label>
                <Select value={shift} onValueChange={setShift}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DAY">Day</SelectItem>
                    <SelectItem value="NIGHT">Night</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Production Line</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" role="combobox" disabled={locked} className="w-full justify-between font-normal">
                      <span className="flex items-center gap-2 truncate"><Search className="h-4 w-4 opacity-50" />{line || "Pick line…"}</span>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[260px] p-0 pointer-events-auto" align="start">
                    <Command>
                      <CommandInput placeholder="Search line…" />
                      <CommandList>
                        <CommandEmpty>No line.</CommandEmpty>
                        <CommandGroup>
                          {lines.map((l: { id: string; name: string }) => (
                            <CommandItem key={l.id} value={l.name} onSelect={() => setLine(l.name)}>
                              <Check className={cn("mr-2 h-4 w-4", line === l.name ? "opacity-100" : "opacity-0")} />{l.name}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
              <div>
                <Label>Line Leader</Label>
                {leaders.length > 0 ? (
                  <Select value={leaderId} onValueChange={setLeaderId} disabled={locked}>
                    <SelectTrigger><SelectValue placeholder="Pick leader" /></SelectTrigger>
                    <SelectContent>{leaders.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent>
                  </Select>
                ) : (
                  <Input
                    value={leaderName}
                    onChange={(e) => setLeaderName(e.target.value)}
                    placeholder="Type leader name"
                    disabled={locked}
                  />
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Products / SKUs */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Products / SKUs</CardTitle>
            <Button variant="outline" size="sm" onClick={addRow} disabled={locked}><Plus className="h-4 w-4 mr-1" />Add Product</Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {rows.length === 0 && (
              <div className="text-sm text-muted-foreground text-center py-6">No products yet. Click "Add Product".</div>
            )}
            {rows.map((r, i) => {
              const eff = r.target_qty > 0 ? (r.actual_qty / r.target_qty) * 100 : 0;
              return (
                <div key={i} className="grid gap-3 md:grid-cols-12 items-end border rounded-lg p-3">
                  <div className="md:col-span-3">
                    <Label>SKU</Label>
                    <SkuCombobox
                      value={r.sku_id}
                      onPick={(id, name) => {
                        const sku = skus.find((s) => s.id === id);
                        const tph = sku?.target_per_hour ?? 0;
                        updateRow(i, { sku_id: id, sku_name: name, target_qty: r.target_qty || (tph ? tph * 8 : 0) });
                      }}
                      skus={skus}
                      disabled={locked}
                    />
                  </div>
                  <div className="md:col-span-3">
                    <Label>Product Name</Label>
                    <Input value={r.sku_name} onChange={(e) => updateRow(i, { sku_name: e.target.value })} disabled={locked} />
                  </div>
                  <div className="md:col-span-2">
                    <Label>Target</Label>
                    <div className="flex items-center gap-1">
                      <Input type="number" value={r.target_qty} onChange={(e) => updateRow(i, { target_qty: +e.target.value })} disabled={locked} />
                      <span className="text-xs text-muted-foreground">units</span>
                    </div>
                  </div>
                  <div className="md:col-span-2">
                    <Label>Actual</Label>
                    <div className="flex items-center gap-1">
                      <Input type="number" value={r.actual_qty} onChange={(e) => updateRow(i, { actual_qty: +e.target.value })} disabled={locked} />
                      <span className="text-xs text-muted-foreground">units</span>
                    </div>
                  </div>
                  <div className="md:col-span-2 flex items-end gap-2">
                    <div className="flex-1">
                      <div className={cn("text-xs font-medium mb-1", effColor(eff))}>{eff.toFixed(0)}%</div>
                      <Progress value={Math.min(100, eff)} className="h-2" />
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => removeRow(i)} disabled={locked}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Staffing */}
        <Card>
          <CardHeader><CardTitle className="text-base">Staffing</CardTitle></CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2">
              <div><Label>Staff Planned</Label><Input type="number" value={staffPlanned} onChange={(e) => setStaffPlanned(+e.target.value)} disabled={locked} /></div>
              <div><Label>Staff Actual</Label><Input type="number" value={staffActual} onChange={(e) => setStaffActual(+e.target.value)} disabled={locked} /></div>
            </div>
          </CardContent>
        </Card>

        {/* Observações */}
        <Card>
          <CardHeader><CardTitle className="text-base">Observations</CardTitle></CardHeader>
          <CardContent>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} disabled={locked} rows={4} placeholder="Notes, issues, comments…" />
          </CardContent>
        </Card>

        {/* KPI summary */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Total Target</div><div className="text-2xl font-bold">{totalTarget.toLocaleString()}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Total Actual</div><div className="text-2xl font-bold">{totalActual.toLocaleString()}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Efficiency</div><div className={cn("text-2xl font-bold", effColor(efficiency))}>{efficiency.toFixed(1)}%</div></CardContent></Card>
        </div>

        <div className="flex justify-end">
          <Button size="lg" onClick={save} disabled={locked || upsertSession.isPending || saveItems.isPending}>
            <Save className="h-4 w-4 mr-2" />Save Session
          </Button>
        </div>

        {/* History */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">History (last 30 days)</CardTitle>
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
              <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Shift</TableHead><TableHead>Line</TableHead><TableHead>Leader</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
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
