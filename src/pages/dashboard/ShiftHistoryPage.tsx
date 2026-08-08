import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/DashboardLayout";
import { shiftRank } from "@/lib/operationalShift";
import { PageHeader } from "@/components/ui/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Check, Download, Lock, Unlock, Trash2, Upload, Plus, ChevronLeft, ChevronRight, CalendarDays, CalendarRange, ChevronsUpDown, Search, History } from "lucide-react";
import { Tooltip as UITooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { ImportProductionDialog } from "@/components/ImportProductionDialog";
import { InlineActualInput } from "@/components/InlineActualInput";
import { TableCard, TableCardField } from "@/components/ResponsiveTable";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { baseSkuCode } from "@/lib/skuDisplay";
import { format, subDays, startOfMonth, endOfMonth, addMonths, parseISO } from "date-fns";
import { DateRangeFilter, type DateRangePreset } from "@/components/DateRangeFilter";
import { useLines, useLeaders, useSkuProducts } from "@/hooks/useProductionPlanner";
import { useAuth } from "@/contexts/AuthContext";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, ReferenceLine, CartesianGrid } from "recharts";
import XLSX from "xlsx-js-style";
import { OPS_RANGE_KEY } from "@/hooks/useOpsFilters";

/** Drop the customs code ("… [HS CODE:2106909285]") from a catalog name. */
/** date "yyyy-mm-dd" → "MM/YY" for the compact batch mfg/expiry readout. */
function monthMMYY(d: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})/.exec(d ?? "");
  return m ? `${m[2]}/${m[1].slice(2)}` : "";
}

function skuLabel(name: string | null | undefined): string {
  return String(name ?? "").replace(/\[[^\]]*\]/g, "").replace(/\s+/g, " ").trim();
}

/** Searchable SKU picker — the same standard as the operator's Log Production,
 *  instead of a native select listing ~1,500 SKUs with the HS code inline. */
