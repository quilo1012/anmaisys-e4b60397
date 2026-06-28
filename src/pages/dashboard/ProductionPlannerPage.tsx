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
import { ChevronLeft, ChevronRight, Lock, Unlock, Plus, Trash2, Save, Search, Check, Upload, Download, FileInput, Sparkles, RefreshCw, X } from "lucide-react";
import { ImportProductionDialog } from "@/components/ImportProductionDialog";
import { IntouchImportDialog } from "@/components/IntouchImportDialog";
import { AssemblyListImporter } from "@/components/AssemblyListImporter";
import { toast } from "sonner";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import {
  useLines, useSkuProducts, useSessionsRange, useSession, useSessionItems,
  useUpsertSession, useSaveItems, useToggleSessionLock,
} from "@/hooks/useProductionPlanner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { invokeFunction } from "@/lib/invokeFunction";
import { format, parseISO, addDays, subDays } from "date-fns";
import { cn } from "@/lib/utils";

type Row = { sku_id: string; sku_name: string; target_qty: number; actual_qty: number };

function useLineLeaders(shift: string) {
  return useQuery({
    queryKey: ["line_leaders", shift],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("line_leaders")
        .select("id, name, shift")
        .eq("active", true)
        .in("shift", [shift, "BOTH"])
        .order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string; shift: string }[];
    },
  });
}

