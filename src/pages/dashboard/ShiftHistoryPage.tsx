import { useEffect, useMemo, useState } from "react";
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
import { Check, Download, Lock, Unlock, Trash2, Upload, Plus, ChevronLeft, ChevronRight, CalendarDays, CalendarRange } from "lucide-react";
import { Tooltip as UITooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { ImportProductionDialog } from "@/components/ImportProductionDialog";
import { InlineActualInput } from "@/components/InlineActualInput";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { baseSkuCode } from "@/lib/skuDisplay";
import { format, subDays, startOfMonth, endOfMonth, addMonths } from "date-fns";
import { useLines, useLeaders, useSkuProducts } from "@/hooks/useProductionPlanner";
import { useAuth } from "@/contexts/AuthContext";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, ReferenceLine, CartesianGrid } from "recharts";
import XLSX from "xlsx-js-style";

/** Inline Leader dropdown that saves on selection. Falls back to the stored
 *  leader_name when the leader_id is missing or points to an inactive leader,
 *  so Production Control always shows the leader (matching Performance). */
function InlineLeaderCell({
  sessionId, leaderId, leaderName, leaders, disabled, onSaved,
}: {
  sessionId: string; leaderId: string | null; leaderName: string | null;
  leaders: { id: string; name: string }[]; disabled?: boolean; onSaved: () => void;
}) {
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const save = async (val: string) => {
    const leader = leaders.find((l) => l.id === val);
    setSaving(true);
    const { error } = await supabase.from("production_sessions").update({
      leader_id: leader?.id ?? null, leader_name: leader?.name ?? null,
    }).eq("id", sessionId);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    setSaved(true); setTimeout(() => setSaved(false), 2000);
    onSaved();
  };
  // Ensure the current leader is always selectable so the value renders,
  // even if the leader is no longer in the active list.
  const options = (leaderId && !leaders.some((l) => l.id === leaderId))
    ? [{ id: leaderId, name: leaderName ?? "(inactive)" }, ...leaders]
    : leaders;
  return (
    <div className="flex items-center gap-1">
      <Select value={leaderId ?? ""} onValueChange={save} disabled={disabled || saving}>
        <SelectTrigger className={cn("h-8 w-[140px] text-xs", !leaderId && !leaderName && "text-muted-foreground")}>
          <SelectValue placeholder={leaderName || "-- Select --"} />
        </SelectTrigger>
        <SelectContent>{options.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent>
      </Select>
      {saved && <Check className="h-4 w-4 text-emerald-500" />}
    </div>
  );
}

/** Inline numeric input for a numeric session field. Saves on blur/Enter. */
function InlineSessionNumberCell({
  sessionId, field, value, disabled, onSaved, placeholder,
}: {
  sessionId: string; field: "tickets";
  value: number | null; disabled?: boolean; onSaved: () => void; placeholder?: string;
}) {
  const initial = value == null ? "" : String(value);
  const [val, setVal] = useState(initial);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setVal(initial); }, [initial]);
  const commit = async () => {
    if (val === initial) return;
    const n = val === "" ? null : Number(val);
    if (n !== null && (!Number.isFinite(n) || n < 0)) { setVal(initial); return; }
    setSaving(true);
    const patch: Record<string, number | null> = { [field]: n };
    const { error } = await supabase.from("production_sessions").update(patch as never).eq("id", sessionId);
    setSaving(false);
    if (error) { toast.error(error.message); setVal(initial); return; }
    setSaved(true); setTimeout(() => setSaved(false), 2000);
    onSaved();
  };
  return (
    <div className="flex items-center gap-1 justify-end">
      <Input
        type="number" inputMode="numeric" disabled={disabled || saving} value={val}
        placeholder={placeholder}
        onChange={(e) => setVal(e.target.value)} onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
          if (e.key === "Escape") { setVal(initial); (e.target as HTMLInputElement).blur(); }
        }}
        className="h-8 w-20 text-right px-2 tabular-nums"
      />
      {saved && <Check className="h-4 w-4 text-emerald-500" />}
    </div>
  );
}
/** Inline unit toggle: Tubs / Bags. Per-item. Saves on click. */
function InlineUnitToggle({
  itemId, value, disabled, onSaved,
}: {
  itemId: string; value: "tubs" | "bags" | null; disabled?: boolean; onSaved: () => void;
}) {
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [current, setCurrent] = useState<"tubs" | "bags" | null>(value);
  useEffect(() => { setCurrent(value); }, [value]);
  const pick = async (u: "tubs" | "bags") => {
    if (disabled || saving || u === current) return;
    setSaving(true);
    const { error } = await supabase.from("production_items")
      .update({ tickets_unit: u } as never).eq("id", itemId);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    setCurrent(u);
    setSaved(true); setTimeout(() => setSaved(false), 2000);
    onSaved();
  };
  const btn = (u: "tubs" | "bags", label: string) => (
    <button
      type="button" disabled={disabled || saving}
      onClick={() => pick(u)}
      className={cn(
        "h-8 w-12 text-xs rounded border font-medium transition-colors",
        current === u
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-background hover:bg-muted border-input text-muted-foreground",
        (disabled || saving) && "opacity-50 cursor-not-allowed",
      )}
    >{label}</button>
  );
  return (
    <div className="flex items-center gap-1">
      {btn("tubs", "Tubs")}
      {btn("bags", "Bags")}
      {saved && <Check className="h-4 w-4 text-emerald-500" />}
    </div>
  );
}

