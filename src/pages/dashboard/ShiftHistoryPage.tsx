import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/DashboardLayout";
import { shiftRank } from "@/lib/operationalShift";
import { canAdjustProductionControl } from "@/lib/productionControlAccess";
import { PageHeader } from "@/components/ui/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ControlPlate, ControlRow, ControlField, ControlDivider, ControlReadout } from "@/components/ui/ControlPlate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Check, Download, Lock, Unlock, Trash2, Upload, Plus, MoreHorizontal, ChevronsUpDown, Search, History, Printer } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip as UITooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { ImportProductionDialog } from "@/components/ImportProductionDialog";
import { InlineActualInput } from "@/components/InlineActualInput";
import { TableCard, TableCardField } from "@/components/ResponsiveTable";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { baseSkuCode } from "@/lib/skuDisplay";
import { bayInk, bayPaper, baySpine, bayWash } from "@/lib/lineBay";
import { hasLeader } from "@/lib/sessionLeader";
import { printElementAsDocument } from "@/lib/printDocument";
import { ReportPrintHeader } from "@/components/reports/ReportPrintHeader";
import { format, parseISO } from "date-fns";
import { DateRangeFilter, type DateRangePreset } from "@/components/DateRangeFilter";
import { useLines, useLeaders, useSkuProducts } from "@/hooks/useProductionPlanner";
import { useAuth } from "@/contexts/AuthContext";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, ReferenceLine, CartesianGrid } from "recharts";
import XLSX from "xlsx-js-style";
import { OPS_RANGE_KEY } from "@/hooks/useOpsFilters";
import { inRunOrder, shiftTimeToIso, runTimings, formatRunMinutes, wallClock } from "@/lib/productionTime";

/** Drop the customs code ("… [HS CODE:2106909285]") from a catalog name. */
/** date "yyyy-mm-dd" → "MM/YY" for the compact batch mfg/expiry readout. */
function monthMMYY(d: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})/.exec(d ?? "");
  return m ? `${m[2]}/${m[1].slice(2)}` : "";
}

/**
 * O filete entre grupos de colunas.
 *
 * Catorze colunas todas separadas por um filete são papel quadriculado: o filete deixa
 * de dizer nada porque está em todo o sítio. Aqui só marca as juntas — QUANDO (data,
 * turno) · QUEM (linha, líder, equipa) · O QUÊ (SKU, descrição, lote) · QUANTO
 * (blender, quantidade, peso) · RELÓGIO (início, fim) · acções — e é isso que dá à
 * folha a leitura que a torna folha e não lista.
 */
const RULE = "border-l border-border/70";

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
          <span className={cn("truncate", triggerCodeOnly && "font-figure text-xs")}>{triggerText}</span>
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
              <span className="font-figure text-xs text-muted-foreground">{s.code}</span>
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
      ? <span className="font-figure text-xs font-bold whitespace-nowrap">{displayCode}</span>
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
/**
 * Inline time (HH:mm) for an item's started_at / finished_at. Saves on blur.
 *
 * The time belongs to the SESSION, not to the calendar day its date happens to name.
 * This cell used to stamp `sessionDate` with the typed hour and no more, which is
 * right on a day shift and wrong for half of every night: a night session dated 17/09
 * runs to 06:00 on the 18th, so a 01:20 start typed here was saved as 17/09 01:20 —
 * seventeen hours BEFORE the 18:40 run above it, a negative duration, and a run that
 * counts as nothing on every screen that measures minutes. `shiftTimeToIso` already
 * knew this; this cell was the one place still doing it by hand.
 */
function InlineTimeCell({ itemId, sessionDate, shift, field, value, disabled, onSaved }: {
  itemId: string; sessionDate: string; shift: string | null; field: "started_at" | "finished_at";
  value: string | null; disabled?: boolean; onSaved: () => void;
}) {
  const initial = wallClock(value) ?? "";
  const [val, setVal] = useState(initial);
  useEffect(() => { setVal(initial); }, [initial]);
  const commit = async () => {
    if (val === initial) return;
    const iso = val ? shiftTimeToIso(val, sessionDate, shift) : null;
    if (val && !iso) { toast.error("That is not a time this shift can hold."); setVal(initial); return; }
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
  production_items: { id: string; sku_id: string; sku_code_text: string | null; target_qty: number | null; planned_qty: number | null; actual_qty: number | null; notes: string | null; blender_ref: string | null; batch_code: string | null; manufacture_month: string | null; expiry_month: string | null; started_at: string | null; finished_at: string | null; display_order: number | null; created_at: string | null; tickets_unit: "tubs" | "bags" | null; production_blender_entries?: { blender_number: number; quantity: number }[] }[];
}


/**
 * A session with no production items still gets one row in the table so the shift
 * is visible; that row carries a synthetic `${sessionId}-empty` id. It is not a
 * real production_items row, so every write must refuse it — sending that id to
 * PostgREST produced `invalid input syntax for type uuid`.
 */
const isPlaceholderRow = (id: string | null | undefined) =>
  typeof id === "string" && id.endsWith("-empty");

/** As horas como o ecrã as escreve — a folha e a fila têm de dizer o mesmo minuto. */
const hhmm = (v: string | null | undefined) => wallClock(v) ?? "—";

/**
 * A descrição sem o código pautal.
 *
 * O nome do SKU no catálogo traz o HS CODE agarrado — "CRITICAL WHEY 2KG CARAMEL LATTE
 * [HS CODE:2106108070]". No ecrã está truncado e ninguém dá por ele; em papel dobrava
 * a altura de metade das filas e roubava um terço da coluna à única informação que ali
 * se lê. É um código de alfândega: não tem nada que fazer numa folha de turno, que é
 * lida por quem enche as linhas e não por quem exporta.
 */
const cleanDescription = (name: string) =>
  name.replace(/\s*\[\s*HS\s*CODE[^\]]*\]/gi, "").replace(/\s{2,}/g, " ").trim();

/**
 * A régua da folha: o que cada coluna tem de aguentar, em pixels de papel.
 *
 * Uma A4 deitada com os 10 mm de margem que o `@media print` do `index.css` impõe dá
 * 277 mm — 1047 px de layout — e a tabela é `table-layout: fixed`. Numa tabela fixa uma
 * célula mais larga do que a sua coluna NÃO a alarga: transborda por cima da coluna
 * seguinte, sem erro e sem aviso. Foi assim que o `NEUBFWP900WCP` se imprimiu por cima
 * do `NOT FOR EU —`, que o `M 09/26 · E 09/28` passou por cima dos números da mistura, e
 * que um SKU escrito à mão ("Essential protein banana milkshake", 216 px) atravessou a
 * descrição inteira e saiu com o travessão da descrição a riscá-lo ao meio.
 *
 * Por isso a largura não se adivinha. Cada número aqui é o que a coluna precisa medido
 * com os dados reais de um dia de sete linhas, e o `need` ao lado é essa medida: quem
 * apertar uma coluna abaixo do seu `need` volta a pôr texto por cima de texto.
 *
 * Só a descrição é que não tem número — fica com o que sobra, que é como uma coluna de
 * texto corrido se comporta. E as três colunas que podem receber texto sem limite (o
 * SKU, a descrição e o lote) passam à linha em vez de transbordar: numa folha de turno
 * uma palavra partida em duas linhas lê-se, uma palavra impressa por cima da do lado
 * não. A linha e o líder também: os dois vêm de tabelas onde alguém escreve o nome, e
 * uma coluna medida contra "Rafael Tosta" e "Tablet Line" não é uma promessa sobre o
 * nome seguinte. Passar à linha é a folga que os pixels de reserva só fingiam dar.
 *
 * ── As juntas (`joint`) ───────────────────────────────────────────────────────────
 *
 * Caber não é ler-se. Com treze colunas separadas todas pelo mesmo meio milímetro de ar,
 * `R26215  2  2,160  500  06:20  10:20` chega ao olho como um número só, e é essa a
 * queixa de quem recebe a folha: o lote, a mistura, a quantidade, o peso e as horas
 * estão todos juntos.
 *
 * O `joint` é o `RULE` do ecrã, em papel — o mesmo filete nas mesmas juntas, para que
 * quem lê a folha na parede e quem lê o ecrã leiam a mesma tabela: QUANDO (data, turno)
 * · QUEM (linha, líder, equipa) · O QUÊ (SKU, descrição, lote) · QUANTO (mistura,
 * quantidade, peso) · RELÓGIO (início, fim). Um filete e um pouco mais de ar à esquerda
 * da primeira coluna de cada grupo; quatro filetes e não treze, porque um filete entre
 * todas as colunas é papel quadriculado e aí volta a não dizer nada.
 *
 * A junta não engorda a coluna. Os 10 px de ar à esquerda saem dos 6 px que ela tinha à
 * direita — 10 e 2, que continuam a dar os mesmos 12 — e é por isso que pôr ou tirar uma
 * junta não mexe em número nenhum desta régua. Não é asseio: os 277 mm não têm 4 px por
 * junta para dar, e quem os desse dava-os à custa da descrição, que é a única coluna que
 * vive do que as outras deixam. A régua já esteve 16 px acima do que a folha tem.
 */