function SkuCombobox({ skus, value, onChange, placeholder = "Pick a SKU", allowAll = false, allLabel = "All SKUs", triggerCodeOnly = false, triggerClassName }: {
  skus: { id: string; code: string; name: string }[];
  value: string; onChange: (id: string) => void; placeholder?: string;
  allowAll?: boolean; allLabel?: string; triggerCodeOnly?: boolean; triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const selected = skus.find((s) => s.id === value);
  const triggerText = allowAll && value === "__all__" ? allLabel
    : selected ? (triggerCodeOnly ? baseSkuCode(selected.code) || selected.code : `${selected.code} — ${skuLabel(selected.name)}`) : placeholder;
  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    const base = query
      ? skus.filter((s) => (s.code ?? "").toLowerCase().includes(query) || (s.name ?? "").toLowerCase().includes(query))
      : skus;
    return base.slice(0, 60);
  }, [skus, q]);
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQ(""); }}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className={cn("w-full justify-between font-normal", triggerClassName)}>
          <span className={cn("truncate", triggerCodeOnly && "font-mono text-xs")}>{triggerText}</span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start" onOpenAutoFocus={(e) => e.preventDefault()}>
        <div className="relative border-b p-2">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name or code..." className="h-9 pl-8" autoComplete="off" />
        </div>
        <div className="max-h-72 overflow-auto">
          {allowAll && !q.trim() && (
            <button type="button" onClick={() => { onChange("__all__"); setOpen(false); setQ(""); }}
              className="flex w-full px-3 py-2 text-left text-sm font-medium hover:bg-accent">
              {allLabel}
            </button>
          )}
          {filtered.length === 0 ? (
            <div className="p-3 text-sm text-muted-foreground">No SKUs found</div>
          ) : filtered.map((s) => (
            <button key={s.id} type="button"
              onClick={() => { onChange(s.id); setOpen(false); setQ(""); }}
              className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-accent">
              <span className="text-sm font-medium leading-tight">{skuLabel(s.name)}</span>
              <span className="font-mono text-xs text-muted-foreground">{s.code}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Inline SKU corrector — admin picks the right catalog SKU straight from the
 *  Production Control grid to fix a wrong pick or a typed free-text code. Saving
 *  sets sku_id and clears any stale sku_code_text so exports/displays stop
 *  falling back to the bad value. Read-only text for everyone else. */
function InlineSkuCell({ itemId, skuId, codeText, displayCode, skus, editable, onSaved }: {
  itemId: string; skuId: string | null; codeText: string | null; displayCode: string;
  skus: { id: string; code: string; name: string }[]; editable: boolean; onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  if (!editable) {
    return displayCode
      ? <span className="font-mono text-xs font-bold whitespace-nowrap">{displayCode}</span>
      : codeText
        ? <span className="italic text-xs text-warning-strong" title="Not in catalog — admin should reconcile the SKU">{codeText}</span>
        : <span className="text-xs">—</span>;
  }
  const save = async (id: string) => {
    if (!id || id === (skuId ?? "")) return;
    setSaving(true);

    // Picking a SKU on a placeholder row creates the shift's first entry. The
    // placeholder id is `${sessionId}-empty`, so the session it belongs to is
    // already in hand — no lookup needed.
    //
    // This row used to look editable and refuse every write: the synthetic id went
    // to PostgREST as a uuid and failed. Guarding the write stopped the error but
    // left a dead end, because nothing else on this screen can add the first SKU
    // to a shift. Line 1 sat empty on both shifts of 29/07 for exactly that reason
    // while its output was recorded in RAG Weekly, so Performance showed the
    // numbers and Production Control showed nothing.
    if (isPlaceholderRow(itemId)) {
      const sessionId = itemId.slice(0, -"-empty".length);
      const { error } = await supabase.from("production_items")
        .insert({ session_id: sessionId, sku_id: id } as never);
      setSaving(false);
      if (error) { toast.error(error.message); return; }
      toast.success("SKU added to this shift — now enter the quantity");
      onSaved();
      return;
    }

    const { error } = await supabase.from("production_items")
      .update({ sku_id: id, sku_code_text: null }).eq("id", itemId);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("SKU corrected");
    onSaved();
  };
  return (
    <div className={cn("w-[150px]", saving && "opacity-50 pointer-events-none")}>
      <SkuCombobox
        skus={skus}
        value={skuId ?? ""}
        onChange={save}
        triggerCodeOnly
        triggerClassName="h-7"
        placeholder={codeText ? `⚠ ${codeText}` : "Pick SKU"}
      />
    </div>
  );
}

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
      {saved && <Check className="h-4 w-4 text-success-strong" />}
    </div>
  );
}

/** Inline numeric input for a numeric session field. Saves on blur/Enter. */
function InlineSessionNumberCell({
  sessionId, field, value, disabled, onSaved, placeholder,
}: {
  sessionId: string; field: "tickets" | "staff_actual" | "staff_planned";
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
      {saved && <Check className="h-4 w-4 text-success-strong" />}
    </div>
  );
}
/** Inline time (HH:mm) for an item's started_at / finished_at. Saves on blur. */
function InlineTimeCell({ itemId, sessionDate, field, value, disabled, onSaved }: {
  itemId: string; sessionDate: string; field: "started_at" | "finished_at";
  value: string | null; disabled?: boolean; onSaved: () => void;
}) {
  const initial = value ? new Date(value).toTimeString().slice(0, 5) : "";
  const [val, setVal] = useState(initial);
  useEffect(() => { setVal(initial); }, [initial]);
  const commit = async () => {
    if (val === initial) return;
    let iso: string | null = null;
    if (val) {
      const [h, m] = val.split(":").map(Number);
      const d = new Date(`${sessionDate}T00:00:00`);
      d.setHours(h, m, 0, 0);
      iso = d.toISOString();
    }
    if (isPlaceholderRow(itemId)) { toast.error("Pick a SKU for this shift first, then this field can be set."); return; }
    const { error } = await supabase.from("production_items").update({ [field]: iso } as never).eq("id", itemId);
    if (error) { toast.error(error.message); setVal(initial); return; }
    onSaved();
  };
  return (
    <input type="time" disabled={disabled} value={val}
      onChange={(e) => setVal(e.target.value)} onBlur={commit}
      className="h-7 w-[92px] rounded border bg-background px-1 text-xs tabular-nums disabled:opacity-60" />
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
    if (isPlaceholderRow(itemId)) { toast.error("Pick a SKU for this shift first, then this field can be set."); return; }
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
      {saved && <Check className="h-4 w-4 text-success-strong" />}
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
    if (isPlaceholderRow(itemId)) { toast.error("Pick a SKU for this shift first, then this field can be set."); return; }
    setSaving(true);
    const { error } = await supabase.from("production_items")
      .update({ actual_qty: n, tickets_unit: unit } as never).eq("id", itemId);
    setSaving(false);
    if (error) { toast.error(error.message); setVal(initial); return; }
    setSaved(true); setTimeout(() => setSaved(false), 1500);
    onSaved();
  };
  return (
    // Just the number.
    //
    // The unit was printed beside every figure — first as "BAGS 1059", then as a
    // suffix — and on a screen where the people reading it already know what the line
    // packs, it was a word repeated on every row for nothing. The unit is still
    // stored, and still set by the Tubs/Bags toggle; it just no longer crowds the
    // column.
    <div className="flex items-center justify-end gap-1.5">
      <Input
        type="number" inputMode="numeric" disabled={disabled || saving} value={val}
        placeholder="0"
        onChange={(e) => setVal(e.target.value)} onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
          if (e.key === "Escape") { setVal(initial); (e.target as HTMLInputElement).blur(); }
        }}
        className="h-8 w-24 text-right px-2 tabular-nums text-sm"
      />
      <span className="w-3">{saved && <Check className="h-3 w-3 text-success-strong" />}</span>
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
  production_items: { id: string; sku_id: string; sku_code_text: string | null; target_qty: number | null; planned_qty: number | null; actual_qty: number | null; notes: string | null; blender_ref: string | null; batch_code: string | null; manufacture_month: string | null; expiry_month: string | null; started_at: string | null; finished_at: string | null; tickets_unit: "tubs" | "bags" | null; production_blender_entries?: { blender_number: number; quantity: number }[] }[];
}


/**
 * A session with no production items still gets one row in the table so the shift
 * is visible; that row carries a synthetic `${sessionId}-empty` id. It is not a
 * real production_items row, so every write must refuse it — sending that id to
 * PostgREST produced `invalid input syntax for type uuid`.
 */
const isPlaceholderRow = (id: string | null | undefined) =>
  typeof id === "string" && id.endsWith("-empty");

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
  const [drPreset, setDrPreset] = useState<DateRangePreset>("today");
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
    // The monthly view drives the dates itself; the control must not still claim
    // "Today" while showing a month.
    setDrPreset("custom");
  }, [viewMode, monthAnchor]);

  // Per-row delete targets the SINGLE SKU item — NOT the whole session. A trash
  // icon that sat on a SKU row but deleted the entire shift once wiped a full
  // line of production by accident.
  const [deletingItem, setDeletingItem] = useState<{ id: string; code: string } | null>(null);
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
  const [addActual, setAddActual] = useState("");

  const addProduction = useMutation({
    mutationFn: async () => {
      if (!addLine) throw new Error("Pick a line");
      if (!addSkuId) throw new Error("Pick a SKU");
      // Target isn't set here — it comes from the RAG Weekly plan.
      const actual = Number(addActual) || 0;
      // Find or create the session for this date/line/shift.
      const { data: existing, error: findErr } = await supabase
        .from("production_sessions").select("id")
        .eq("session_date", addDate).eq("shift", addShift).eq("line", addLine)
        .maybeSingle();
      if (findErr) throw findErr;
      // No lock check here: Add Production is admin/manager/supervisor-only, and
      // those roles intentionally bypass the session lock (operators are still
      // blocked at the RLS level via is_session_locked). Lock/unlock still exists.
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
          .update({ actual_qty: Number(item.actual_qty ?? 0) + actual }).eq("id", item.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("production_items").insert({
          session_id: sessionId, sku_id: addSkuId, target_qty: 0, planned_qty: 0, actual_qty: actual,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shift_history"] });
      toast.success("Production added");
      setAddOpen(false);
      setAddSkuId(""); setAddActual("");
    },
    onError: (e: Error) => toast.error(e.message),
  });


  const { data: sessions = [] } = useQuery({
    queryKey: ["shift_history", from, to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production_sessions")
        .select("id, session_date, shift, line, leader_id, leader_name, staff_planned, staff_actual, tickets, tickets_unit, locked, notes, production_items(id, sku_id, sku_code_text, target_qty, planned_qty, actual_qty, notes, blender_ref, batch_code, manufacture_month, expiry_month, started_at, finished_at, tickets_unit, production_blender_entries(blender_number, quantity))")
        .gte("session_date", from).lte("session_date", to)
        .order("session_date", { ascending: false });
      if (error) throw error;
      // manufacture_month/expiry_month aren't in the generated types yet; cast.
      return (data ?? []) as unknown as SessionRow[];
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
    // The capsule and tablet lines sort before the numbered fillers.
    if (n.includes("capsule") || n.includes("tablet")) return -1;
    const m = n.match(/line\s*(\d+)/);
    if (m) return parseInt(m[1], 10);
    return 200;
  };
  // The line's own name, unaltered.
  //
  // This used to fold anything matching "capsule" or "tablet" into the single word
  // "Tablet", so Capsules Machine 1, Capsules Machine 2 and the Tablet Line all showed
  // as the same entry — three identical options in the filter, and a row that could not
  // be told from another. The names in the database are now consistent, so the display
  // has nothing left to paper over.
  const lineLabel = (name: string) => (name ?? "").trim();
  const sortedLines = useMemo(
    () => [...lines].sort((a, b) => lineRank(a.name) - lineRank(b.name) || a.name.localeCompare(b.name)),
    [lines]
  );
  // A session the operator page auto-creates at shift change but nobody logged
  // anything on: no items, no leader, no tickets, no staff. These show up as an
  // empty NIGHT row on lines with no night plan — hide them.
  const isPhantom = (s: SessionRow) =>
    s.production_items.length === 0 && !s.leader_name && !s.tickets && !s.staff_planned && !s.staff_actual;

  const filtered = useMemo(() => sessions.filter((s) =>
    !isPhantom(s) &&
    (fLine === "__all__" || s.line === fLine) &&
    (fShift === "__all__" || s.shift === fShift) &&
    (fLeader === "__all__" || s.leader_name === fLeader) &&
    (fSku === "__all__" || s.production_items.some((i) => i.sku_id === fSku))
  ).sort((a, b) => {
    if (a.session_date !== b.session_date) return a.session_date < b.session_date ? 1 : -1;
    const lr = lineRank(a.line) - lineRank(b.line);
    if (lr !== 0) return lr;
    const ln = (a.line ?? "").localeCompare(b.line ?? "");
    if (ln !== 0) return ln;
    // Day then Night, WITHIN each line — Line 1 Day, Line 1 Night, Line 2 Day, and so
    // on. The sort carried no shift term at all, so the two came out in whatever order
    // Postgres returned them and it read as Night first.
    //
    // The line is the outer grouping, not the shift: the sheet follows a line down its
    // two shifts before moving to the next line.
    return shiftRank(a.shift) - shiftRank(b.shift);
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

  const delItemMut = useMutation({
    mutationFn: async (itemId: string) => {
      if (isPlaceholderRow(itemId)) throw new Error("This shift has no SKU logged yet — nothing to remove.");
      const { error } = await supabase.from("production_items").delete().eq("id", itemId);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["shift_history"] }); setDeletingItem(null); toast.success("SKU removed"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveItemActual = useMutation({
    mutationFn: async ({ id, actual, unit, prevNotes, sku_id }: { id: string; actual: number; unit: "tubs" | "bags"; prevNotes: string | null; sku_id?: string }) => {
      const stripped = (prevNotes ?? "").replace(/\[unit:(tubs|bags)\]\s*/gi, "").trim();
      const newNotes = `[unit:${unit}]${stripped ? " " + stripped : ""}`;
      const payload: { actual_qty: number; notes: string; sku_id?: string } = { actual_qty: actual, notes: newNotes };
      if (sku_id) payload.sku_id = sku_id;
      if (isPlaceholderRow(id)) throw new Error("Pick a SKU for this shift first, then this field can be set.");
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
    // session_date is a plain yyyy-mm-dd string — reformat to dd/MM/yyyy without
    // Date() so there's no timezone shift.
    const ddmmyyyy = (d: string) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d ?? "");
      return m ? `${m[3]}/${m[2]}/${m[1]}` : (d ?? "");
    };
    // Month (yyyy-mm-dd) → MM/YYYY for the traceability columns.
    const fmtMon = (d: string | null | undefined) => {
      const m = /^(\d{4})-(\d{2})/.exec(d ?? "");
      return m ? `${m[2]}/${m[1]}` : "";
    };
    const rows: (string | number)[][] = [[
      "Date", "Assembly Number", "Work Centre", "Product Code", "",
      "Weight (in Kg)", "QTY", "Start Time", "Finish Time", "Shift",
      "Batch", "Manufactured", "Expiry",
    ]];
    for (const s of filtered) {
      if (s.production_items.length === 0) {
        rows.push([ddmmyyyy(s.session_date), "", lineLabel(s.line), "", "", "", "", "", "", s.shift, "", "", ""]);
        continue;
      }
      for (const i of s.production_items) {
        const sku = skuMap.get(i.sku_id);
        const code = baseSkuCode(sku?.code) || i.sku_code_text || "";
        const name = sku?.name ?? "";
        const grams = parseWeightFromSku(sku?.code ?? "", name, (sku as { weight?: number | null } | undefined)?.weight ?? null);
        rows.push([
          ddmmyyyy(s.session_date),
          i.blender_ref ?? "",
          lineLabel(s.line),
          code,
          name,
          // Numbers stay numbers — the CSV version quoted everything, so Excel
          // read weight and quantity as text and wouldn't sum them.
          grams ? grams / 1000 : "",
          Number(i.actual_qty ?? 0),
          hm(i.started_at),
          hm(i.finished_at),
          s.shift,
          i.batch_code ?? "",
          fmtMon(i.manufacture_month),
          fmtMon(i.expiry_month),
        ]);
      }
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [
      { wch: 12 }, { wch: 18 }, { wch: 12 }, { wch: 16 }, { wch: 42 },
      { wch: 13 }, { wch: 9 }, { wch: 10 }, { wch: 11 }, { wch: 8 },
      { wch: 16 }, { wch: 12 }, { wch: 12 },
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
      <div className="space-y-6">
        <PageHeader
          title="Production Control"
          description={
            viewMode === "monthly"
              ? `Monthly view · ${format(monthAnchor, "MMMM yyyy")}`
              : from === to
                ? `Daily view · ${from}`
                : `${from} → ${to}`
          }
          icon={<History className="h-5 w-5" />}
          actions={
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
          }
        />

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
              onClick={() => { setViewMode("daily"); const t = format(new Date(), "yyyy-MM-dd"); setFrom(t); setTo(t); setDrPreset("today"); }}
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
            { label: "Attainment", value: summary.target > 0 ? `${summary.pct.toFixed(0)}%` : "—", sub: undefined, accent: summary.pct >= 100 ? "text-success-strong" : summary.pct >= 90 ? "text-warning-strong" : "text-destructive-strong" },
            { label: viewMode === "monthly" ? "Days produced" : "Days", value: `${summary.days}`, sub: `${summary.lineCount} line${summary.lineCount === 1 ? "" : "s"}`, accent: "text-foreground" },
          ].map((k) => (
            <Card key={k.label} className="border-l-4 border-l-primary/60 shadow-sm">
              <CardContent className="p-3">
                <div className="text-2xs uppercase tracking-wide text-muted-foreground">{k.label}</div>
                <div className={cn("text-2xl font-bold tabular-nums", k.accent)}>{k.value}</div>
                {k.sub && <div className="text-2xs text-muted-foreground">{k.sub}</div>}
              </CardContent>
            </Card>
          ))}
        </div>


        <Card>
          <CardContent className="p-3 sm:p-4 grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-6">
            {/* The same period control as Maintenance Orders, Quality and Downtime.
                Three raw date inputs — single, from, to — asked the reader to work out
                which of them was in charge, and "single" quietly wrote both. */}
            <div className="col-span-2 sm:col-span-3 md:col-span-3">
              <Label className="text-xs">Period</Label>
              <DateRangeFilter
                className="w-full"
                value={{ from: parseISO(from), to: parseISO(to) }}
                preset={drPreset}
                storageKey={OPS_RANGE_KEY}
                onChange={(r, p) => {
                  setDrPreset(p);
                  // This page speaks yyyy-MM-dd end to end — the queries, the exports
                  // and the month anchor all do — so the range is flattened here
                  // rather than threaded through as Date objects.
                  if (r.from) setFrom(format(r.from, "yyyy-MM-dd"));
                  if (r.to) setTo(format(r.to, "yyyy-MM-dd"));
                }}
              />
            </div>
            <div><Label className="text-xs">Shift</Label>
              <Select value={fShift} onValueChange={setFShift}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="__all__">All shifts</SelectItem><SelectItem value="DAY">Day</SelectItem><SelectItem value="NIGHT">Night</SelectItem></SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Filler Line</Label>
              <Select value={fLine} onValueChange={setFLine}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="__all__">All lines</SelectItem>{sortedLines.map((l) => <SelectItem key={l.id} value={l.name}>{lineLabel(l.name)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Leader</Label>
              <Select value={fLeader} onValueChange={setFLeader}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="__all__">All leaders</SelectItem>{leaders.map((l) => <SelectItem key={l.id} value={l.name}>{l.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="col-span-2 sm:col-span-3 md:col-span-5"><Label className="text-xs">SKU</Label>
              <SkuCombobox skus={skus} value={fSku} onChange={setFSku} allowAll placeholder="All SKUs" />
            </div>
            <div className="col-span-2 sm:col-span-3 md:col-span-1 flex items-end gap-2">
              <Button variant="outline" size="sm" className="flex-1" onClick={() => {
                const t = format(new Date(), "yyyy-MM-dd"); setFrom(t); setTo(t); setDrPreset("today"); setFShift("__all__"); setFLine("__all__"); setFLeader("__all__"); setFSku("__all__");
              }}>Today</Button>
              <Button variant="ghost" size="sm" className="flex-1" onClick={() => {
                setFrom(format(subDays(new Date(), 14), "yyyy-MM-dd")); setTo(format(new Date(), "yyyy-MM-dd")); setDrPreset("custom"); setFShift("__all__"); setFLine("__all__"); setFLeader("__all__"); setFSku("__all__");
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
                {/* Desktop / tablet — full editable table */}
                <div className="hidden md:block max-h-[70vh] overflow-auto">
                  <table className="w-full text-sm border-separate border-spacing-0">
                    <thead className="sticky top-0 z-10 bg-muted text-2xs uppercase tracking-wide">
                      <tr>
                        <th className="text-left px-3 py-2 border-b">Date</th>
                        <th className="text-left px-3 py-2 border-b">Shift</th>
                        <th className="text-left px-3 py-2 border-b">Line</th>
                        <th className="text-left px-3 py-2 border-b">Leader</th>
                        <th className="text-right px-3 py-2 border-b w-28">Team<div className="text-2xs font-normal normal-case text-muted-foreground">on the line</div></th>
                        <th className="text-left px-3 py-2 border-b">SKU</th>
                        <th className="text-left px-3 py-2 border-b max-w-[22rem]">Description</th>
                        <th className="text-left px-3 py-2 border-b">Batch code</th>
                        <th className="text-right px-3 py-2 border-b w-20">Blender</th>
                        <th className="text-right px-3 py-2 border-b w-36">Qty</th>
                        <th className="text-right px-3 py-2 border-b w-24">Weight (g)</th>
                        <th className="text-left px-3 py-2 border-b">Start</th>
                        <th className="text-left px-3 py-2 border-b">Finish</th>
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
                            ? [{ id: `${s.id}-empty`, sku_id: "", target_qty: 0, planned_qty: 0, actual_qty: 0, notes: null, blender_ref: null, batch_code: null, tickets_unit: null as "tubs" | "bags" | null }]
                            : s.production_items;
                          if (s.line !== prevLine) {
                            out.push(
                              <tr key={`sep-${s.id}-${s.line}`} className="bg-primary/5">
                                <td colSpan={14} className="px-3 py-1.5 text-2xs uppercase font-semibold tracking-wider text-primary border-b border-primary/20">
                                  {lineLabel(s.line)}
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
                                  noLeader && "bg-warning/10 hover:bg-warning/20",
                                )}
                              >
                                <td className="px-3 py-2 whitespace-nowrap text-xs tabular-nums">
                                  {s.session_date ? format(new Date(s.session_date), "dd/MM") : "—"}
                                </td>
                                <td className="px-3 py-2">
                                  <Badge
                                    variant="outline"
                                    className={cn(
                                      "text-2xs font-semibold px-1.5 py-0",
                                      s.shift === "DAY"
                                        ? "border-primary/40 bg-primary/10 text-primary"
                                        : "border-purple-500/40 bg-purple-500/10 text-purple-700 dark:text-purple-300",
                                    )}
                                  >
                                    {s.shift}
                                  </Badge>
                                </td>
                                <td className="px-3 py-2 whitespace-nowrap text-xs">
                                  {lineLabel(s.line)}
                                </td>
                                <td className="px-3 py-2">
                                  {idx === 0 ? (
                                    <InlineLeaderCell
                                      sessionId={s.id}
                                      leaderId={s.leader_id}
                                      leaderName={s.leader_name}
                                      leaders={leaders}
                                      disabled={s.locked && !isAdmin}
                                      onSaved={() => qc.invalidateQueries({ queryKey: ["shift_history"] })}
                                    />
                                  ) : null}
                                </td>
                                {/* Headcount belongs to the shift, not to each product
                                    it made — so it is written once, on the session's
                                    first row, the way a merged cell works in the sheet
                                    this replaces. */}
                                <td className="px-3 py-2 text-right">
                                  {idx === 0 ? (
                                    <InlineSessionNumberCell
                                      sessionId={s.id}
                                      field="staff_actual"
                                      value={s.staff_actual}
                                      placeholder="—"
                                      disabled={s.locked && !isAdmin}
                                      onSaved={() => qc.invalidateQueries({ queryKey: ["shift_history"] })}
                                    />
                                  ) : null}
                                </td>
                                <td className="px-3 py-2">
                                  <InlineSkuCell
                                    itemId={i.id}
                                    skuId={i.sku_id}
                                    codeText={i.sku_code_text}
                                    displayCode={baseSkuCode(code)}
                                    skus={skus}
                                    editable={isAdmin && (i.sku_id != null || i.sku_code_text != null)}
                                    onSaved={() => qc.invalidateQueries({ queryKey: ["shift_history"] })}
                                  />
                                </td>
                                <td className="px-3 py-2 max-w-[240px]">
                                  <UITooltip>
                                    <TooltipTrigger asChild>
                                      <div className="truncate text-xs text-muted-foreground">{name}</div>
                                    </TooltipTrigger>
                                    <TooltipContent className="max-w-sm">{name}</TooltipContent>
                                  </UITooltip>
                                </td>
                                <td className="px-3 py-2">
                                  {(i.sku_id || i.sku_code_text) && (isAdmin || !s.locked) ? (
                                    <input
                                      type="text"
                                      defaultValue={i.batch_code ?? ""}
                                      placeholder="B#"
                                      className="w-[80px] h-7 px-1 text-xs font-mono rounded border bg-background"
                                      onBlur={async (e) => {
                                        const v = e.target.value.trim() || null;
                                        if (v === (i.batch_code ?? null)) return;
                                        if (isPlaceholderRow(i.id)) return;
                                        const { error } = await supabase.from("production_items").update({ batch_code: v }).eq("id", i.id);
                                        if (error) toast.error(error.message);
                                        else { toast.success("Batch saved"); qc.invalidateQueries({ queryKey: ["shift_history"] }); }
                                      }}
                                    />
                                  ) : (
                                    <span className="text-xs font-mono">{i.batch_code || "—"}</span>
                                  )}
                                  {(i.manufacture_month || i.expiry_month) && (
                                    <div className="mt-0.5 text-2xs text-muted-foreground whitespace-nowrap">
                                      {i.manufacture_month && <span title="Manufactured">M {monthMMYY(i.manufacture_month)}</span>}
                                      {i.manufacture_month && i.expiry_month && " · "}
                                      {i.expiry_month && <span title="Expiry">E {monthMMYY(i.expiry_month)}</span>}
                                    </div>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-right text-xs tabular-nums whitespace-nowrap">
                                  {blenders.length ? blenders.join(", ") : <span className="text-muted-foreground">—</span>}
                                </td>
                                {/* Right-aligned like the header above it: a quantity
                                    column that reads down the digits is worth more than
                                    one that reads down the labels. */}
                                <td className="px-3 py-2 text-right">
                                  {blenders.length > 0 && !isAdmin ? (
                                    <UITooltip>
                                      <TooltipTrigger asChild>
                                        <span className="cursor-help border-b border-dashed border-muted-foreground/40 tabular-nums text-sm">{a.toLocaleString()}</span>
                                      </TooltipTrigger>
                                      <TooltipContent>Summed from the blender entries — edit the blenders to change it.</TooltipContent>
                                    </UITooltip>
                                  ) : i.id && (i.sku_id || i.sku_code_text) ? (
                                    <InlineUnitQtyInput
                                      itemId={i.id}
                                      unit={effUnit}
                                      value={a}
                                      disabled={s.locked && !isAdmin}
                                      onSaved={() => qc.invalidateQueries({ queryKey: ["shift_history"] })}
                                    />
                                  ) : null}
                                </td>
                                <td className="px-3 py-2 text-right tabular-nums text-xs text-muted-foreground">
                                  {weight ? weight.toLocaleString() : "—"}
                                </td>
                                <td className="px-3 py-2">
                                  {(i.sku_id || i.sku_code_text) ? <InlineTimeCell itemId={i.id} sessionDate={s.session_date} field="started_at" value={i.started_at} disabled={s.locked && !isAdmin} onSaved={() => qc.invalidateQueries({ queryKey: ["shift_history"] })} /> : <span className="text-xs text-muted-foreground">—</span>}
                                </td>
                                <td className="px-3 py-2">
                                  {(i.sku_id || i.sku_code_text) ? <InlineTimeCell itemId={i.id} sessionDate={s.session_date} field="finished_at" value={i.finished_at} disabled={s.locked && !isAdmin} onSaved={() => qc.invalidateQueries({ queryKey: ["shift_history"] })} /> : <span className="text-xs text-muted-foreground">—</span>}
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
                                    {(i.sku_id || i.sku_code_text) && (
                                      <UITooltip>
                                        <TooltipTrigger asChild>
                                          <Button size="icon" variant="ghost" className="h-8 w-8" disabled={s.locked && !isAdmin}
                                            onClick={() => setDeletingItem({ id: i.id, code: skuMap.get(i.sku_id)?.code ?? i.sku_code_text ?? "this SKU" })}>
                                            <Trash2 className="h-4 w-4 text-destructive-strong" />
                                          </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>Delete this SKU row</TooltipContent>
                                      </UITooltip>
                                    )}
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

                {/* Mobile — one card per SKU row */}
                <div className="md:hidden p-3 space-y-2">
                  {filtered.flatMap((s) => {
                    const items = s.production_items.length === 0
                      ? [{ id: `${s.id}-empty`, sku_id: "", target_qty: 0, planned_qty: 0, actual_qty: 0, notes: null, blender_ref: null, batch_code: null, tickets_unit: null as "tubs" | "bags" | null }]
                      : s.production_items;
                    return items.map((i, idx) => {
                      const sku = skuMap.get(i.sku_id);
                      const code = sku?.code ?? "";
                      const name = sku?.name ?? (i.sku_id ? "Unknown" : "—");
                      const noteUnit = i.tickets_unit ?? (/\[unit:tubs\]/i.test(i.notes ?? "") ? "tubs" : /\[unit:bags\]/i.test(i.notes ?? "") ? "bags" : null);
                      const blob = `${code} ${name}`.toLowerCase();
                      const effUnit: "tubs" | "bags" = noteUnit ?? (/tub/.test(blob) ? "tubs" : /bag|sach|pouch/.test(blob) ? "bags" : "bags");
                      const blenders = Array.from(new Set(((i as any).production_blender_entries ?? []).map((b: any) => b.blender_number as number))).sort((x: number, y: number) => x - y);
                      const noLeader = !s.leader_id;
                      return (
                        <TableCard
                          key={`m-${s.id}-${i.id ?? idx}`}
                          className={cn(noLeader && "border-warning/50 bg-warning/5")}
                          title={
                            <span className="flex items-center gap-2">
                              <InlineSkuCell
                                itemId={i.id}
                                skuId={i.sku_id}
                                codeText={i.sku_code_text}
                                displayCode={baseSkuCode(code)}
                                skus={skus}
                                editable={isAdmin && (i.sku_id != null || i.sku_code_text != null)}
                                onSaved={() => qc.invalidateQueries({ queryKey: ["shift_history"] })}
                              />
                              <Badge
                                variant="outline"
                                className={cn(
                                  "text-2xs font-semibold px-1.5 py-0",
                                  s.shift === "DAY"
                                    ? "border-primary/40 bg-primary/10 text-primary"
                                    : "border-purple-500/40 bg-purple-500/10 text-purple-700 dark:text-purple-300",
                                )}
                              >
                                {s.shift}
                              </Badge>
                            </span>
                          }
                          right={
                            <div className="flex items-center gap-1">
                              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => lockMut.mutate({ id: s.id, lock: !s.locked })}>
                                {s.locked ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                              </Button>
                              {(i.sku_id || i.sku_code_text) && (
                                <Button size="icon" variant="ghost" className="h-8 w-8" disabled={s.locked && !isAdmin}
                                  onClick={() => setDeletingItem({ id: i.id, code: skuMap.get(i.sku_id)?.code ?? i.sku_code_text ?? "this SKU" })}>
                                  <Trash2 className="h-4 w-4 text-destructive-strong" />
                                </Button>
                              )}
                            </div>
                          }
                        >
                          <TableCardField label="Date" value={s.session_date ? format(new Date(s.session_date), "dd/MM") : "—"} />
                          <TableCardField label="Line" value={lineLabel(s.line)} />
                          <TableCardField
                            label="Leader"
                            value={idx === 0 ? (
                              <InlineLeaderCell
                                sessionId={s.id}
                                leaderId={s.leader_id}
                                leaderName={s.leader_name}
                                leaders={leaders}
                                disabled={s.locked && !isAdmin}
                                onSaved={() => qc.invalidateQueries({ queryKey: ["shift_history"] })}
                              />
                            ) : (s.leader_name || "—")}
                          />
                          <TableCardField label="Description" value={<span className="text-muted-foreground">{name}</span>} block />
                          <TableCardField
                            label="Batch"
                            value={(i.sku_id || i.sku_code_text) && (isAdmin || !s.locked) ? (
                              <input
                                type="text"
                                defaultValue={i.batch_code ?? ""}
                                placeholder="B#"
                                className="w-full h-8 px-2 text-xs font-mono rounded border bg-background"
                                onBlur={async (e) => {
                                  const v = e.target.value.trim() || null;
                                  if (v === (i.batch_code ?? null)) return;
                                  if (isPlaceholderRow(i.id)) return;
                                        const { error } = await supabase.from("production_items").update({ batch_code: v }).eq("id", i.id);
                                  if (error) toast.error(error.message);
                                  else { toast.success("Batch saved"); qc.invalidateQueries({ queryKey: ["shift_history"] }); }
                                }}
                              />
                            ) : (<span className="font-mono">{i.batch_code || "—"}</span>)}
                          />
                          <TableCardField label="Blender" value={<span className="tabular-nums">{blenders.length ? blenders.join(", ") : "—"}</span>} />
                          {(i.sku_id || i.sku_code_text) && (
                            <TableCardField label="Start" value={<InlineTimeCell itemId={i.id} sessionDate={s.session_date} field="started_at" value={i.started_at} disabled={s.locked && !isAdmin} onSaved={() => qc.invalidateQueries({ queryKey: ["shift_history"] })} />} />
                          )}
                          {(i.sku_id || i.sku_code_text) && (
                            <TableCardField label="Finish" value={<InlineTimeCell itemId={i.id} sessionDate={s.session_date} field="finished_at" value={i.finished_at} disabled={s.locked && !isAdmin} onSaved={() => qc.invalidateQueries({ queryKey: ["shift_history"] })} />} />
                          )}
                          <TableCardField
                            label={blenders.length > 0 && !isAdmin ? "Qty (from blenders)" : "Qty"}
                            value={blenders.length > 0 && !isAdmin ? (
                              <span className="tabular-nums">{Number(i.actual_qty ?? 0).toLocaleString()}</span>
                            ) : i.id && (i.sku_id || i.sku_code_text) ? (
                              <InlineUnitQtyInput
                                itemId={i.id}
                                unit={effUnit}
                                value={Number(i.actual_qty ?? 0)}
                                disabled={s.locked && !isAdmin}
                                onSaved={() => qc.invalidateQueries({ queryKey: ["shift_history"] })}
                              />
                            ) : "—"}
                          />
                        </TableCard>
                      );
                    });
                  })}
                </div>
              </TooltipProvider>
            )}
          </CardContent>
        </Card>




        <AlertDialog open={!!deletingItem} onOpenChange={(o) => !o && setDeletingItem(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this SKU row?</AlertDialogTitle>
              <AlertDialogDescription>
                Removes only <b className="font-mono">{deletingItem?.code}</b> from this shift. The rest of the line's production stays.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => deletingItem && delItemMut.mutate(deletingItem.id)} className="bg-destructive">Delete</AlertDialogAction>
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
                    <SkuCombobox skus={skus} value={editSkuId} onChange={setEditSkuId} />
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
                    <SelectContent>{sortedLines.map((l) => <SelectItem key={l.id} value={l.name}>{lineLabel(l.name)}</SelectItem>)}</SelectContent>
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
                <SkuCombobox skus={skus} value={addSkuId} onChange={setAddSkuId} />
              </div>
              <div><Label className="text-xs">Produced (actual)</Label><Input type="number" inputMode="numeric" value={addActual} onChange={(e) => setAddActual(e.target.value)} placeholder="0" autoFocus /></div>
              <p className="text-2xs text-muted-foreground">Adds this SKU to the shift. If it's already there, the produced quantity is added on top. The target comes from the RAG Weekly plan.</p>
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