/** Inline numeric input tied to a specific unit (tubs|bags). Writes actual_qty
 *  and tickets_unit atomically on blur. If the row currently stores the OTHER
 *  unit, editing this one switches unit and overwrites qty. */
function InlineUnitQtyInput({
  itemId, unit, value, disabled, onSaved,
}: {
  itemId: string; unit: "tubs" | "bags"; value: number;
  disabled?: boolean; onSaved: () => void;
}) {
  const initial = value ? String(value) : "";
  const [val, setVal] = useState(initial);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setVal(initial); }, [initial]);
  const commit = async () => {
    if (val === initial) return;
    const n = val === "" ? 0 : Number(val);
    if (!Number.isFinite(n) || n < 0) { setVal(initial); return; }
    setSaving(true);
    const { error } = await supabase.from("production_items")
      .update({ actual_qty: n, tickets_unit: unit } as never).eq("id", itemId);
    setSaving(false);
    if (error) { toast.error(error.message); setVal(initial); return; }
    setSaved(true); setTimeout(() => setSaved(false), 1500);
    onSaved();
  };
  return (
    <div className="flex items-center gap-1">
      <span className="text-[10px] uppercase text-muted-foreground w-8">{unit === "tubs" ? "Tubs" : "Bags"}</span>
      <Input
        type="number" inputMode="numeric" disabled={disabled || saving} value={val}
        placeholder="0"
        onChange={(e) => setVal(e.target.value)} onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
          if (e.key === "Escape") { setVal(initial); (e.target as HTMLInputElement).blur(); }
        }}
        className="h-8 w-16 text-right px-1 tabular-nums text-xs"
      />
      {saved && <Check className="h-3 w-3 text-emerald-500" />}
    </div>
  );
}




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
  tickets: number | null;
  tickets_unit: "tubs" | "bags" | null;
  locked: boolean; notes: string | null;
  production_items: { id: string; sku_id: string; sku_code_text: string | null; target_qty: number | null; planned_qty: number | null; actual_qty: number | null; notes: string | null; blender_ref: string | null; started_at: string | null; finished_at: string | null; tickets_unit: "tubs" | "bags" | null; production_blender_entries?: { blender_number: number; quantity: number }[] }[];
}