export const PC_COLUMNS = [
  { key: "rail",    width: 9,   need: 0,  joint: false }, // a faixa da baía: 9 px de cor, não de texto
  { key: "date",    width: 46,  need: 43, joint: false }, // "11/09" e o cabeçalho DATE
  { key: "shift",   width: 55,  need: 52, joint: false }, // a chapa NIGHT com o seu bordo
  { key: "line",    width: 67,  need: 64, joint: true  }, // "Tablet Line", sem o `pr-3` que a junta agora dá
  { key: "leader",  width: 74,  need: 71, joint: false }, // "Rafael Tosta"
  { key: "team",    width: 42,  need: 39, joint: false }, // o cabeçalho TEAM, que é mais largo que o número
  { key: "sku",     width: 94,  need: 91, joint: true  }, // "NEUBFWP900WCP"; o texto livre passa à linha
  { key: "desc",    width: 0,   need: 0,  joint: false }, // o que sobra
  { key: "batch",   width: 97,  need: 94, joint: false }, // "M 09/26 · E 09/28", que é mais largo que o lote
  { key: "blender", width: 80,  need: 77, joint: true  }, // "11, 12, 13" — três misturas numa linha; à quarta passa à linha
  { key: "qty",     width: 59,  need: 56, joint: false },
  { key: "weight",  width: 69,  need: 66, joint: false }, // "WEIGHT (g)" numa linha só
  { key: "start",   width: 46,  need: 43, joint: true  },
  { key: "finish",  width: 48,  need: 45, joint: false },
] as const;

/**
 * A margem que cada coluna leva acima do que mediu.
 *
 * Três pixels, e não zero. A régua tinha sido medida com a IBM Plex Mono carregada, e
 * a IBM Plex Mono vem do `fonts.googleapis.com` — numa máquina da nave atrás de um
 * proxy que não o deixe passar, a folha imprime-se na face de recurso. O avanço muda
 * um pixel por coluna, o que chegava para pôr a **data** e o **fim** já em -1 px: com
 * `overflow: hidden` o "11/09" e o "17:45" perdiam a última coluna de pixels do
 * último algarismo, sem nada que o explicasse.
 *
 * Três pixels são três vezes a variação medida entre a face real e as de recurso
 * (Courier New, Menlo, Consolas, a genérica). O `need` de cada coluna aqui é já o da
 * face de recurso — o número pior, não o melhor.
 */
export const PC_COLUMN_MARGIN_PX = 3;

/** O que sobra para a descrição, e o aviso se algum dia não sobrar nada. */
export const PC_PRINTABLE_PX = 1047;
export const PC_FIXED_PX = PC_COLUMNS.reduce((a, c) => a + c.width, 0);

/** A classe da junta, lida da régua — para que a régua e a folha não possam discordar. */
const PC_JOINTS = new Set<string>(PC_COLUMNS.filter((c) => c.joint).map((c) => c.key));
const joint = (key: string) => (PC_JOINTS.has(key) ? "pc-joint" : "");

/** O plano ao lado do feito, na mesma língua nos três sítios em que a folha o diz. */
function AgainstPlan({ qty, plan, pct }: { qty: number; plan: number; pct: number | null }) {
  return (
    <span className="whitespace-nowrap font-figure">
      <span className="font-bold">{Math.round(qty).toLocaleString()}</span>
      {plan > 0 && <span className="text-black/55"> / {Math.round(plan).toLocaleString()}</span>}
      {pct != null && <span className="pl-2 font-bold">{pct.toFixed(0)}%</span>}
    </span>
  );
}

/**
 * A folha em papel.
 *
 * ── Porque é escrita outra vez, e não clonada do ecrã ──────────────────────────────
 *
 * Metade das colunas por que se lê um turno são campos que se editam no sítio: o Líder
 * e o SKU são `Select`, a Equipa, a Qty e as horas são `input`. O `printDocument` clona
 * o DOM e imprime o clone — e o clone não leva React nenhum consigo. Um `Select` é um
 * `button`, e a folha esconde os botões; um `input` controlado tem o valor na
 * propriedade, e um clone só copia atributos. Imprimir o ecrã dava uma página com ar
 * de estar certa e com o Líder, o SKU, a Equipa, a Qty e as horas em branco.
 *
 * ── Que objecto isto é ────────────────────────────────────────────────────────────
 *
 * Não é um relatório: é o registo do turno, lido às sete da manhã no handover e depois
 * afixado na parede da nave. Daí as três decisões que governam o resto:
 *
 * 1. A COR IDENTIFICA A LINHA, e mais nada. A faixa pintada à esquerda de cada bloco é
 *    a mesma baía que está pintada no chão da nave e no ecrã — a mesma cor da lista do
 *    quadro do Trello. Num maço de nove páginas, é por ela que se folheia até à Line 6.
 *    O atingimento NÃO leva cor: uma folha de parede é fotocopiada, e um verde que
 *    fotocopia cinzento como o vermelho é pior do que não ter cor nenhuma. Diz-se por
 *    peso e pelo plano escrito ao lado.
 *
 * 2. AS TRÊS VOZES DA CASA, em papel. Archivo nas chapas (o dia, a baía, os títulos de
 *    coluna), Inter no que é nome, IBM Plex Mono em tudo o que é algarismo. Os
 *    algarismos tabulares são o que faz uma coluna de quantidades ler-se de cima a
 *    baixo em vez de dançar.
 *
 * 3. NADA PARTE A MEIO DE UMA PALAVRA. A folha do `printDocument` traz
 *    `word-break: break-word` para as tabelas largas dos outros ecrãs, e aqui
 *    escrevia "LEADE R", "TE AM" e "Marci o". As colunas têm largura fixa e o
 *    cabeçalho não quebra; só a descrição é que pode passar à linha.
 */
/** A banda de uma baía: o que a linha fez naquele dia, e o relógio que levou a fazê-lo. */
export type BayBand = {
  qty: number; plan: number; skus: number; shifts: Set<string>; noLeader: boolean;
  /** Minutos a correr, somados das corridas que se conseguem ler. */
  runMin: number;
  /** Minutos entre corridas, dentro de cada turno. */
  idleMin: number;
  /** Corridas que começaram antes de a anterior acabar. */
  overlaps: number;
  /** Filas com SKU de que não sai duração nenhuma — sem hora, ou com um par que não se lê. */
  untimed: number;
};