function useAddLineLeader() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; shift: string }) => {
      const { data, error } = await supabase
        .from("line_leaders")
        .insert({ name: input.name.trim(), shift: input.shift })
        .select("id, name, shift")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["line_leaders"] }),
    onError: (e: Error) => toast.error(e.message),
  });
}

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
  const [intouchOpen, setIntouchOpen] = useState(false);
  const [assemblyOpen, setAssemblyOpen] = useState(false);

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
  const [syncedLines, setSyncedLines] = useState<string[] | null>(null);
  const [syncingLines, setSyncingLines] = useState(false);

  const syncLinesForDate = async () => {
    setSyncingLines(true);
    try {
      const { data: syncData, error: syncError } = await invokeFunction<any>("intouch-sync-production", {
        session_date: date,
        shift: shift.toUpperCase() === "NIGHT" ? "NIGHT" : "DAY",
        force: true,
      });
      if (syncError) throw syncError;
      if (syncData?.skipped) {
        toast.error(syncData.reason === "intouch_sync_disabled" || syncData.reason === "intouch_current_shift_sync_disabled"
          ? "iTouching SKU sync is disabled in Settings. Enable it first."
          : `iTouching sync skipped: ${syncData.reason ?? "unknown"}`);
      } else {
        const summary = syncData?.summary ? ` · ${syncData.summary}` : "";
        toast.success(`iTouching Material Requirements synced${summary}`);
      }

      await queryClient.invalidateQueries({ queryKey: ["production_sessions"] });
      await queryClient.invalidateQueries({ queryKey: ["production_session"] });
      await queryClient.invalidateQueries({ queryKey: ["production_items"] });

      // 1. Lines with at least one ACTIVE mapped machine in iTouching
      const { data: maps, error: mErr } = await supabase
        .from("intouch_machine_map")
        .select("line_id, active, lines:line_id(name)")
        .eq("active", true);
      if (mErr) throw mErr;
      const activeLineNames = new Set(
        (maps ?? [])
          .map((m: any) => (m.lines?.name ?? "").trim())
          .filter(Boolean),
      );

      // 2. Lines in RAG weekly for this date+shift with plan filled (> 0)
      const { data: rag, error: rErr } = await supabase
        .from("rag_weekly_entries")
        .select("line, plan_qty, shift")
        .eq("entry_date", date)
        .eq("shift", shift.toUpperCase() === "NIGHT" ? "NIGHT" : "DAY")
        .gt("plan_qty", 0);
      if (rErr) throw rErr;
      const planned = new Set(
        (rag ?? [])
          .map((r: any) => (r.line ?? "").trim())
          .filter(Boolean),
      );

      // 3. Optional info: lines that already have a session with SKUs from iTouching Material Requirements
      const { data: sessions } = await supabase
        .from("production_sessions")
        .select("line, production_items(id)")
        .eq("session_date", date)
        .eq("shift", shift.toUpperCase() === "NIGHT" ? "NIGHT" : "DAY");
      const withSkus = new Set(
        (sessions ?? [])
          .filter((r: any) => Array.isArray(r.production_items) && r.production_items.length > 0)
          .map((r: any) => (r.line ?? "").trim())
          .filter(Boolean),
      );

      // Schedule = active machine ∩ RAG plan (SKUs come from iTouching Material Requirements)
      const distinct = Array.from(planned)
        .filter((l) => activeLineNames.has(l))
        .sort();

      if (distinct.length === 0) {
        setSyncedLines(null);
        if (activeLineNames.size === 0) {
          toast.error("No active machines mapped in iTouching Settings");
        } else if (planned.size === 0) {
          toast.error(`No RAG Weekly plan filled for ${date} ${shift}`);
        } else {
          toast.error(`No lines match: active machine + RAG plan for ${date} ${shift}`);
        }
      } else {
        setSyncedLines(distinct);
        const pending = distinct.filter((l) => !withSkus.has(l)).length;
        toast.success(
          `Found ${distinct.length} line(s) for ${date} ${shift}` +
            (pending > 0 ? ` · ${pending} without iTouching SKUs yet` : ""),
        );
        if (!line || !distinct.includes(line)) setLine(distinct[0]);
      }

    } catch (e: any) {
      toast.error(`Sync failed: ${e?.message ?? "unknown"}`);
    } finally {
      setSyncingLines(false);
    }
  };


  const { data: lines = [] } = useLines();
  const { data: leaders = [] } = useLineLeaders(shift);
  const addLeader = useAddLineLeader();
  const [newLeader, setNewLeader] = useState("");
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
    // Only hydrate rows from a loaded existing session; never wipe local
    // edits when there is no session yet (otherwise "Add Product" would be
    // reset on the next render because default-destructured arrays produce
    // a new reference every time).
    if (!existingId) return;
    setRows(
      existingItems.map((i) => {
        const sku = skus.find((s) => s.id === i.sku_id);
        return {
          sku_id: i.sku_id,
          sku_name: sku?.name ?? "",
          target_qty: Number(i.target_qty ?? i.planned_qty ?? 0),
          actual_qty: Number(i.actual_qty ?? 0),
        };
      }),
    );
  }, [existingId, existingItems, skus]);

  // Clear rows when the user switches to a date/shift/line combo with no session.
  useEffect(() => {
    if (!existingId) setRows([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, shift, line]);

  const locked = existing?.locked ?? false;
  const totalTarget = rows.reduce((a, r) => a + (r.target_qty || 0), 0);
  const totalActual = rows.reduce((a, r) => a + (r.actual_qty || 0), 0);
  const efficiency = totalTarget > 0 ? (totalActual / totalTarget) * 100 : 0;

  const addRow = () => setRows((r) => [...r, { sku_id: "", sku_name: "", target_qty: 0, actual_qty: 0 }]);
  const updateRow = (i: number, patch: Partial<Row>) =>
    setRows((r) => r.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  const removeRow = (i: number) => {
    const row = rows[i];
    const label = row?.sku_name || "this SKU";
    if (!window.confirm(`Delete ${label} from this plan?`)) return;
    setRows((r) => r.filter((_, idx) => idx !== i));
  };

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

      // Auto-sync Total Target into RAG Weekly for this line+date+shift
      const totalPlan = rows.reduce((a, r) => a + (Number(r.target_qty) || 0), 0);
      const shiftKey = shift.toUpperCase() === "NIGHT" ? "NIGHT" : "DAY";
      const { error: ragErr } = await supabase
        .from("rag_weekly_entries")
        .upsert(
          { entry_date: date, line, shift: shiftKey, plan_qty: totalPlan },
          { onConflict: "entry_date,line,shift", ignoreDuplicates: false }
        );
      if (ragErr) {
        toast.error(`Saved session, but RAG sync failed: ${ragErr.message}`);
      } else {
        toast.success(`Session saved. RAG target updated to ${totalPlan.toLocaleString()}.`);
      }

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
            {isManager && (
              <Button
                size="sm"
                className="bg-indigo-600 hover:bg-indigo-700 text-white"
                onClick={() => setAssemblyOpen(true)}
              >
                <Sparkles className="h-4 w-4 mr-1" />Assembly List
              </Button>
            )}
            {isManager && (
              <Button variant="default" size="sm" onClick={() => setIntouchOpen(true)}>
                <FileInput className="h-4 w-4 mr-1" />Import iTouching
              </Button>
            )}
            {isManager && (
              <Button
                variant="default"
                size="sm"
                className="bg-purple-600 hover:bg-purple-700 text-white"
                onClick={async () => {
                  try {
                    const { data, error } = await supabase.functions.invoke("calculate-shift-targets", {
                      body: { date, shift, line: line || undefined, overwrite: false },
                    });
                    if (error) throw error;
                    toast.success(`Auto Targets: ${data?.items_updated ?? 0} SKU(s) updated`);
                    queryClient.invalidateQueries({ queryKey: ["planner-items"] });
                    queryClient.invalidateQueries({ queryKey: ["planner-session"] });
                    queryClient.invalidateQueries({ queryKey: ["planner-sessions"] });
                  } catch (e: any) {
                    toast.error(`Auto Targets failed: ${e?.message ?? "unknown"}`);
                  }
                }}
              >
                <Sparkles className="h-4 w-4 mr-1" />Auto Targets
              </Button>
            )}
            {isManager && (
              <Button
                variant="default"
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                disabled={!line || rows.filter((r) => r.sku_id).length === 0}
                onClick={async () => {
                  const items = rows
                    .filter((r) => r.sku_id)
                    .map((r) => {
                      const sku = skus.find((s) => s.id === r.sku_id);
                      return {
                        code: sku?.code ?? "",
                        description: sku?.name ?? r.sku_name ?? "",
                        qty: Number(r.target_qty) || 0,
                      };
                    })
                    .filter((it) => it.code);
                  if (!items.length) { toast.error("Add at least one SKU with a code"); return; }
                  if (!window.confirm(`Send ${items.length} job(s) to iTouching for ${line} (${date} ${shift})?`)) return;
                  try {
                    const { data, error } = await invokeFunction<any>("intouch-job-import", {
                      session_date: date,
                      shift: shift.toUpperCase() === "NIGHT" ? "NIGHT" : "DAY",
                      line,
                      items,
                    });
                    const payload = (error as any)?.details ?? data;
                    const errMsg = payload?.error;
                    const retryAfter = payload?.retry_after;
                    if (errMsg) {
                      const msg = typeof errMsg === "string" ? errMsg : JSON.stringify(errMsg);
                      if (/quota/i.test(msg) && retryAfter) {
                        toast.error(`iTouching daily quota exhausted. Try again after ${new Date(retryAfter).toLocaleString()}.`);
                      } else {
                        toast.error(`Send failed: ${msg}`);
                      }
                      return;
                    }
                    if (error) {
                      toast.error(`Send failed: ${(error as any)?.message ?? "unknown"}`);
                      return;
                    }
                    toast.success(`Sent ${data?.sent ?? items.length} job(s) to iTouching`);
                  } catch (e: any) {
                    toast.error(`Send failed: ${e?.message ?? "unknown"}`);
                  }
                }}
              >
                <Upload className="h-4 w-4 mr-1" />Send to iTouching
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
        <IntouchImportDialog
          open={intouchOpen}
          onOpenChange={setIntouchOpen}
          defaultDate={date}
          defaultShift={shift as "DAY" | "NIGHT"}
          onImported={() => {
            queryClient.invalidateQueries({ queryKey: ["production_sessions"] });
            queryClient.invalidateQueries({ queryKey: ["production_items"] });
          }}
        />
        <AssemblyListImporter
          open={assemblyOpen}
          onOpenChange={setAssemblyOpen}
          onImported={() => {
            queryClient.invalidateQueries({ queryKey: ["production_sessions"] });
            queryClient.invalidateQueries({ queryKey: ["production_session"] });
            queryClient.invalidateQueries({ queryKey: ["production_items"] });
            queryClient.invalidateQueries({ queryKey: ["rag_weekly_entries"] });
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
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={syncLinesForDate}
                    disabled={syncingLines}
                    title="Show only lines active on this date"
                  >
                    <RefreshCw className={cn("h-4 w-4 mr-1", syncingLines && "animate-spin")} />
                    Sync Lines
                  </Button>
                  {syncedLines && (
                    <Button variant="ghost" size="icon" onClick={() => setSyncedLines(null)} title="Clear filter">
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                {syncedLines && (
                  <div className="text-xs text-muted-foreground mt-1">
                    Filtered to {syncedLines.length} line(s) for {date}
                  </div>
                )}
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
                          {(syncedLines
                            ? lines.filter((l: { id: string; name: string }) => syncedLines.includes(l.name))
                            : lines
                          ).map((l: { id: string; name: string }) => (
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
                <Label>Line Leader ({shift})</Label>
                <div className="flex gap-2">
                  <Select value={leaderId} onValueChange={(v) => { setLeaderId(v); const l = leaders.find((x) => x.id === v); setLeaderName(l?.name ?? ""); }} disabled={locked}>
                    <SelectTrigger><SelectValue placeholder={leaders.length ? "Pick leader" : "No leaders yet"} /></SelectTrigger>
                    <SelectContent>{leaders.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                {isManager && (
                  <div className="flex gap-2 mt-2">
                    <Input
                      value={newLeader}
                      onChange={(e) => setNewLeader(e.target.value)}
                      placeholder={`New ${shift} leader name`}
                      disabled={locked}
                    />
                    <Button
                      type="button" size="sm" variant="outline" disabled={locked || !newLeader.trim()}
                      onClick={async () => {
                        const created = await addLeader.mutateAsync({ name: newLeader, shift });
                        setNewLeader(""); setLeaderId(created.id); setLeaderName(created.name);
                        toast.success("Leader added");
                      }}
                    >Add</Button>
                  </div>
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
                      disabled={false}
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
                  <div className="md:col-span-1 flex items-end">
                    <div className="flex-1">
                      <div className={cn("text-xs font-medium mb-1", effColor(eff))}>{eff.toFixed(0)}%</div>
                      <Progress value={Math.min(100, eff)} className="h-2" />
                    </div>
                  </div>
                  <div className="md:col-span-1 flex items-end justify-end">
                    <Button
                      variant="destructive"
                      size="icon"
                      onClick={() => removeRow(i)}
                      disabled={locked}
                      title="Delete SKU"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
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



      </div>
    </DashboardLayout>
  );
}