export default function ShiftHistoryPage() {
  const qc = useQueryClient();
  const { role } = useAuth();
  // Who may adjust Production Control — import, correct the SKU, edit actuals.
  // Supervisor manages the floor, so they get the same control as admin/manager.
  const isAdmin = role === "admin" || role === "manager" || role === "maintenance_manager" || role === "supervisor";
  const { data: lines = [] } = useLines();
  const { data: leaders = [] } = useLeaders();
  const { data: skus = [] } = useSkuProducts(false);
  const skuMap = useMemo(() => new Map(skus.map((s) => [s.id, s])), [skus]);

  // Open on today. Daily ops fill in the current day, so a 14-day default just
  // meant clearing it every time. From/To still take any range by hand.
  const [from, setFrom] = useState(format(new Date(), "yyyy-MM-dd"));
  const [to, setTo] = useState(format(new Date(), "yyyy-MM-dd"));
  const [fLine, setFLine] = useState("__all__");
  const [fShift, setFShift] = useState("__all__");
  const [fLeader, setFLeader] = useState("__all__");
  const [fSku, setFSku] = useState("__all__");

  // Daily = single day / custom range; Monthly = a whole month with a summary.
  const [viewMode, setViewMode] = useState<"daily" | "monthly">("daily");
  const [monthAnchor, setMonthAnchor] = useState<Date>(() => new Date());
  useEffect(() => {
    if (viewMode !== "monthly") return;
    setFrom(format(startOfMonth(monthAnchor), "yyyy-MM-dd"));
    setTo(format(endOfMonth(monthAnchor), "yyyy-MM-dd"));
  }, [viewMode, monthAnchor]);

  const [deleting, setDeleting] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<{ id: string; sku_id: string; code: string; target: number; actual: number; notes: string | null } | null>(null);
  const [editActual, setEditActual] = useState<string>("");
  const [editUnit, setEditUnit] = useState<"tubs" | "bags">("tubs");
  const [editSkuId, setEditSkuId] = useState<string>("");
  const [importOpen, setImportOpen] = useState(false);

  // Add a production entry by hand — the alternative to importing an Excel.
  const [addOpen, setAddOpen] = useState(false);
  const [addDate, setAddDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [addLine, setAddLine] = useState("");
  const [addShift, setAddShift] = useState<"DAY" | "NIGHT">("DAY");
  const [addSkuId, setAddSkuId] = useState("");
  const [addTarget, setAddTarget] = useState("");
  const [addActual, setAddActual] = useState("");

  const addProduction = useMutation({
    mutationFn: async () => {
      if (!addLine) throw new Error("Pick a line");
      if (!addSkuId) throw new Error("Pick a SKU");
      const target = Number(addTarget) || 0;
      const actual = Number(addActual) || 0;
      // Find or create the session for this date/line/shift.
      const { data: existing, error: findErr } = await supabase
        .from("production_sessions").select("id, locked")
        .eq("session_date", addDate).eq("shift", addShift).eq("line", addLine)
        .maybeSingle();
      if (findErr) throw findErr;
      if (existing?.locked) throw new Error("That shift is locked — unlock it first");
      let sessionId = existing?.id;
      if (!sessionId) {
        const { data: ins, error } = await supabase
          .from("production_sessions").insert({ session_date: addDate, shift: addShift, line: addLine })
          .select("id").single();
        if (error) throw error;
        sessionId = ins.id;
      }
      // Add the SKU line, or top up if it's already on the shift.
      const { data: item } = await supabase
        .from("production_items").select("id, actual_qty, target_qty")
        .eq("session_id", sessionId).eq("sku_id", addSkuId).maybeSingle();
      if (item) {
        const { error } = await supabase.from("production_items")
          .update({ actual_qty: Number(item.actual_qty ?? 0) + actual, target_qty: target || item.target_qty }).eq("id", item.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("production_items").insert({
          session_id: sessionId, sku_id: addSkuId, target_qty: target, planned_qty: target, actual_qty: actual,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shift_history"] });
      toast.success("Production added");
      setAddOpen(false);
      setAddSkuId(""); setAddTarget(""); setAddActual("");
    },
    onError: (e: Error) => toast.error(e.message),
  });


  const { data: sessions = [] } = useQuery({
    queryKey: ["shift_history", from, to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production_sessions")
        .select("id, session_date, shift, line, leader_id, leader_name, staff_planned, staff_actual, tickets, tickets_unit, locked, notes, production_items(id, sku_id, sku_code_text, target_qty, planned_qty, actual_qty, notes, blender_ref, started_at, finished_at, tickets_unit, production_blender_entries(blender_number, quantity))")
        .gte("session_date", from).lte("session_date", to)
        .order("session_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as SessionRow[];
    },
  });

  // The official target is the RAG Weekly plan — the same source Performance uses.
  // production_items.target_qty is left at 0 on most manual logs, which made the
  // KPI target far too low (12k vs 22k) and inflated attainment to ~191%.
  const { data: ragTargets = [] } = useQuery({
    queryKey: ["shift_history_rag", from, to, fShift, fLine],
    queryFn: async () => {
      let q = supabase.from("rag_weekly_entries").select("entry_date, line, shift, plan_qty")
        .gte("entry_date", from).lte("entry_date", to);
      if (fShift !== "__all__") q = q.eq("shift", fShift);
      if (fLine !== "__all__") q = q.eq("line", fLine);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as { entry_date: string; line: string; shift: string; plan_qty: number }[];
    },
  });
  // RAG has no leader/SKU breakdown, so when either filter is active we can't map
  // the plan to it — fall back to the item target for those narrowed views.
  const useRagTarget = fLeader === "__all__" && fSku === "__all__";
  const ragPlanByLine = useMemo(() => {
    const m = new Map<string, number>();
    if (useRagTarget) for (const r of ragTargets) m.set(r.line, (m.get(r.line) ?? 0) + Number(r.plan_qty ?? 0));
    return m;
  }, [ragTargets, useRagTarget]);
  const ragPlanBySession = useMemo(() => {
    const m = new Map<string, number>();
    if (useRagTarget) for (const r of ragTargets) {
      const k = `${r.entry_date}|${r.line}|${r.shift}`;
      m.set(k, (m.get(k) ?? 0) + Number(r.plan_qty ?? 0));
    }
    return m;
  }, [ragTargets, useRagTarget]);

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

  // Totals for the selected range — powers the KPI bar and the per-line summary.
  const summary = useMemo(() => {
    let actual = 0;
    const days = new Set<string>();
    const perLine = new Map<string, { target: number; actual: number; days: Set<string> }>();
    const sessionTargetByLine = new Map<string, number>();
    for (const s of filtered) {
      days.add(s.session_date);
      const a = s.production_items.reduce((acc, i) => acc + Number(i.actual_qty ?? 0), 0);
      const t = s.production_items.reduce((acc, i) => acc + Number(i.target_qty ?? i.planned_qty ?? 0), 0);
      actual += a;
      sessionTargetByLine.set(s.line, (sessionTargetByLine.get(s.line) ?? 0) + t);
      const pl = perLine.get(s.line) ?? { target: 0, actual: 0, days: new Set<string>() };
      pl.actual += a; pl.days.add(s.session_date);
      perLine.set(s.line, pl);
    }
    // Target per line = RAG plan (official), falling back to the item target for
    // lines the plan doesn't cover or when a leader/SKU filter rules RAG out.
    let target = 0;
    for (const [line, pl] of perLine) {
      pl.target = useRagTarget && ragPlanByLine.has(line) ? ragPlanByLine.get(line)! : (sessionTargetByLine.get(line) ?? 0);
      target += pl.target;
    }
    // Lines with a plan but no production yet still count toward the target (Actual 0).
    if (useRagTarget) for (const [line, t] of ragPlanByLine) {
      if (!perLine.has(line)) { perLine.set(line, { target: t, actual: 0, days: new Set<string>() }); target += t; }
    }
    const lines = [...perLine.entries()]
      .map(([line, v]) => ({ line, target: v.target, actual: v.actual, days: v.days.size, pct: v.target > 0 ? (v.actual / v.target) * 100 : 0 }))
      .sort((a, b) => lineRank(a.line) - lineRank(b.line) || a.line.localeCompare(b.line));
    return { target, actual, days: days.size, lineCount: perLine.size, pct: target > 0 ? (actual / target) * 100 : 0, lines };
  }, [filtered, ragPlanByLine, useRagTarget]);

  const trendData = useMemo(() => {
    const byDate = new Map<string, { date: string; DAY: number[]; NIGHT: number[] }>();
    for (const s of filtered) {
      const ragKey = `${s.session_date}|${s.line}|${s.shift}`;
      const target = useRagTarget && ragPlanBySession.has(ragKey)
        ? ragPlanBySession.get(ragKey)!
        : s.production_items.reduce((a, i) => a + Number(i.target_qty ?? i.planned_qty ?? 0), 0);
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
  }, [filtered, ragPlanBySession, useRagTarget]);


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


  const exportExcel = () => {
    // Mirrors the Production Control spreadsheet layout so the export pastes straight
    // in. The 5th column is intentionally unnamed there (it holds the description).
    const hm = (iso: string | null | undefined) => (iso ? format(new Date(iso), "HH:mm") : "");
    const rows: (string | number)[][] = [[
      "Date", "Assembly Number", "Work Centre", "Product Code", "",
      "Weight (in Kg)", "QTY", "Start Time", "Finish Time", "Shift",
    ]];
    for (const s of filtered) {
      if (s.production_items.length === 0) {
        rows.push([s.session_date, "", s.line, "", "", "", "", "", "", s.shift]);
        continue;
      }
      for (const i of s.production_items) {
        const sku = skuMap.get(i.sku_id);
        const code = baseSkuCode(sku?.code) || i.sku_code_text || "";
        const name = sku?.name ?? "";
        const grams = parseWeightFromSku(sku?.code ?? "", name, (sku as { weight?: number | null } | undefined)?.weight ?? null);
        rows.push([
          s.session_date,
          i.blender_ref ?? "",
          s.line,
          code,
          name,
          // Numbers stay numbers — the CSV version quoted everything, so Excel
          // read weight and quantity as text and wouldn't sum them.
          grams ? grams / 1000 : "",
          Number(i.actual_qty ?? 0),
          hm(i.started_at),
          hm(i.finished_at),
          s.shift,
        ]);
      }
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [
      { wch: 12 }, { wch: 18 }, { wch: 12 }, { wch: 16 }, { wch: 42 },
      { wch: 13 }, { wch: 9 }, { wch: 10 }, { wch: 11 }, { wch: 8 },
    ];
    ws["!freeze"] = { xSplit: "0", ySplit: "1" };
    for (let c = 0; c < rows[0].length; c++) {
      const addr = XLSX.utils.encode_cell({ r: 0, c });
      if (ws[addr]) {
        ws[addr].s = {
          fill: { patternType: "solid", fgColor: { rgb: "1E3A5F" } },
          font: { bold: true, color: { rgb: "FFFFFF" } },
        };
      }
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Production Control");
    XLSX.writeFile(wb, `production-control-${format(new Date(), "yyyy-MM-dd")}.xlsx`);
  };

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold">Production Control</h1>
            <p className="text-sm text-muted-foreground">
              {viewMode === "monthly"
                ? `Monthly view · ${format(monthAnchor, "MMMM yyyy")}`
                : from === to
                  ? `Daily view · ${from}`
                  : `${from} → ${to}`}
            </p>
          </div>
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
            {isAdmin && (
              <Button size="sm" onClick={() => { setAddLine(fLine !== "__all__" ? fLine : (sortedLines[0]?.name ?? "")); setAddDate(from); setAddOpen(true); }}>
                <Plus className="h-4 w-4 mr-1" />Add Production
              </Button>
            )}
            <Button variant="outline" onClick={exportExcel}><Download className="h-4 w-4 mr-1" />Export Excel</Button>
          </div>
        </div>

        <ImportProductionDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          onImported={() => qc.invalidateQueries({ queryKey: ["shift_history"] })}
        />

        {/* View toggle + month navigator */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="inline-flex rounded-lg border bg-muted/40 p-0.5">
            <Button
              size="sm"
              variant={viewMode === "daily" ? "default" : "ghost"}
              className="gap-1.5"
              onClick={() => { setViewMode("daily"); const t = format(new Date(), "yyyy-MM-dd"); setFrom(t); setTo(t); }}
            >
              <CalendarDays className="h-4 w-4" /> Daily
            </Button>
            <Button
              size="sm"
              variant={viewMode === "monthly" ? "default" : "ghost"}
              className="gap-1.5"
              onClick={() => setViewMode("monthly")}
            >
              <CalendarRange className="h-4 w-4" /> Monthly
            </Button>
          </div>
          {viewMode === "monthly" && (
            <div className="flex items-center gap-1.5">
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setMonthAnchor(addMonths(monthAnchor, -1))}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="min-w-[130px] text-center text-sm font-semibold">{format(monthAnchor, "MMMM yyyy")}</span>
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setMonthAnchor(addMonths(monthAnchor, 1))}>
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setMonthAnchor(new Date())}>This month</Button>
            </div>
          )}
        </div>

        {/* KPI summary for the selected period */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Produced", value: Math.round(summary.actual).toLocaleString(), sub: undefined as string | undefined, accent: "text-primary" },
            { label: "Target", value: Math.round(summary.target).toLocaleString(), sub: undefined, accent: "text-foreground" },
            { label: "Attainment", value: summary.target > 0 ? `${summary.pct.toFixed(0)}%` : "—", sub: undefined, accent: summary.pct >= 100 ? "text-emerald-600" : summary.pct >= 90 ? "text-amber-600" : "text-destructive" },
            { label: viewMode === "monthly" ? "Days produced" : "Days", value: `${summary.days}`, sub: `${summary.lineCount} line${summary.lineCount === 1 ? "" : "s"}`, accent: "text-foreground" },
          ].map((k) => (
            <Card key={k.label} className="border-l-4 border-l-primary/60 shadow-sm">
              <CardContent className="p-3">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{k.label}</div>
                <div className={cn("text-2xl font-bold tabular-nums", k.accent)}>{k.value}</div>
                {k.sub && <div className="text-[11px] text-muted-foreground">{k.sub}</div>}
              </CardContent>
            </Card>
          ))}
        </div>


        <Card>
          <CardContent className="p-3 sm:p-4 grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-6">
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
            <div className="col-span-2 sm:col-span-3 md:col-span-5"><Label className="text-xs">SKU</Label>
              <Select value={fSku} onValueChange={setFSku}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="__all__">All SKUs</SelectItem>{skus.map((s) => <SelectItem key={s.id} value={s.id}>{s.code} — {s.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="col-span-2 sm:col-span-3 md:col-span-1 flex items-end gap-2">
              <Button variant="outline" size="sm" className="flex-1" onClick={() => {
                const t = format(new Date(), "yyyy-MM-dd"); setFrom(t); setTo(t); setFShift("__all__"); setFLine("__all__"); setFLeader("__all__"); setFSku("__all__");
              }}>Today</Button>
              <Button variant="ghost" size="sm" className="flex-1" onClick={() => {
                setFrom(format(subDays(new Date(), 14), "yyyy-MM-dd")); setTo(format(new Date(), "yyyy-MM-dd")); setFShift("__all__"); setFLine("__all__"); setFLeader("__all__"); setFSku("__all__");
              }}>Last 14 days</Button>
            </div>

          </CardContent>
        </Card>



        <Card>
          <CardContent className="p-0">
            {filtered.length === 0 ? (
              <div className="p-6 text-muted-foreground text-center">No sessions</div>
            ) : (
              <TooltipProvider delayDuration={200}>
                <div className="max-h-[70vh] overflow-auto">
                  <table className="w-full text-sm border-separate border-spacing-0">
                    <thead className="sticky top-0 z-10 bg-muted text-[11px] uppercase tracking-wide">
                      <tr>
                        <th className="text-left px-3 py-2 border-b">Date</th>
                        <th className="text-left px-3 py-2 border-b">Shift</th>
                        <th className="text-left px-3 py-2 border-b">Line</th>
                        <th className="text-left px-3 py-2 border-b">Leader</th>
                        <th className="text-left px-3 py-2 border-b">SKU</th>
                        <th className="text-left px-3 py-2 border-b">Description</th>
                        <th className="text-left px-3 py-2 border-b">Batch code</th>
                        <th className="text-left px-3 py-2 border-b">Blender</th>
                        <th className="text-right px-3 py-2 border-b">Qty</th>
                        <th className="text-right px-3 py-2 border-b">Weight (g)</th>
                        <th className="text-right px-3 py-2 border-b w-24">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const out: React.ReactNode[] = [];
                        let prevLine: string | null = null;
                        let zebra = 0;
                        filtered.forEach((s) => {
                          const items = s.production_items.length === 0
                            ? [{ id: `${s.id}-empty`, sku_id: "", target_qty: 0, planned_qty: 0, actual_qty: 0, notes: null, blender_ref: null, tickets_unit: null as "tubs" | "bags" | null }]
                            : s.production_items;
                          if (s.line !== prevLine) {
                            out.push(
                              <tr key={`sep-${s.id}-${s.line}`} className="bg-primary/5">
                                <td colSpan={11} className="px-3 py-1.5 text-[11px] uppercase font-semibold tracking-wider text-primary border-b border-primary/20">
                                  {s.line}
                                </td>
                              </tr>
                            );
                            prevLine = s.line;
                          }
                          items.forEach((i, idx) => {
                            const sku = skuMap.get(i.sku_id);
                            const code = sku?.code ?? "";
                            const name = sku?.name ?? (i.sku_id ? "Unknown" : "—");
                            const weight = parseWeightFromSku(code, name, (sku as { weight?: number | null } | undefined)?.weight ?? null);
                            const a = Number(i.actual_qty ?? 0);
                            const blob = `${code} ${name}`.toLowerCase();
                            const isTubHint = /tub/.test(blob);
                            const isBagHint = /bag|sach|pouch/.test(blob);
                            const noteUnit = i.tickets_unit ?? (/\[unit:tubs\]/i.test(i.notes ?? "") ? "tubs" : /\[unit:bags\]/i.test(i.notes ?? "") ? "bags" : null);
                            const effUnit: "tubs" | "bags" = noteUnit ?? (isTubHint ? "tubs" : isBagHint ? "bags" : "bags");
                            const blenders = Array.from(new Set((i.production_blender_entries ?? []).map((b) => b.blender_number))).sort((x, y) => x - y);
                            const noLeader = !s.leader_id;
                            const rowBg = zebra % 2 === 0 ? "bg-background" : "bg-muted/20";
                            zebra++;
                            out.push(
                              <tr
                                key={`${s.id}-${i.id ?? idx}`}
                                className={cn(
                                  "border-b transition-colors hover:bg-muted/40",
                                  rowBg,
                                  noLeader && "bg-yellow-500/10 hover:bg-yellow-500/20",
                                )}
                              >
                                <td className="px-3 py-2 whitespace-nowrap text-xs tabular-nums">
                                  {s.session_date ? format(new Date(s.session_date), "dd/MM") : "—"}
                                </td>
                                <td className="px-3 py-2">
                                  <Badge
                                    variant="outline"
                                    className={cn(
                                      "text-[10px] font-semibold px-1.5 py-0",
                                      s.shift === "DAY"
                                        ? "border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300"
                                        : "border-purple-500/40 bg-purple-500/10 text-purple-700 dark:text-purple-300",
                                    )}
                                  >
                                    {s.shift}
                                  </Badge>
                                </td>
                                <td className="px-3 py-2 whitespace-nowrap text-xs">
                                  {s.line.replace(/\s*filler\s*/i, " ").replace(/\s+/g, " ").trim()}
                                </td>
                                <td className="px-3 py-2">
                                  {idx === 0 ? (
                                    <InlineLeaderCell
                                      sessionId={s.id}
                                      leaderId={s.leader_id}
                                      leaderName={s.leader_name}
                                      leaders={leaders}
                                      disabled={s.locked}
                                      onSaved={() => qc.invalidateQueries({ queryKey: ["shift_history"] })}
                                    />
                                  ) : null}
                                </td>
                                <td className="px-3 py-2 font-mono text-xs font-bold whitespace-nowrap">{baseSkuCode(code) || (i.sku_code_text ? <span className="italic font-normal text-amber-600 dark:text-amber-400" title="Not in catalog — admin should reconcile the SKU">{i.sku_code_text}</span> : "—")}</td>
                                <td className="px-3 py-2 max-w-[240px]">
                                  <UITooltip>
                                    <TooltipTrigger asChild>
                                      <div className="truncate text-xs text-muted-foreground">{name}</div>
                                    </TooltipTrigger>
                                    <TooltipContent className="max-w-sm">{name}</TooltipContent>
                                  </UITooltip>
                                </td>
                                <td className="px-3 py-2">
                                  {i.sku_id && !s.locked ? (
                                    <input
                                      type="text"
                                      defaultValue={i.blender_ref ?? ""}
                                      placeholder="B#"
                                      className="w-[60px] h-7 px-1 text-xs font-mono rounded border bg-background"
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
                                <td className="px-3 py-2 text-xs tabular-nums whitespace-nowrap">
                                  {blenders.length ? blenders.join(", ") : "—"}
                                </td>
                                <td className="px-3 py-2">
                                  {i.id && i.sku_id ? (
                                    <InlineUnitQtyInput
                                      itemId={i.id}
                                      unit={effUnit}
                                      value={a}
                                      disabled={s.locked}
                                      onSaved={() => qc.invalidateQueries({ queryKey: ["shift_history"] })}
                                    />
                                  ) : null}
                                </td>
                                <td className="px-3 py-2 text-right tabular-nums text-xs text-muted-foreground">
                                  {weight ? weight.toLocaleString() : "—"}
                                </td>
                                <td className="px-3 py-2">
                                  <div className="flex items-center justify-end gap-1">
                                    <UITooltip>
                                      <TooltipTrigger asChild>
                                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => lockMut.mutate({ id: s.id, lock: !s.locked })}>
                                          {s.locked ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>{s.locked ? "Unlock row" : "Lock row"}</TooltipContent>
                                    </UITooltip>
                                    <UITooltip>
                                      <TooltipTrigger asChild>
                                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setDeleting(s.id)}>
                                          <Trash2 className="h-4 w-4 text-destructive" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>Delete session</TooltipContent>
                                    </UITooltip>
                                  </div>
                                </td>
                              </tr>
                            );
                          });
                        });
                        return out;
                      })()}
                    </tbody>
                  </table>
                </div>
              </TooltipProvider>
            )}
          </CardContent>
        </Card>




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

        {/* Add production by hand — no Excel needed. */}
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Add production</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <div><Label className="text-xs">Date</Label><Input type="date" value={addDate} onChange={(e) => setAddDate(e.target.value)} /></div>
                <div><Label className="text-xs">Line</Label>
                  <Select value={addLine} onValueChange={setAddLine}>
                    <SelectTrigger><SelectValue placeholder="Line" /></SelectTrigger>
                    <SelectContent>{sortedLines.map((l) => <SelectItem key={l.id} value={l.name}>{l.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label className="text-xs">Shift</Label>
                  <Select value={addShift} onValueChange={(v) => setAddShift(v as "DAY" | "NIGHT")}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="DAY">Day</SelectItem><SelectItem value="NIGHT">Night</SelectItem></SelectContent>
                  </Select>
                </div>
              </div>
              <div><Label className="text-xs">SKU</Label>
                <Select value={addSkuId} onValueChange={setAddSkuId}>
                  <SelectTrigger><SelectValue placeholder="Pick a SKU" /></SelectTrigger>
                  <SelectContent className="max-h-72">{skus.map((s) => <SelectItem key={s.id} value={s.id}>{s.code} — {s.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label className="text-xs">Target (optional)</Label><Input type="number" inputMode="numeric" value={addTarget} onChange={(e) => setAddTarget(e.target.value)} placeholder="0" /></div>
                <div><Label className="text-xs">Produced (actual)</Label><Input type="number" inputMode="numeric" value={addActual} onChange={(e) => setAddActual(e.target.value)} placeholder="0" autoFocus /></div>
              </div>
              <p className="text-[11px] text-muted-foreground">Adds this SKU to the shift. If it's already there, the produced quantity is added on top.</p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button onClick={() => addProduction.mutate()} disabled={addProduction.isPending || !addLine || !addSkuId}>Add</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      </div>
    </DashboardLayout>
  );
}