export function ProductionControlPrintSheet({
  sessions, bands, summary, skuMap, leaders, periodLabel, shiftLabel, filtersLabel,
}: {
  sessions: SessionRow[];
  bands: {
    day: Map<string, { qty: number; plan: number; lines: Set<string> }>;
    bay: Map<string, BayBand>;
  };
  summary: { target: number; actual: number; days: number; lineCount: number; pct: number };
  skuMap: Map<string, { code: string; name: string; weight?: number | null }>;
  leaders: { id: string; name: string }[];
  periodLabel: string;
  shiftLabel: string;
  filtersLabel?: string;
}) {
  const leaderById = new Map(leaders.map((l) => [l.id, l.name]));
  const cell = "px-1.5 py-[3.5px] align-top";
  const num = `${cell} text-right font-figure whitespace-nowrap`;

  const rows: React.ReactNode[] = [];
  let prevDate: string | null = null;
  let prevLine: string | null = null;

  sessions.forEach((s) => {
    if (s.session_date !== prevDate) {
      const d = bands.day.get(s.session_date);
      const pct = d && d.plan > 0 ? (d.qty / d.plan) * 100 : null;
      rows.push(
        <tr key={`p-day-${s.session_date}`} className="pc-plate">
          <td className="pc-rail" />
          {/* O dia e o que o dia deu, nos dois extremos da mesma régua: a data à
              esquerda, o total encostado à direita, na coluna onde todos os totais
              da folha caem uns por baixo dos outros. */}
          <td colSpan={13} className="border-t-[1.2pt] border-black px-1.5 pb-[3px] pt-[7px]">
            <div className="flex items-baseline justify-between gap-4">
              <span className="font-display text-[9.5pt] font-bold uppercase leading-none tracking-[0.08em]">
                {format(parseISO(s.session_date), "EEE dd MMM yyyy")}
              </span>
              <span className="flex items-baseline gap-4 text-[8pt]">
                <span className="text-[6.5pt] text-black/55">
                  {d?.lines.size ?? 0} {(d?.lines.size ?? 0) === 1 ? "line" : "lines"}
                </span>
                <AgainstPlan qty={d?.qty ?? 0} plan={d?.plan ?? 0} pct={pct} />
              </span>
            </div>
          </td>
        </tr>,
      );
      prevDate = s.session_date;
      prevLine = null;
    }

    if (s.line !== prevLine) {
      const b = bands.bay.get(`${s.session_date}|${s.line}`);
      const pct = b && b.plan > 0 ? (b.qty / b.plan) * 100 : null;
      rows.push(
        <tr key={`p-bay-${s.session_date}-${s.line}`} className="pc-plate">
          {/* A faixa da baía começa aqui e desce por todas as filas do bloco. */}
          <td className="pc-rail" style={{ backgroundColor: bayPaper(s.line) }} />
          <td colSpan={13} className="border-t border-black/25 px-1.5 py-[3px]">
            <div className="flex items-baseline justify-between gap-4">
              <span className="flex items-baseline gap-2.5">
                <span className="font-display text-[8pt] font-bold uppercase tracking-[0.1em]">
                  {(s.line ?? "").trim()}
                </span>
                <span className="text-[6.5pt] text-black/55">
                  {b?.skus ?? 0} SKU{b && b.shifts.size > 0 ? ` · ${[...b.shifts].join(" + ").toLowerCase()}` : ""}
                </span>
                {/* O relógio da linha. Vai na banda e não numa coluna: a régua da folha
                    está cheia — as treze larguras fixas deixam 261 px à descrição e o
                    chão dela são 260 — e uma banda é uma fila inteira, que não paga
                    largura a ninguém. */}
                {b && b.runMin > 0 && (
                  <span className="font-figure text-[6.5pt] text-black/55">
                    {formatRunMinutes(b.runMin)} running{b.idleMin > 0 ? ` · ${formatRunMinutes(b.idleMin)} between runs` : ""}
                  </span>
                )}
                {b && b.overlaps > 0 && (
                  <span className="border border-black px-1 text-[6pt] font-bold uppercase tracking-[0.08em]">
                    {b.overlaps} overlap{b.overlaps === 1 ? "" : "s"}
                  </span>
                )}
                {b && b.untimed > 0 && (
                  <span className="text-[6.5pt] text-black/55">{b.untimed} untimed</span>
                )}
                {/* O andon da folha: a única palavra que aqui se escreve por não haver
                    algo. Vai a bold e com bordo, que é o que sobrevive à fotocópia. */}
                {b?.noLeader && (
                  <span className="border border-black px-1 text-[6pt] font-bold uppercase tracking-[0.08em]">
                    no leader
                  </span>
                )}
              </span>
              <span className="text-[7.5pt]">
                <AgainstPlan qty={b?.qty ?? 0} plan={b?.plan ?? 0} pct={pct} />
              </span>
            </div>
          </td>
        </tr>,
      );
      prevLine = s.line;
    }

    // Uma sessão sem itens continua a ocupar uma fila: um turno que não registou nada
    // é uma leitura, e desaparecer da folha faria dele um turno que não houve.
    const items = s.production_items.length > 0 ? inRunOrder(s.production_items, s.shift) : [null];
    items.forEach((i, idx) => {
      const sku = i ? skuMap.get(i.sku_id) : undefined;
      const code = sku?.code ?? "";
      const name = sku?.name ?? (i?.sku_id ? "Unknown" : "—");
      const blenders = i
        ? Array.from(new Set((i.production_blender_entries ?? []).map((b) => b.blender_number))).sort((x, y) => x - y)
        : [];
      const weight = i ? parseWeightFromSku(code, name, sku?.weight ?? null) : 0;
      const leaderName = s.leader_name ?? (s.leader_id ? leaderById.get(s.leader_id) ?? null : null);
      const skuText = i ? (baseSkuCode(code) || i.sku_code_text || "—") : "—";
      // Um travessão não é uma descrição: é a ausência de uma. Vazio para que a fila
      // saiba que não há segunda coluna para escrever.
      const rawDesc = i ? cleanDescription(name) : "";
      const descText = rawDesc === "—" ? "" : rawDesc;
      return rows.push(
        <tr key={`p-row-${s.id}-${i?.id ?? idx}`} className="border-t border-black/12">
          <td className="pc-rail" style={{ backgroundColor: bayPaper(s.line) }} />
          <td className={`${cell} font-figure whitespace-nowrap`}>{format(parseISO(s.session_date), "dd/MM")}</td>
          <td className={`${cell} whitespace-nowrap`}>
            {/* Turno por peso e não por cor: a noite é a chapa cheia, o dia é o papel.
                É a mesma chapa que a fila tem no ecrã. */}
            {s.shift === "DAY" ? (
              <span className="font-display text-[6pt] font-bold uppercase tracking-[0.08em] text-black/55">day</span>
            ) : (
              <span className="border border-black px-1 font-display text-[6pt] font-bold uppercase tracking-[0.08em]">
                night
              </span>
            )}
          </td>
          {/* O eco da faixa, à altura dos olhos: a mesma decisão que a fila tem no
              ecrã. A cor diz a linha e a chapa confirma-a; escrever o nome outra vez a
              cheio em cada fila era dizer três vezes a mesma coisa. Fica calado — quem
              grita é a faixa —, mas fica, porque uma página que comece a meio de uma
              baía não traz a chapa consigo. */}
          <td className={`${cell} ${joint("line")} pc-wrap text-black/55`}>{(s.line ?? "").trim()}</td>
          {/* O líder e a equipa são do turno, não de cada SKU que ele fez: escrevem-se
              uma vez, na primeira fila da sessão, como uma célula fundida na folha que
              este ecrã substituiu. */}
          <td className={`${cell} pc-wrap`}>{idx === 0 ? (leaderName ?? "—") : ""}</td>
          <td className={num}>{idx === 0 ? (s.staff_actual ?? "—") : ""}</td>
          {/* O SKU e a descrição são duas colunas quando há duas coisas para dizer.
              Quando o item entrou sem catálogo o que vai no SKU não é um código: é o
              `sku_code_text` que alguém escreveu à mão — "Essential protein banana
              milkshake" — e a descrição ao lado fica um travessão. Numa coluna de
              100 px esse nome cai em três linhas ao lado de uma célula vazia. Então
              não há duas colunas: há uma, com a largura das duas, e o travessão que
              não dizia nada desaparece. */}
          {descText ? (
            <>
              <td className={`${cell} ${joint("sku")} pc-wrap font-figure font-bold`}>{skuText}</td>
              <td className={`${cell} pc-wrap`}>{descText}</td>
            </>
          ) : (
            <td colSpan={2} className={`${cell} ${joint("sku")} pc-wrap font-figure font-bold`}>{skuText}</td>
          )}
          <td className={`${cell} pc-wrap font-figure`}>
            {i?.batch_code || "—"}
            {i && (i.manufacture_month || i.expiry_month) && (
              <div className="text-[6pt] text-black/55">
                {i.manufacture_month && <span>M {monthMMYY(i.manufacture_month)}</span>}
                {i.manufacture_month && i.expiry_month && " · "}
                {i.expiry_month && <span>E {monthMMYY(i.expiry_month)}</span>}
              </div>
            )}
          </td>
          {/* Sem misturas, célula vazia. Uma coluna cheia de travessões é ruído com a
              forma de informação.

              Alinhada à ESQUERDA, ao contrário das três quantidades que a rodeiam: o
              número da mistura não é uma grandeza, é o nome de uma máquina. Encostada à
              direita ficava a um espaço da quantidade, e `2  2,160` lia-se como um
              número só — era metade do "está tudo junto". Encostada à esquerda, o
              filete e a coluna inteira separam-nas.

              E passa à linha. A coluna dá para três misturas — `11, 12, 13`, que é o que
              uma ordem da Line 4 gasta — e a quarta desce para a linha de baixo. Com
              `whitespace-nowrap` não descia: a lista era cortada pelo `overflow: hidden`
              e a folha saía a dizer `10, 11, 12,` ao lado de uma quantidade que tinha
              sido feita em quatro. Uma mistura a menos numa folha de rastreio é o
              contrário do que a folha existe para fazer. */}
          <td className={`${cell} ${joint("blender")} pc-wrap font-figure`}>
            {blenders.length ? blenders.join(", ") : ""}
          </td>
          <td className={`${num} font-bold`}>{i ? Number(i.actual_qty ?? 0).toLocaleString() : "—"}</td>
          <td className={`${num} text-black/55`}>{weight ? weight.toLocaleString() : ""}</td>
          <td className={`${cell} ${joint("start")} font-figure whitespace-nowrap`}>{i ? hhmm(i.started_at) : "—"}</td>
          <td className={`${cell} font-figure whitespace-nowrap`}>{i ? hhmm(i.finished_at) : "—"}</td>
        </tr>,
      );
    });
  });

  const th = "border-b border-black px-1.5 pb-[3px] text-left font-display text-[6pt] font-bold uppercase tracking-[0.1em] text-black/70";
  const thNum = `${th} text-right`;

  return (
    <div id="production-control-print" className="hidden print:block">
      {/* Regras próprias da folha, e não do `printDocument`, porque só valem aqui.
          Ficam dentro do bloco para o clone as levar consigo, e todas prefixadas pelo
          id: um `<style>` aplica-se ao documento inteiro, esteja onde estiver. */}
      <style>{`
        #production-control-print { color: #000; }
        #production-control-print table { table-layout: fixed; width: 100%; border-collapse: collapse; }
        /* A folha do printDocument parte palavras a meio para caber as tabelas largas
           dos outros ecrãs. Aqui as larguras são dadas, e partir "LEADER" em "LEADE R"
           é o que fazia isto parecer um despejo de folha de cálculo. */
        #production-control-print th, #production-control-print td { word-break: normal; overflow-wrap: normal; }
        /* Um título de coluna nunca passa à linha: a régua tem a largura que ele pede,
           e um "WEIGHT (g)" em duas linhas empurrava a tabela toda para baixo. */
        #production-control-print th { white-space: nowrap; }
        /* O travão de fim de linha. Numa tabela fixa o transbordo é SILENCIOSO: a
           célula pinta-se por cima da vizinha e a folha sai com ar de estar certa.
           Cortar é pior do que caber e melhor do que escrever por cima — e não chega
           a acontecer, porque as colunas que podem crescer levam .pc-wrap. */
        #production-control-print td, #production-control-print th { overflow: hidden; }
        #production-control-print .pc-wrap { overflow-wrap: anywhere; }
        /* As juntas. Um filete a 28% de preto — o suficiente para o olho parar nele e
           pouco para não competir com os fios que separam as filas, e o que sobrevive à
           fotocópia sem virar um traço a sério. O ar à esquerda vale tanto como o
           filete: um filete colado ao algarismo separa menos do que um milímetro de
           branco.

           E esse ar NÃO é ar novo. Os 10 px da esquerda saem dos 6+6 px que a coluna já
           tinha à volta: 10 à esquerda e 2 à direita, que continuam a dar 12. Uma junta
           que engordasse a coluna tirava os pixels à descrição — 4 px por junta, 16 nas
           quatro — e a descrição é a única coluna que vive do que sobra. Do lado de cá
           o aperto ainda ajuda: a seguir a uma junta vem sempre outra coluna do MESMO
           grupo (a linha e o líder, o SKU e a descrição, a mistura e a quantidade, o
           início e o fim), e duas colunas que respondem à mesma pergunta lêem-se melhor
           juntas do que afastadas. */
        #production-control-print .pc-joint { border-left: 0.5pt solid rgba(0,0,0,0.28); padding-left: 10px; padding-right: 2px; }
        /* No cabeçalho o filete sobe até ao topo da chapa, senão a junta começa a meio
           da tabela e as colunas do título ficam por agrupar. */
        #production-control-print thead th.pc-joint { border-left-color: rgba(0,0,0,0.45); }
        /* A faixa da baía: 2,5 mm de cor a descer o bloco todo, encostada à margem. */
        #production-control-print .pc-rail { width: 9px; padding: 0; border: 0; }
        /* Uma chapa sozinha no fim da página é uma chapa sem o que ela anuncia. */
        #production-control-print .pc-plate { break-after: avoid; break-inside: avoid; }
        #production-control-print tr { break-inside: avoid; }
        /* O total é a última fila da folha e não um rodapé: um tfoot repete-se em
           todas as páginas, e o total do período aparecia ao fundo de cada uma. */
        #production-control-print .pc-total td { border-top: 1.2pt solid #000; }
        /* E nunca sozinho. Faltando 23 px à última página, a folha virava a página
           para imprimir uma em branco com o total ao cimo e mais nada — que é o
           aspecto de um documento que se enganou, não o de um que acabou. Leva a
           última fila consigo. */
        #production-control-print .pc-total { break-before: avoid; }
      `}</style>

      <ReportPrintHeader
        title="Production Control"
        periodLabel={periodLabel}
        shift={shiftLabel}
        filtersLabel={filtersLabel}
      />

      {/* O marcador da placa de comando, em papel e pela mesma gramática: a chapa
          gravada por cima, o algarismo por baixo, o plano em letra de fundo ao lado.
          Na placa confirma o que os manípulos escolheram; aqui é a primeira pergunta
          de quem recebe a folha na mão. */}
      <div className="mb-3 flex items-end gap-10">
        <div>
          <div className="font-display text-[6pt] font-bold uppercase leading-none tracking-[0.12em] text-black/60">
            Produced
          </div>
          <div className="mt-1 flex items-baseline gap-1.5 leading-none">
            <span className="font-figure text-[15pt] font-bold">{Math.round(summary.actual).toLocaleString()}</span>
            {summary.target > 0 && (
              <span className="font-figure text-[8pt] text-black/55">/ {Math.round(summary.target).toLocaleString()}</span>
            )}
          </div>
        </div>
        <div>
          <div className="font-display text-[6pt] font-bold uppercase leading-none tracking-[0.12em] text-black/60">
            Attainment
          </div>
          <div className="mt-1 leading-none">
            <span className="font-figure text-[15pt] font-bold">
              {summary.target > 0 ? `${summary.pct.toFixed(0)}%` : "—"}
            </span>
          </div>
        </div>
        <div className="pb-[2px] text-[7pt] text-black/60">
          {summary.days} day{summary.days === 1 ? "" : "s"} · {summary.lineCount} line
          {summary.lineCount === 1 ? "" : "s"}
        </div>
      </div>

      {sessions.length === 0 ? (
        <p className="text-[8pt]">No production recorded for this period.</p>
      ) : (
        <table className="text-[7.5pt] leading-[1.25]">
          <colgroup>
            {PC_COLUMNS.map((c) => (
              <col key={c.key} style={c.width ? { width: `${c.width}px` } : undefined} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className="pc-rail" />
              <th className={th}>Date</th>
              <th className={th}>Shift</th>
              <th className={`${th} ${joint("line")}`}>Line</th>
              <th className={th}>Leader</th>
              <th className={thNum}>Team</th>
              <th className={`${th} ${joint("sku")}`}>SKU</th>
              <th className={th}>Description</th>
              <th className={th}>Batch</th>
              {/* Alinhado à esquerda como a coluna que encabeça: são nomes de máquinas. */}
              <th className={`${th} ${joint("blender")}`}>Blender</th>
              <th className={thNum}>Qty</th>
              {/* `uppercase` transformava "(g)" em "(G)", que é giga. Numa folha de
                  fábrica a unidade escreve-se como a unidade é. */}
              <th className={thNum}>Weight <span className="normal-case">(g)</span></th>
              <th className={`${th} ${joint("start")}`}>Start</th>
              <th className={th}>Finish</th>
            </tr>
          </thead>
          <tbody>
            {rows}
            <tr className="pc-total">
              <td className="pc-rail" />
              <td colSpan={8} className="px-1.5 pt-[6px] text-right font-display text-[7pt] font-bold uppercase tracking-[0.1em]">
                Total for the period
              </td>
              {/* O total ocupa a mistura e a quantidade, e não só a quantidade.
                  Encosta à direita no mesmo sítio — a régua da folha não se mexe — mas
                  tem 134 px por onde crescer em vez de 56. A coluna da quantidade foi
                  medida contra `11,119`, que é uma ordem; o total de um mês é `186,009`,
                  que são 62 px a 9pt, e ia cortado pelo `overflow: hidden` sem dizer
                  nada. Um total truncado é a única linha da folha que ninguém confere,
                  porque é a linha por onde se confere tudo o resto. */}
              <td colSpan={2} className="px-1.5 pt-[6px] text-right font-figure text-[9pt] font-bold whitespace-nowrap">
                {Math.round(summary.actual).toLocaleString()}
              </td>
              <td colSpan={3} className="px-1.5 pt-[6px] font-figure text-[7.5pt] whitespace-nowrap">
                <span className="text-black/55">/ {Math.round(summary.target).toLocaleString()}</span>
                {summary.target > 0 && <span className="pl-2 font-bold">{summary.pct.toFixed(0)}%</span>}
              </td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function ShiftHistoryPage() {
  const qc = useQueryClient();
  const { role } = useAuth();
  // Who may adjust Production Control — import, correct the SKU, edit actuals.
  // The list lives in `productionControlAccess` with the reasoning and a test:
  // it was written out here and the production office admin was missing from it,
  // which left him the one cell on the row he could not touch. See the file.
  const isAdmin = canAdjustProductionControl(role);
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

  // O período não conta como filtro: é sempre alguma coisa, e "limpar" o período não
  // quer dizer nada. Estes quatro é que estão ligados ou desligados, e o botão que os
  // repõe só existe quando há alguma coisa para repor.
  const hasFilter = fShift !== "__all__" || fLine !== "__all__" || fLeader !== "__all__" || fSku !== "__all__";

  // Per-row delete targets the SINGLE SKU item — NOT the whole session. A trash
  // icon that sat on a SKU row but deleted the entire shift once wiped a full
  // line of production by accident.
  const [deletingItem, setDeletingItem] = useState<{ id: string; code: string } | null>(null);
  const [editingItem, setEditingItem] = useState<{ id: string; sku_id: string; code: string; target: number; actual: number; notes: string | null } | null>(null);
  const [editActual, setEditActual] = useState<string>("");
  const [editUnit, setEditUnit] = useState<"tubs" | "bags">("tubs");
  const [editSkuId, setEditSkuId] = useState<string>("");
  const [importOpen, setImportOpen] = useState(false);

  // A folha de impressão só existe enquanto se imprime: são as mesmas centenas de
  // filas do ecrã escritas uma segunda vez, e mantê-las montadas fazia cada tecla
  // dos filtros pagar duas folhas em vez de uma.
  const [printing, setPrinting] = useState(false);

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
        .select("id, session_date, shift, line, leader_id, leader_name, staff_planned, staff_actual, tickets, tickets_unit, locked, notes, production_items(id, sku_id, sku_code_text, target_qty, planned_qty, actual_qty, notes, blender_ref, batch_code, manufacture_month, expiry_month, started_at, finished_at, display_order, created_at, tickets_unit, production_blender_entries(blender_number, quantity))")
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

  /**
   * Os totais de cada faixa do mapa: o dia por fora, a baía por dentro.
   *
   * A folha estava ordenada por dia e depois por linha, mas não escrevia nem uma coisa
   * nem outra: para saber onde acabava o 23/08 e começava o 22/08 era preciso ler a
   * coluna da data fila a fila, e o total de uma linha no dia — que é a pergunta que se
   * faz a este ecrã — não estava em parte nenhuma. O `summary` já contava por linha, mas
   * para todo o período de uma vez, e ninguém o mostrava.
   *
   * O plano vem da RAG, como no resto da página, e cai para o alvo do item quando a RAG
   * não cobre a sessão. Sem plano não há atingimento: uma percentagem contra zero é
   * precisão inventada.
   *
   * A baía conta também o RELÓGIO da linha naquele dia: os minutos a correr e os
   * minutos entre corridas. Os intervalos somam-se DENTRO de cada sessão — entre o fim
   * de uma corrida e o início da seguinte — e nunca de um turno para o outro: entre o
   * fim do dia e o início da noite não há mudança de trabalho nenhuma, há um turno a
   * acabar. Uma sobreposição (um intervalo negativo) não desconta tempo parado; conta-se
   * à parte, porque o que ela é não é tempo, é um erro de leitura.
   */
  const bands = useMemo(() => {
    const day = new Map<string, { qty: number; plan: number; lines: Set<string> }>();
    const bay = new Map<string, BayBand>();
    // O mesmo para o período inteiro: quantas corridas há, e de quantas não sai número.
    const clock = { runs: 0, untimed: 0 };
    for (const s of filtered) {
      const qty = s.production_items.reduce((a, i) => a + Number(i.actual_qty ?? 0), 0);
      const itemPlan = s.production_items.reduce((a, i) => a + Number(i.target_qty ?? i.planned_qty ?? 0), 0);
      const plan = ragPlanBySession.get(`${s.session_date}|${s.line}|${s.shift}`) ?? itemPlan;

      const d = day.get(s.session_date) ?? { qty: 0, plan: 0, lines: new Set<string>() };
      d.qty += qty; d.plan += plan; d.lines.add(s.line);
      day.set(s.session_date, d);

      const k = `${s.session_date}|${s.line}`;
      const b = bay.get(k) ?? { qty: 0, plan: 0, skus: 0, shifts: new Set<string>(), noLeader: false, runMin: 0, idleMin: 0, overlaps: 0, untimed: 0 };
      b.qty += qty; b.plan += plan; b.skus += s.production_items.length;
      b.shifts.add(s.shift);
      const ordered = inRunOrder(s.production_items, s.shift);
      runTimings(ordered, s.shift).forEach((t, n) => {
        b.runMin += t.runMin ?? 0;
        if (t.sinceMin != null && t.sinceMin > 0) b.idleMin += t.sinceMin;
        if (t.sinceMin != null && t.sinceMin < 0) b.overlaps += 1;
        // Uma fila sem produto não é uma corrida por temporizar, é uma fila em branco.
        const real = ordered[n] && (ordered[n].sku_id || ordered[n].sku_code_text);
        if (!real) return;
        clock.runs += 1;
        if (t.runMin == null) { b.untimed += 1; clock.untimed += 1; }
      });
      // Pela pergunta única, e não por `leader_id`: o tablet da nave grava o líder
      // pelo nome e não pela ligação, e a placa acusava "sem líder" numa baía cuja
      // fila, dois centímetros abaixo, tinha o nome dele escrito.
      if (!hasLeader(s)) b.noLeader = true;
      bay.set(k, b);
    }
    return { day, bay, clock };
  }, [filtered, ragPlanBySession]);

  /** A tinta do atingimento — os mesmos três degraus da régua, um só sítio. */
  const pctTone = (pct: number | null) =>
    pct == null ? "text-muted-foreground"
      : pct >= 100 ? "text-success-strong"
      : pct >= 90 ? "text-warning-strong"
      : "text-destructive-strong";


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


  // O período e os filtros como se escrevem no cabeçalho da folha — impressa, ela
  // sai da sala, e uma folha que não diz o que exclui lê-se como se fosse tudo.
  const periodLabel = from === to
    ? format(parseISO(from), "dd/MM/yyyy")
    : `${format(parseISO(from), "dd/MM/yyyy")} — ${format(parseISO(to), "dd/MM/yyyy")}`;
  const shiftLabel = fShift === "__all__" ? "All shifts" : fShift === "DAY" ? "Day" : "Night";
  const filtersLabel = [
    fLine !== "__all__" ? `Line: ${lineLabel(fLine)}` : null,
    fLeader !== "__all__" ? `Leader: ${fLeader}` : null,
    fSku !== "__all__" ? `SKU: ${skuMap.get(fSku)?.code ?? fSku}` : null,
  ].filter(Boolean).join(" · ") || undefined;

  const printSheet = async () => {
    // Monta a folha, deixa o browser pintá-la, e só então a clona: o
    // `printElementAsDocument` lê o DOM, e um elemento que ainda não foi renderizado
    // não tem DOM nenhum para ler.
    setPrinting(true);
    await new Promise((r) => window.setTimeout(r, 120));
    try {
      const el = document.getElementById("production-control-print");
      if (!el) throw new Error("The print sheet was not ready.");
      // Landscape: são treze colunas, e no papel uma tabela não rola — o que passa
      // da margem perde-se, e o que se perderia era o lado das horas.
      await printElementAsDocument(el, "Production Control", { landscape: true });
    } catch (err) {
      toast.error((err as Error)?.message ?? "Could not open the print dialog.");
    } finally {
      setPrinting(false);
    }
  };

  const exportExcel = () => {
    // Mirrors the Production Control spreadsheet layout so the export pastes straight
    // in. The 5th column is intentionally unnamed there (it holds the description).
    const hm = (iso: string | null | undefined) => wallClock(iso) ?? "";
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
      for (const i of inRunOrder(s.production_items, s.shift)) {
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
        {/* O cabeçalho numa linha, e as acções por ordem de quem as usa.

            Eram quatro botões com quase o mesmo peso — três `outline` e um cheio — e
            dois deles, o `Export Template` e o `Import Production`, são tarefas de
            arranque que se fazem uma vez e depois nunca mais. Ocupavam a linha de topo
            todos os dias para servir um dia. Fica à vista a única acção que se repete
            num turno, e o resto vive atrás do `⋯`.

            Quem não é admin não vê menu nenhum: tem as suas duas acções à vista, e um
            menu de um item é uma gaveta com uma coisa lá dentro.

            O `Print` fica à vista para os dois papéis e no mesmo sítio — antes do `⋯`
            para quem o tem, ao lado do `Export` para quem não o tem. A folha do dia
            imprime-se a cada turno, para a nave e para a reunião da manhã; escondê-la
            atrás do menu punha uma tarefa diária ao lado das que se fazem uma vez. */}
        <PageHeader
          dense
          module="Production"
          title="Production Control"
          icon={<History className="h-5 w-5" />}
          actions={
            isAdmin ? (
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={() => { setAddLine(fLine !== "__all__" ? fLine : (sortedLines[0]?.name ?? "")); setAddDate(from); setAddOpen(true); }}>
                  <Plus className="h-4 w-4 mr-1" />Add production
                </Button>
                <Button variant="outline" size="sm" onClick={printSheet} disabled={printing || filtered.length === 0}>
                  <Printer className="h-4 w-4 mr-1" />Print
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon" className="h-9 w-9" aria-label="More actions">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuItem onSelect={() => setImportOpen(true)}>
                      <Upload className="mr-2 h-4 w-4" />Import production
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => void exportExcel()}>
                      <Download className="mr-2 h-4 w-4" />Export to Excel
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={async () => {
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
                      <Download className="mr-2 h-4 w-4" />Download import template
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={printSheet} disabled={printing || filtered.length === 0}>
                  <Printer className="h-4 w-4 mr-1" />Print
                </Button>
                <Button variant="outline" size="sm" onClick={exportExcel}>
                  <Download className="h-4 w-4 mr-1" />Export to Excel
                </Button>
              </div>
            )
          }
        />

        <ImportProductionDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          onImported={() => qc.invalidateQueries({ queryKey: ["shift_history"] })}
        />

        {/* A placa de comando: o que estou a ver, e quanto deu.

            Este ecrã perguntava o período em três sítios. Um alternador `Daily |
            Monthly`, um navegador de mês com setas próprias, dois botões de atalho — e
            este campo, que já sabia fazer o trabalho dos três e ainda tinha por dentro
            o `Today`, o `Yesterday`, o `Current shift`, os `7/30/90 dias`, o `This
            month` e o `All time`. Três manípulos no mesmo veio, e nenhum a saber dos
            outros: escolher `Daily` reescrevia as datas, escolher no calendário não
            mexia no alternador, e era daí que vinha a sensação de que a folha não
            obedecia. Ficou a pergunta uma vez, com as setas que andam com o período
            pelo seu próprio tamanho.

            O `Today` fazia duas coisas numa tecla — repunha o dia E limpava turno,
            linha, líder e SKU. A primeira é um preset e já lá está dentro; a segunda é
            o `Clear filters`, que só aparece quando há alguma coisa para limpar.

            O marcador do lado direito era uma régua de quatro cartões uma faixa acima.
            Uma régua serve para comparar medidas entre si; estas não se comparam umas
            com as outras, confirmam o que os manípulos ao lado escolheram — e é ao lado
            deles que valem alguma coisa. */}
        <ControlPlate>
          <ControlRow>
            <ControlField label="Period" className="min-w-[20rem] flex-1">
              <DateRangeFilter
                className="w-full"
                steppable
                value={{ from: parseISO(from), to: parseISO(to) }}
                preset={drPreset}
                storageKey={OPS_RANGE_KEY}
                onChange={(r, p) => {
                  setDrPreset(p);
                  // This page speaks yyyy-MM-dd end to end — the queries, the exports
                  // and the grouping all do — so the range is flattened here rather
                  // than threaded through as Date objects.
                  if (r.from) setFrom(format(r.from, "yyyy-MM-dd"));
                  if (r.to) setTo(format(r.to, "yyyy-MM-dd"));
                }}
              />
            </ControlField>
            <ControlDivider />
            <ControlField label="Shift" className="w-[8.5rem]">
              <Select value={fShift} onValueChange={setFShift}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="__all__">All shifts</SelectItem><SelectItem value="DAY">Day</SelectItem><SelectItem value="NIGHT">Night</SelectItem></SelectContent>
              </Select>
            </ControlField>
            <ControlField label="Filler line" className="w-[12rem]">
              <Select value={fLine} onValueChange={setFLine}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All lines</SelectItem>
                  {/* O quadrado é a mesma cor da faixa da baía, três palmos abaixo.
                      Escolher a linha no filtro e reconhecê-la no mapa passa a ser o
                      mesmo gesto. */}
                  {sortedLines.map((l) => (
                    <SelectItem key={l.id} value={l.name}>
                      <span className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: bayInk(l.name) }} aria-hidden />
                        {lineLabel(l.name)}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </ControlField>
            <ControlField label="Leader" className="w-[11rem]">
              <Select value={fLeader} onValueChange={setFLeader}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="__all__">All leaders</SelectItem>{leaders.map((l) => <SelectItem key={l.id} value={l.name}>{l.name}</SelectItem>)}</SelectContent>
              </Select>
            </ControlField>
            <ControlField label="SKU" className="min-w-[14rem] flex-1">
              <SkuCombobox skus={skus} value={fSku} onChange={setFSku} allowAll placeholder="All SKUs" />
            </ControlField>
            {hasFilter && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 self-end text-muted-foreground"
                onClick={() => { setFShift("__all__"); setFLine("__all__"); setFLeader("__all__"); setFSku("__all__"); }}
              >
                Clear filters
              </Button>
            )}
            <div className="ml-auto flex items-end gap-4">
              <ControlDivider />
              <ControlReadout
                label="Produced"
                value={Math.round(summary.actual).toLocaleString()}
                against={summary.target > 0 ? Math.round(summary.target).toLocaleString() : undefined}
              />
              {/* Quanto do que se vê é que tem hora. Uma folha com metade das corridas
                  por temporizar continua a dizer "9h22 a correr" sem dizer que são nove
                  horas de metade do turno, e é essa a pergunta que decide se o resto
                  se lê ou não. */}
              {bands.clock.runs > 0 && (
                <ControlReadout
                  label="Timed"
                  value={(bands.clock.runs - bands.clock.untimed).toLocaleString()}
                  against={bands.clock.runs.toLocaleString()}
                  tone={bands.clock.untimed === 0 ? "text-foreground" : "text-muted-foreground"}
                  hint={bands.clock.untimed === 0 ? "every run has a start and a finish" : `${bands.clock.untimed} without a readable time`}
                />
              )}
              <ControlReadout
                label="Attainment"
                value={summary.target > 0 ? `${summary.pct.toFixed(0)}%` : "—"}
                tone={
                  summary.target === 0
                    ? "text-muted-foreground"
                    : summary.pct >= 100
                      ? "text-success-strong"
                      : summary.pct >= 90
                        ? "text-warning-strong"
                        : "text-destructive-strong"
                }
                hint={`${summary.days} day${summary.days === 1 ? "" : "s"} · ${summary.lineCount} line${summary.lineCount === 1 ? "" : "s"}`}
              />
            </div>
          </ControlRow>
        </ControlPlate>



        {printing && (
          <ProductionControlPrintSheet
            sessions={filtered}
            bands={bands}
            summary={summary}
            skuMap={skuMap}
            leaders={leaders}
            periodLabel={periodLabel}
            shiftLabel={shiftLabel}
            filtersLabel={filtersLabel}
          />
        )}

        <Card>
          <CardContent className="p-0">
            {filtered.length === 0 ? (
              <div className="p-6 text-muted-foreground text-center">No sessions</div>
            ) : (
              <TooltipProvider delayDuration={200}>
                {/* Desktop / tablet — full editable table */}
                <div className="hidden md:block max-h-[70vh] overflow-auto">
                  <table className="w-full text-sm border-separate border-spacing-0">
                    {/* As chapas gravadas da folha, na mesma face dos títulos de secção.
                        `z-20` porque a faixa do dia rola por baixo desta. */}
                    <thead className="sticky top-0 z-20 bg-muted">
                      <tr className="font-display text-2xs font-bold uppercase tracking-[0.1em] text-muted-foreground">
                        <th className="sticky left-0 z-10 w-[6px] border-b bg-muted p-0" aria-hidden />
                        <th className="text-left px-3 py-2 border-b">Date</th>
                        <th className="text-left px-3 py-2 border-b">Shift</th>
                        <th className={cn("text-left px-3 py-2 border-b", RULE)}>Line</th>
                        <th className="text-left px-3 py-2 border-b">Leader</th>
                        <th className="text-right px-3 py-2 border-b w-28">Team<div className="mt-0.5 font-sans text-2xs font-normal normal-case tracking-normal text-muted-foreground/70">on the line</div></th>
                        <th className={cn("text-left px-3 py-2 border-b", RULE)}>SKU</th>
                        <th className="text-left px-3 py-2 border-b max-w-[22rem]">Description</th>
                        <th className="text-left px-3 py-2 border-b">Batch code</th>
                        <th className={cn("text-right px-3 py-2 border-b w-20", RULE)}>Blender</th>
                        <th className="text-right px-3 py-2 border-b w-36">Qty</th>
                        <th className="text-right px-3 py-2 border-b w-24">Weight (g)</th>
                        <th className={cn("text-left px-3 py-2 border-b", RULE)}>Start</th>
                        <th className="text-left px-3 py-2 border-b">Finish</th>
                        <th className="text-right px-3 py-2 border-b w-20">Run</th>
                        <th className={cn("text-right px-3 py-2 border-b w-24", RULE)}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const out: React.ReactNode[] = [];
                        let prevDate: string | null = null;
                        let prevLine: string | null = null;
                        filtered.forEach((s) => {
                          const items = s.production_items.length === 0
                            ? [{ id: `${s.id}-empty`, sku_id: "", target_qty: 0, planned_qty: 0, actual_qty: 0, notes: null, blender_ref: null, batch_code: null, tickets_unit: null as "tubs" | "bags" | null }]
                            : inRunOrder(s.production_items, s.shift);
                          const timings = runTimings(items, s.shift);
                          // A data-linha do dia.
                          //
                          // A folha vem ordenada por dia e, dentro do dia, por linha —
                          // mas não escrevia o dia em parte nenhuma. Com catorze dias
                          // escolhidos, saber onde acabava o 23/08 exigia ler a coluna
                          // da data fila a fila, e o total do dia não estava no ecrã.
                          if (s.session_date !== prevDate) {
                            const d = bands.day.get(s.session_date);
                            const dayPct = d && d.plan > 0 ? (d.qty / d.plan) * 100 : null;
                            out.push(
                              <tr key={`day-${s.session_date}`}>
                                {/* `sticky left-0` e não `justify-between`: com catorze
                                    colunas a folha rola de lado, e um total encostado à
                                    direita de quinze colunas está fora do ecrã em quase
                                    toda a rolagem. A data-linha desliza com o olho. */}
                                <td colSpan={16} className="border-y bg-foreground/[0.045] p-0">
                                  <div className="sticky left-0 flex w-fit flex-wrap items-baseline gap-x-4 gap-y-1 px-3 py-2">
                                    <span className="font-display text-sm font-bold uppercase tracking-[0.1em]">
                                      {format(parseISO(s.session_date), "EEE dd MMM")}
                                    </span>
                                    <span className="text-2xs uppercase tracking-[0.12em] text-muted-foreground">
                                      {d?.lines.size ?? 0} {(d?.lines.size ?? 0) === 1 ? "line" : "lines"}
                                    </span>
                                    <span className="h-3 w-px self-center bg-border" aria-hidden />
                                    <span className="font-figure text-sm font-bold">{Math.round(d?.qty ?? 0).toLocaleString()}</span>
                                    {d && d.plan > 0 && (
                                      <span className="font-figure text-2xs text-muted-foreground">/ {Math.round(d.plan).toLocaleString()}</span>
                                    )}
                                    {dayPct != null && (
                                      <span className={cn("font-figure text-sm font-bold", pctTone(dayPct))}>{dayPct.toFixed(0)}%</span>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                            prevDate = s.session_date;
                            // Um dia novo reabre as baías. Sem isto, um dia com uma
                            // linha só — a mesma com que o dia anterior acabou — ficava
                            // sem placa nenhuma e as suas filas colavam-se às de cima.
                            prevLine = null;
                          }
                          // A placa da baía: o quadrado da cor, o nome, e o que a linha
                          // fez naquele dia. O total por linha já era contado pelo
                          // `summary` desde sempre — para o período inteiro, e ninguém o
                          // mostrava. Aqui é por dia, que é a pergunta que se faz à folha.
                          const bayOpens = s.line !== prevLine;
                          if (bayOpens) {
                            const b = bands.bay.get(`${s.session_date}|${s.line}`);
                            const bayPct = b && b.plan > 0 ? (b.qty / b.plan) * 100 : null;
                            out.push(
                              <tr key={`bay-${s.session_date}-${s.line}`}>
                                <td className="sticky left-0 z-10 w-[6px] min-w-[6px] p-0" style={{ backgroundColor: bayInk(s.line) }} aria-hidden />
                                <td colSpan={15} className="border-b p-0" style={{ backgroundColor: bayWash(s.line) }}>
                                  <div className="sticky left-[6px] flex w-fit flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-1.5">
                                    <span className="inline-block h-2.5 w-2.5 shrink-0 self-center rounded-[2px]" style={{ backgroundColor: bayInk(s.line) }} aria-hidden />
                                    <span className="font-display text-2xs font-bold uppercase tracking-[0.14em]">{lineLabel(s.line)}</span>
                                    <span className="text-2xs text-muted-foreground">
                                      {b?.skus ?? 0} SKU
                                      {b && b.shifts.size > 0 ? ` · ${[...b.shifts].join(" + ").toLowerCase()}` : ""}
                                    </span>
                                    {b?.noLeader && (
                                      <span className="text-2xs font-semibold uppercase tracking-[0.1em] text-warning-strong">no leader</span>
                                    )}
                                    <span className="h-3 w-px self-center bg-border" aria-hidden />
                                    <span className="font-figure text-2xs font-bold">{Math.round(b?.qty ?? 0).toLocaleString()}</span>
                                    {b && b.plan > 0 && (
                                      <span className="font-figure text-2xs text-muted-foreground">/ {Math.round(b.plan).toLocaleString()}</span>
                                    )}
                                    {bayPct != null && (
                                      <span className={cn("font-figure text-2xs font-bold", pctTone(bayPct))}>{bayPct.toFixed(0)}%</span>
                                    )}
                                    {b && b.runMin > 0 && (
                                      <>
                                        <span className="h-3 w-px self-center bg-border" aria-hidden />
                                        <span className="font-figure text-2xs text-muted-foreground">
                                          {formatRunMinutes(b.runMin)} running
                                          {b.idleMin > 0 ? ` · ${formatRunMinutes(b.idleMin)} between runs` : ""}
                                        </span>
                                      </>
                                    )}
                                    {b && b.overlaps > 0 && (
                                      <span className="text-2xs font-semibold uppercase tracking-[0.1em] text-warning-strong">
                                        {b.overlaps} overlap{b.overlaps === 1 ? "" : "s"}
                                      </span>
                                    )}
                                    {/* O que a baía não conseguiu medir. Fica em letra
                                        de fundo e não em âmbar: uma fila por temporizar
                                        não é uma avaria, é trabalho por fazer — mas sem
                                        este número o relógio ao lado parece o turno
                                        inteiro quando é só a parte que tem horas. */}
                                    {b && b.untimed > 0 && (
                                      <span className="text-2xs text-muted-foreground">{b.untimed} untimed</span>
                                    )}
                                  </div>
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
                            const noLeader = !hasLeader(s);
                            const isNight = s.shift !== "DAY";
                            // O tom da fila diz a hora, e o problema ganha à hora.
                            //
                            // Saiu daqui o zebrado: alternar o fundo fila a fila não
                            // codificava nada — duas filas seguidas da mesma sessão
                            // apareciam de cores diferentes — e ocupava exactamente o
                            // mecanismo de que o turno precisa. Agora o dia é o fundo do
                            // cartão e a noite é a cor da própria baía, muito diluída.
                            //
                            // Vai por variável e não por `style` para que o `hover` do
                            // rato ainda ganhe: um fundo em linha bate qualquer classe,
                            // inclusive a do estado activo, e a folha ficava sem realce
                            // de fila em metade das filas.
                            const field = noLeader
                              ? "hsl(var(--warning) / 0.12)"
                              : bayWash(s.line, isNight ? "full" : "soft");

                            // O intervalo não é uma propriedade da fila: é o que há
                            // ENTRE duas. Numa coluna teria de se chamar "desde a
                            // anterior" e o leitor teria de guardar isso de cabeça —
                            // escrito entre as duas filas não precisa de nome nenhum.
                            // Só aparece quando se consegue medir; colado, não há nada
                            // a dizer.
                            const gap = timings[idx]?.sinceMin ?? null;
                            if (gap != null && gap !== 0) {
                              out.push(
                                <tr key={`gap-${s.id}-${i.id ?? idx}`} className="bg-[var(--bay-field)]" style={{ "--bay-field": field } as React.CSSProperties}>
                                  <td className="sticky left-0 z-10 w-[6px] min-w-[6px] p-0" style={{ backgroundColor: baySpine(s.line, isNight) }} aria-hidden />
                                  <td colSpan={15} className="p-0">
                                    <div className="sticky left-[6px] flex w-fit items-center gap-2 px-3 py-px">
                                      <span className={cn("w-5 border-t", gap < 0 ? "border-warning-strong" : "border-dashed border-border")} aria-hidden />
                                      <span className={cn("font-figure text-2xs", gap < 0 ? "font-semibold text-warning-strong" : "text-muted-foreground")}>
                                        {gap < 0
                                          ? `overlaps the run above by ${formatRunMinutes(gap)}`
                                          : `${formatRunMinutes(gap)} changeover`}
                                      </span>
                                    </div>
                                  </td>
                                </tr>
                              );
                            }

                            out.push(
                              <tr
                                key={`${s.id}-${i.id ?? idx}`}
                                className="border-b bg-[var(--bay-field)] transition-colors hover:bg-muted/50"
                                style={{ "--bay-field": field } as React.CSSProperties}
                              >
                                {/* A faixa pintada no chão da baía. Contínua por todo o
                                    bloco, e meio apagada de noite: a cor diz a linha, o
                                    tom diz o turno.
                                    `sticky` porque uma baía marcada no chão não desaparece
                                    quando se anda para o lado: com catorze colunas a folha
                                    rola, e é rolada que a pergunta "que linha é esta fila"
                                    se faz mais. */}
                                <td className="sticky left-0 z-10 w-[6px] min-w-[6px] p-0" style={{ backgroundColor: baySpine(s.line, isNight) }} aria-hidden />
                                {/* A data e a linha, uma vez por bloco.
                                    Estavam escritas em todas as filas de um bloco que
                                    já as diz no cabeçalho — a faixa do dia por fora, a
                                    placa da baía por dentro — e um bloco é, por
                                    construção, uma data e uma linha só. Oito filas da
                                    Line 1 repetiam "17/09" e "LINE 1" oito vezes cada,
                                    e o que varia dentro do bloco (o turno, o SKU, a
                                    hora) lia-se entre duas colunas que nunca mudam.
                                    É o gesto que a coluna do líder já fazia: escreve-se
                                    onde muda.
                                    Calada para o olho, dita para quem ouve a folha: uma
                                    fila sem data nem linha não se lê fora do bloco, e um
                                    leitor de ecrã lê fila a fila. */}
                                <td className="px-3 py-2 whitespace-nowrap font-figure text-xs">
                                  {bayOpens && idx === 0
                                    ? (s.session_date ? format(new Date(s.session_date), "dd/MM") : "—")
                                    : <span className="sr-only">{s.session_date ? format(new Date(s.session_date), "dd/MM") : ""}</span>}
                                </td>
                                <td className="px-3 py-2">
                                  {/* O turno é tom, não matiz: chapa clara de dia,
                                      chapa cheia de noite. Era azul-primário contra
                                      `purple-500` — uma cor de fora da paleta, a mesma
                                      que o `railEdge` foi escrito para acabar — e o
                                      violeta é agora a baía 7. */}
                                  {idx === 0 ? (
                                    <Badge
                                      variant="outline"
                                      className={cn(
                                        "px-1.5 py-0 font-display text-2xs font-bold uppercase tracking-[0.08em]",
                                        s.shift === "DAY"
                                          ? "border-border bg-background text-foreground"
                                          : "border-transparent bg-foreground/85 text-background",
                                      )}
                                    >
                                      {s.shift}
                                    </Badge>
                                  ) : (
                                    <span className="sr-only">{s.shift}</span>
                                  )}
                                </td>
                                {/* O eco da faixa, à altura dos olhos: com a folha
                                    rolada de lado a faixa fica fora de vista, e a
                                    coluna é onde a linha se confirma pelo nome. Fica
                                    calada — quem grita é a faixa. */}
                                <td className={cn("whitespace-nowrap px-3 py-2 font-display text-2xs font-bold uppercase tracking-[0.08em]", RULE)} style={{ color: bayInk(s.line) }}>
                                  {bayOpens && idx === 0
                                    ? lineLabel(s.line)
                                    : <span className="sr-only">{lineLabel(s.line)}</span>}
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
                                <td className={cn("px-3 py-2", RULE)}>
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
                                      className="w-[80px] h-7 px-1 text-xs font-figure rounded border bg-background"
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
                                    <span className="text-xs font-figure">{i.batch_code || "—"}</span>
                                  )}
                                  {(i.manufacture_month || i.expiry_month) && (
                                    <div className="mt-0.5 text-2xs text-muted-foreground whitespace-nowrap">
                                      {i.manufacture_month && <span title="Manufactured">M {monthMMYY(i.manufacture_month)}</span>}
                                      {i.manufacture_month && i.expiry_month && " · "}
                                      {i.expiry_month && <span title="Expiry">E {monthMMYY(i.expiry_month)}</span>}
                                    </div>
                                  )}
                                </td>
                                <td className={cn("whitespace-nowrap px-3 py-2 text-right font-figure text-xs", RULE)}>
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
                                <td className="px-3 py-2 text-right font-figure text-xs text-muted-foreground">
                                  {weight ? weight.toLocaleString() : "—"}
                                </td>
                                <td className={cn("px-3 py-2", RULE)}>
                                  {(i.sku_id || i.sku_code_text) ? <InlineTimeCell itemId={i.id} sessionDate={s.session_date} shift={s.shift} field="started_at" value={i.started_at} disabled={s.locked && !isAdmin} onSaved={() => qc.invalidateQueries({ queryKey: ["shift_history"] })} /> : <span className="text-xs text-muted-foreground">—</span>}
                                </td>
                                <td className="px-3 py-2">
                                  {(i.sku_id || i.sku_code_text) ? <InlineTimeCell itemId={i.id} sessionDate={s.session_date} shift={s.shift} field="finished_at" value={i.finished_at} disabled={s.locked && !isAdmin} onSaved={() => qc.invalidateQueries({ queryKey: ["shift_history"] })} /> : <span className="text-xs text-muted-foreground">—</span>}
                                </td>
                                {/* Quanto tempo aquilo levou. O mesmo `runMinutes` da
                                    Performance, recusas incluídas: um travessão aqui é
                                    um par de horas que não descreve corrida nenhuma —
                                    e que também não está a contar para a velocidade da
                                    linha em ecrã nenhum. */}
                                <td className={cn("px-3 py-2 text-right font-figure text-xs", timings[idx]?.runMin == null && "text-muted-foreground")}>
                                  {formatRunMinutes(timings[idx]?.runMin ?? null)}
                                </td>
                                <td className={cn("px-3 py-2", RULE)}>
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
                      : inRunOrder(s.production_items, s.shift);
                    const timings = runTimings(items, s.shift);
                    return items.map((i, idx) => {
                      const sku = skuMap.get(i.sku_id);
                      const code = sku?.code ?? "";
                      const name = sku?.name ?? (i.sku_id ? "Unknown" : "—");
                      const noteUnit = i.tickets_unit ?? (/\[unit:tubs\]/i.test(i.notes ?? "") ? "tubs" : /\[unit:bags\]/i.test(i.notes ?? "") ? "bags" : null);
                      const blob = `${code} ${name}`.toLowerCase();
                      const effUnit: "tubs" | "bags" = noteUnit ?? (/tub/.test(blob) ? "tubs" : /bag|sach|pouch/.test(blob) ? "bags" : "bags");
                      const blenders = Array.from(new Set(((i as any).production_blender_entries ?? []).map((b: any) => b.blender_number as number))).sort((x: number, y: number) => x - y);
                      const noLeader = !hasLeader(s);
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
                                  "px-1.5 py-0 font-display text-2xs font-bold uppercase tracking-[0.08em]",
                                  s.shift === "DAY"
                                    ? "border-border bg-background text-foreground"
                                    : "border-transparent bg-foreground/85 text-background",
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
                          {/* O mesmo quadrado do filtro e da placa: no telefone não há
                              faixa por onde a baía corra, mas a cor tem de ser a mesma. */}
                          <TableCardField
                            label="Line"
                            value={(
                              <span className="flex items-center gap-2">
                                <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: bayInk(s.line) }} aria-hidden />
                                {lineLabel(s.line)}
                              </span>
                            )}
                          />
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
                                className="w-full h-8 px-2 text-xs font-figure rounded border bg-background"
                                onBlur={async (e) => {
                                  const v = e.target.value.trim() || null;
                                  if (v === (i.batch_code ?? null)) return;
                                  if (isPlaceholderRow(i.id)) return;
                                        const { error } = await supabase.from("production_items").update({ batch_code: v }).eq("id", i.id);
                                  if (error) toast.error(error.message);
                                  else { toast.success("Batch saved"); qc.invalidateQueries({ queryKey: ["shift_history"] }); }
                                }}
                              />
                            ) : (<span className="font-figure">{i.batch_code || "—"}</span>)}
                          />
                          <TableCardField label="Blender" value={<span className="tabular-nums">{blenders.length ? blenders.join(", ") : "—"}</span>} />
                          {(i.sku_id || i.sku_code_text) && (
                            <TableCardField label="Start" value={<InlineTimeCell itemId={i.id} sessionDate={s.session_date} shift={s.shift} field="started_at" value={i.started_at} disabled={s.locked && !isAdmin} onSaved={() => qc.invalidateQueries({ queryKey: ["shift_history"] })} />} />
                          )}
                          {(i.sku_id || i.sku_code_text) && (
                            <TableCardField label="Finish" value={<InlineTimeCell itemId={i.id} sessionDate={s.session_date} shift={s.shift} field="finished_at" value={i.finished_at} disabled={s.locked && !isAdmin} onSaved={() => qc.invalidateQueries({ queryKey: ["shift_history"] })} />} />
                          )}
                          {/* No telemóvel um cartão é uma fila: o intervalo, que no
                              ecrã largo se escreve ENTRE duas, aqui só pode ser dito
                              dentro de um — e por isso é que aqui leva nome. */}
                          {(i.sku_id || i.sku_code_text) && (
                            <TableCardField
                              label="Run"
                              value={
                                <span className={cn("font-figure", timings[idx]?.runMin == null && "text-muted-foreground")}>
                                  {formatRunMinutes(timings[idx]?.runMin ?? null)}
                                  {timings[idx]?.sinceMin != null && timings[idx]!.sinceMin !== 0 && (
                                    <span className={cn("ml-2 text-2xs", timings[idx]!.sinceMin! < 0 ? "font-semibold text-warning-strong" : "text-muted-foreground")}>
                                      {timings[idx]!.sinceMin! < 0
                                        ? `overlaps by ${formatRunMinutes(timings[idx]!.sinceMin)}`
                                        : `${formatRunMinutes(timings[idx]!.sinceMin)} after the last`}
                                    </span>
                                  )}
                                </span>
                              }
                            />
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
                Removes only <b className="font-figure">{deletingItem?.code}</b> from this shift. The rest of the line's production stays.
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
              {/* The date input carries an intrinsic minimum width, so equal thirds
                  spill out of the dialog. Date takes half the row and every cell is
                  allowed to shrink (min-w-0), which keeps the grid inside the box. */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="col-span-2 min-w-0"><Label className="text-xs">Date</Label><Input type="date" className="w-full min-w-0" value={addDate} onChange={(e) => setAddDate(e.target.value)} /></div>
                <div className="min-w-0"><Label className="text-xs">Line</Label>
                  <Select value={addLine} onValueChange={setAddLine}>
                    <SelectTrigger><SelectValue placeholder="Line" /></SelectTrigger>
                    <SelectContent>{sortedLines.map((l) => <SelectItem key={l.id} value={l.name}>{lineLabel(l.name)}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="min-w-0"><Label className="text-xs">Shift</Label>
                  <Select value={addShift} onValueChange={(v) => setAddShift(v as "DAY" | "NIGHT")}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="DAY">Day</SelectItem><SelectItem value="NIGHT">Night</SelectItem></SelectContent>
                  </Select>
                </div>
              </div>
              <div className="min-w-0"><Label className="text-xs">SKU</Label>
                <SkuCombobox skus={skus} value={addSkuId} onChange={setAddSkuId} />
              </div>
              <div className="min-w-0"><Label className="text-xs">Produced (actual)</Label><Input type="number" inputMode="numeric" value={addActual} onChange={(e) => setAddActual(e.target.value)} placeholder="0" autoFocus /></div>
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
