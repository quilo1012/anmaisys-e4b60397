import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle, Sparkles, Download, Wand2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
import { useLines, useSkuProducts } from "@/hooks/useProductionPlanner";

type Row = {
  raw_code: string;
  raw_name: string;
  qty: number;
  line: string;
  shift: "DAY" | "NIGHT";
  date: string;
  sku_id: string | null;
  matched_code: string | null;
  match_score: number;
  notes?: string;
};

const norm = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);

function similarity(a: string, b: string): number {
  const A = new Set(norm(a));
  const B = new Set(norm(b));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  A.forEach((t) => B.has(t) && inter++);
  return inter / Math.max(A.size, B.size);
}

function findCol(header: string[], names: string[]): number {
  const lower = header.map((h) => (h ?? "").toString().trim().toLowerCase());
  for (const n of names) {
    const nl = n.toLowerCase();
    const i = lower.findIndex((h) => h === nl || h.includes(nl));
    if (i !== -1) return i;
  }
  return -1;
}

function parseDate(raw: unknown): string {
  if (!raw) return format(new Date(), "yyyy-MM-dd");
  const s = String(raw).trim();
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (m) {
    const [, d, mo, y] = m;
    const yyyy = y.length === 2 ? `20${y}` : y;
    return `${yyyy}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const n = Number(s);
  if (!isNaN(n) && n > 30000 && n < 80000) {
    const d = new Date(Math.round((n - 25569) * 86400 * 1000));
    return d.toISOString().slice(0, 10);
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return format(new Date(), "yyyy-MM-dd");
}

function parseQty(raw: unknown): number {
  if (raw == null) return 0;
  const s = String(raw).trim().replace(/\s/g, "");
  // European: 6.666,5  → 6666.5;  also handle 6,666 → 6666
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  let clean = s;
  if (hasComma && hasDot) clean = s.replace(/\./g, "").replace(",", ".");
  else if (hasComma && !hasDot) clean = s.replace(",", ".");
  const n = Number(clean.replace(/[^\d.\-]/g, ""));
  return isNaN(n) ? 0 : Math.round(n);
}

export function AssemblyListImporter({
  open, onOpenChange, onImported,
}: { open: boolean; onOpenChange: (o: boolean) => void; onImported?: () => void }) {
  const { data: lines = [] } = useLines();
  const { data: skus = [] } = useSkuProducts(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [fileName, setFileName] = useState("");
  const [importing, setImporting] = useState(false);
  const [defaultDate, setDefaultDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [defaultShift, setDefaultShift] = useState<"DAY" | "NIGHT">("DAY");
  const [defaultLine, setDefaultLine] = useState<string>("");

  const skuByCode = useMemo(() => {
    const m = new Map<string, { id: string; code: string; name: string }>();
    for (const s of skus) m.set(s.code.toLowerCase().trim(), { id: s.id, code: s.code, name: s.name });
    return m;
  }, [skus]);

  const matched = useMemo(() => rows.filter((r) => r.sku_id).length, [rows]);
  const missingLine = useMemo(() => rows.filter((r) => r.sku_id && !r.line).length, [rows]);
  const readyToImport = useMemo(() => rows.filter((r) => r.sku_id && r.line && r.qty > 0).length, [rows]);
  const totalQty = useMemo(() => rows.reduce((a, r) => a + (r.sku_id && r.line ? r.qty : 0), 0), [rows]);

  const applyLineToEmpty = (line: string) => {
    if (!line) return;
    setRows((rs) => rs.map((r) => (r.line ? r : { ...r, line })));
    toast.success(`Line "${line}" applied to empty rows`);
  };
  const applyLineToAll = (line: string) => {
    if (!line) return;
    setRows((rs) => rs.map((r) => ({ ...r, line })));
    toast.success(`Line "${line}" applied to all rows`);
  };
  const applyLineToCode = (rawCode: string, line: string) => {
    if (!line || !rawCode) return;
    setRows((rs) => rs.map((r) => (r.raw_code === rawCode ? { ...r, line } : r)));
  };

  /**
   * Smart auto-assign: para cada SKU sem Line, procura a Line mais usada
   * em production_items / production_sessions nos últimos 90 dias.
   * Cobre "code change": se o ERP mudou o código, casamos via sku_id
   * (já resolvido por exact code OU fuzzy description acima).
   */
  const autoAssignFromHistory = async (silent = false) => {
    const targets = rows.filter((r) => r.sku_id && !r.line);
    if (targets.length === 0) {
      if (!silent) toast.info("Nothing to auto-assign — all rows already have a line");
      return;
    }
    const skuIds = Array.from(new Set(targets.map((r) => r.sku_id!)));
    const since = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10);

    const { data, error } = await supabase
      .from("production_items")
      .select("sku_id, production_sessions!inner(line, session_date)")
      .in("sku_id", skuIds)
      .gte("production_sessions.session_date", since);
    if (error) { if (!silent) toast.error(error.message); return; }

    // sku_id -> Map<line, weight>  (weight = recency-decayed count)
    const lineNames = new Set(lines.map((l) => l.name));
    const tally = new Map<string, Map<string, number>>();
    const today = Date.now();
    for (const row of (data ?? []) as Array<{ sku_id: string; production_sessions: { line: string; session_date: string } }>) {
      const ln = row.production_sessions?.line;
      if (!ln || !lineNames.has(ln)) continue;
      const ageDays = Math.max(0, (today - new Date(row.production_sessions.session_date).getTime()) / 86400_000);
      const w = 1 / (1 + ageDays / 30); // newer counts more
      const m = tally.get(row.sku_id) ?? new Map<string, number>();
      m.set(ln, (m.get(ln) ?? 0) + w);
      tally.set(row.sku_id, m);
    }

    const best = new Map<string, string>();
    for (const [sku, m] of tally) {
      let topLine = ""; let topW = 0;
      for (const [ln, w] of m) if (w > topW) { topW = w; topLine = ln; }
      if (topLine) best.set(sku, topLine);
    }

    let assigned = 0;
    setRows((rs) => rs.map((r) => {
      if (r.sku_id && !r.line && best.has(r.sku_id)) {
        assigned++;
        return { ...r, line: best.get(r.sku_id)!, notes: "auto:history" };
      }
      return r;
    }));
    if (!silent) {
      if (assigned > 0) toast.success(`Smart match: assigned line to ${assigned} row(s) from history`);
      else toast.info("No prior line found in history for the unassigned SKUs");
    }
  };

  const downloadTemplate = () => {
    // Unleashed export + Line column (vem do Trello) com dropdown via data validation.
    const headers = ["Part Code", "Description", "Order Qty", "Line"];
    const lineNames = lines.map((l) => l.name);
    const fallbackLine = defaultLine || lineNames[0] || "";
    const sample = (skus.slice(0, 3).length ? skus.slice(0, 3) : [
      { code: "CRE500-B45", name: "Creatine 500g — Batch B45" },
      { code: "WPI2KG-B12", name: "Whey Protein 2kg — Batch B12" },
      { code: "PRE300-B07", name: "Pre-Workout 300g — Batch B07" },
    ]).map((s, i) => [s.code, s.name, 1000 * (i + 1), fallbackLine]);

    // Reserve 500 blank rows so the dropdown extends past the sample
    const blankRows = Array.from({ length: 500 }, () => ["", "", "", ""]);
    const aoa = [headers, ...sample, ...blankRows];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 18 }, { wch: 46 }, { wch: 12 }, { wch: 22 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Assembly List");

    // "Lines" sheet feeds the dropdown via a named range
    const linesWs = XLSX.utils.aoa_to_sheet([["Line"], ...lineNames.map((n) => [n])]);
    linesWs["!cols"] = [{ wch: 28 }];
    XLSX.utils.book_append_sheet(wb, linesWs, "Lines");

    // Data validation (Excel-compatible) on column D rows 2..501 → list from Lines!$A$2:$A$<n>
    const lastLineRow = Math.max(2, lineNames.length + 1);
    type WSWithDV = XLSX.WorkSheet & { "!dataValidation"?: unknown[] };
    (ws as WSWithDV)["!dataValidation"] = [{
      sqref: "D2:D501",
      type: "list",
      formula1: `=Lines!$A$2:$A$${lastLineRow}`,
      allowBlank: true,
      showDropDown: false,
      showErrorMessage: true,
      errorTitle: "Invalid line",
      error: "Pick a line from the dropdown",
    }];

    const info = XLSX.utils.aoa_to_sheet([
      ["Unleashed → AN Maintenance · Assembly List Template"],
      [],
      ["How to use:"],
      ["1. Export the Assembly List from Unleashed as XLSX."],
      ["2. Paste Part Code / Description / Order Qty into this template."],
      ["3. Fill the Line column using the dropdown (values come from Trello)."],
      ["4. Save and upload here — the system reads Line directly from the file."],
      [],
      ["Notes:"],
      ["• Date and Shift default to the values set at the top of the dialog."],
      ["• Part Code must match an SKU code; fuzzy match by Description ≥ 50% otherwise."],
      ["• Order Qty accepts European (6.666,5) and US (6,666.5) number formats."],
      ["• The 'Lines' sheet is the source of the dropdown — do not delete or rename it."],
    ]);
    info["!cols"] = [{ wch: 90 }];
    XLSX.utils.book_append_sheet(wb, info, "Instructions");

    XLSX.writeFile(wb, `assembly-list-template-${format(new Date(), "yyyy-MM-dd")}.xlsx`);
    toast.success("Template baixado — coluna Line com dropdown pronta");
  };


  const handleFile = async (file: File) => {
    setFileName(file.name);
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array", cellDates: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: "" });
    if (aoa.length < 2) { toast.error("Empty file"); return; }

    const header = (aoa[0] as unknown[]).map((c) => String(c ?? "").trim());
    const codeIdx = findCol(header, ["part code", "product code", "sku", "code", "item code", "codigo", "código"]);
    const descIdx = findCol(header, ["description", "product", "product description", "name", "produto"]);
    const qtyIdx  = findCol(header, ["order qty", "qty", "quantity", "qtd", "quantidade", "planned qty"]);
    const lineIdx = findCol(header, ["line", "work centre", "work center", "linha", "filler"]);
    const dateIdx = findCol(header, ["date", "data", "production date", "schedule date"]);
    const shiftIdx = findCol(header, ["shift", "turno"]);

    if (codeIdx === -1 && descIdx === -1) {
      toast.error("Need at least a Part Code or Description column");
      return;
    }
    if (qtyIdx === -1) { toast.error("Missing Order Qty column"); return; }

    const parsed: Row[] = [];
    for (const r of aoa.slice(1) as unknown[][]) {
      const code = codeIdx !== -1 ? String(r[codeIdx] ?? "").trim() : "";
      const desc = descIdx !== -1 ? String(r[descIdx] ?? "").trim() : "";
      const qty = parseQty(r[qtyIdx]);
      if (!code && !desc) continue;
      if (qty <= 0) continue;

      const rawLine = lineIdx !== -1 ? String(r[lineIdx] ?? "").trim() : "";
      const matchedLine = lines.find((l) => l.name.toLowerCase() === rawLine.toLowerCase())?.name
        ?? lines.find((l) => rawLine.toLowerCase().includes(l.name.toLowerCase()))?.name
        ?? defaultLine
        ?? "";

      const rawShift = (shiftIdx !== -1 ? String(r[shiftIdx] ?? "").trim() : "").toUpperCase();
      const shift: "DAY" | "NIGHT" = rawShift.startsWith("N") ? "NIGHT" : rawShift.startsWith("D") ? "DAY" : defaultShift;
      const date = dateIdx !== -1 ? parseDate(r[dateIdx]) : defaultDate;

      // Match by exact code first
      let sku = code ? skuByCode.get(code.toLowerCase()) : undefined;
      let score = sku ? 1 : 0;

      // Fuzzy by description
      if (!sku && desc) {
        let best: { id: string; code: string; name: string } | undefined;
        let bestScore = 0;
        for (const s of skus) {
          const sc = similarity(desc, s.name);
          if (sc > bestScore) { bestScore = sc; best = s; }
        }
        if (best && bestScore >= 0.5) { sku = best; score = bestScore; }
      }

      parsed.push({
        raw_code: code,
        raw_name: desc,
        qty,
        line: matchedLine,
        shift,
        date,
        sku_id: sku?.id ?? null,
        matched_code: sku?.code ?? null,
        match_score: score,
      });
    }
    setRows(parsed);
    toast.success(`Parsed ${parsed.length} orders · ${parsed.filter((p) => p.sku_id).length} matched`);
    // Smart auto-assign lines from history for matched SKUs that came without a Line
    setTimeout(() => { autoAssignFromHistory(true).catch(() => {}); }, 0);
  };

  const update = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const runImport = async () => {
    const valid = rows.filter((r) => r.sku_id && r.line && r.qty > 0);
    if (valid.length === 0) { toast.error("No valid rows (need SKU + Line + Qty)"); return; }
    setImporting(true);
    try {
      // group by date|shift|line
      const groups = new Map<string, Row[]>();
      for (const r of valid) {
        const k = `${r.date}|${r.shift}|${r.line}`;
        const g = groups.get(k) ?? [];
        g.push(r); groups.set(k, g);
      }

      let sessions = 0, items = 0;
      const ragKeys = new Map<string, number>(); // date|line|shift -> total plan

      for (const [k, grp] of groups) {
        const [session_date, shift, line] = k.split("|");
        const { data: existing } = await supabase
          .from("production_sessions")
          .select("id")
          .eq("session_date", session_date).eq("shift", shift).eq("line", line)
          .maybeSingle();
        let sessionId = existing?.id;
        if (!sessionId) {
          const { data: ins, error } = await supabase
            .from("production_sessions")
            .insert({ session_date, shift, line })
            .select("id").single();
          if (error) throw error;
          sessionId = ins.id;
        }
        sessions++;

        // aggregate per sku
        const agg = new Map<string, number>();
        for (const r of grp) agg.set(r.sku_id!, (agg.get(r.sku_id!) ?? 0) + r.qty);

        let sessionPlan = 0;
        for (const [sku_id, qty] of agg) {
          sessionPlan += qty;
          const { data: ex } = await supabase
            .from("production_items").select("id")
            .eq("session_id", sessionId).eq("sku_id", sku_id).maybeSingle();
          if (ex) {
            await supabase.from("production_items").update({
              target_qty: qty, planned_qty: qty,
            }).eq("id", ex.id);
          } else {
            await supabase.from("production_items").insert({
              session_id: sessionId, sku_id, target_qty: qty, planned_qty: qty, actual_qty: 0,
            });
          }
          items++;
        }

        const rk = `${session_date}|${line}|${shift}`;
        ragKeys.set(rk, (ragKeys.get(rk) ?? 0) + sessionPlan);
      }

      // Upsert RAG plan totals
      const ragRows = Array.from(ragKeys.entries()).map(([k, plan]) => {
        const [entry_date, line, shift] = k.split("|");
        return { entry_date, line, shift, plan_qty: plan };
      });
      if (ragRows.length > 0) {
        const { error: ragErr } = await supabase
          .from("rag_weekly_entries")
          .upsert(ragRows, { onConflict: "entry_date,line,shift", ignoreDuplicates: false });
        if (ragErr) toast.error(`RAG sync warning: ${ragErr.message}`);
      }

      toast.success(`Imported ${items} SKUs across ${sessions} sessions · RAG updated for ${ragRows.length} line/shifts`);
      onImported?.();
      onOpenChange(false);
      setRows([]); setFileName("");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Import failed";
      toast.error(msg);
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />Assembly List Importer
            <Badge variant="outline" className="ml-2 gap-1"><Sparkles className="h-3 w-3" />Smart match</Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="md:col-span-2">
              <div className="flex items-center justify-between">
                <Label>Assembly List (.xlsx) from ERP</Label>
                <Button type="button" size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={downloadTemplate}>
                  <Download className="h-3 w-3" /> Download Unleashed template
                </Button>
              </div>
              <Input type="file" accept=".xlsx,.xls,.xlsm" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
            </div>
            <div>
              <Label>Default date</Label>
              <Input type="date" value={defaultDate} onChange={(e) => setDefaultDate(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Default shift</Label>
                <Select value={defaultShift} onValueChange={(v) => setDefaultShift(v as "DAY" | "NIGHT")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DAY">DAY</SelectItem>
                    <SelectItem value="NIGHT">NIGHT</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Default line</Label>
                <Select value={defaultLine || "__none__"} onValueChange={(v) => setDefaultLine(v === "__none__" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">—</SelectItem>
                    {lines.map((l) => <SelectItem key={l.id} value={l.name}>{l.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Required from Unleashed: <b>Part Code</b>, <b>Description</b>, <b>Order Qty</b>.
            <b> Line</b> (do Trello), <b>Date</b> e <b>Shift</b> são opcionais no arquivo — se faltarem,
            o sistema usa os defaults acima e você pode atribuir a Line em massa abaixo.
            Smart-match: código exato primeiro, depois fuzzy por descrição (≥50%).
          </p>

          {rows.length > 0 && (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="secondary" className="gap-1"><CheckCircle2 className="h-3 w-3 text-green-500" />{matched} / {rows.length} matched</Badge>
                <Badge variant="outline">Ready: {readyToImport}</Badge>
                <Badge variant="outline">Total qty: {totalQty.toLocaleString()}</Badge>
                {rows.length - matched > 0 && (
                  <Badge variant="destructive" className="gap-1"><AlertCircle className="h-3 w-3" />{rows.length - matched} unmatched</Badge>
                )}
                {missingLine > 0 && (
                  <Badge variant="destructive" className="gap-1"><AlertCircle className="h-3 w-3" />{missingLine} without line</Badge>
                )}
                <span className="text-muted-foreground">· {fileName}</span>
              </div>

              <div className="flex flex-wrap items-end gap-2 p-3 border rounded-md bg-muted/30">
                <div className="space-y-1">
                  <Label className="text-xs">Bulk-assign line (per Trello)</Label>
                  <Select value={defaultLine || "__none__"} onValueChange={(v) => setDefaultLine(v === "__none__" ? "" : v)}>
                    <SelectTrigger className="h-9 w-44"><SelectValue placeholder="Pick line" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">—</SelectItem>
                      {lines.map((l) => <SelectItem key={l.id} value={l.name}>{l.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <Button size="sm" variant="secondary" disabled={!defaultLine} onClick={() => applyLineToEmpty(defaultLine)}>
                  Apply to empty ({missingLine})
                </Button>
                <Button size="sm" variant="outline" disabled={!defaultLine} onClick={() => applyLineToAll(defaultLine)}>
                  Apply to all ({rows.length})
                </Button>
                <span className="text-xs text-muted-foreground ml-auto">
                  Same blender, different size? Set line per row below.
                </span>
              </div>

              <div className="border rounded-md max-h-[55vh] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ERP Part Code</TableHead>
                      <TableHead>ERP Description</TableHead>
                      <TableHead>Qty</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Shift</TableHead>
                      <TableHead>Line</TableHead>
                      <TableHead>Matched SKU</TableHead>
                      <TableHead>Score</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r, i) => (
                      <TableRow key={i} className={!r.sku_id ? "bg-destructive/10" : !r.line ? "bg-amber-500/10" : ""}>
                        <TableCell className="font-mono text-xs">{r.raw_code || "—"}</TableCell>
                        <TableCell className="text-xs">{r.raw_name || "—"}</TableCell>
                        <TableCell className="tabular-nums">{r.qty.toLocaleString()}</TableCell>
                        <TableCell><Input type="date" value={r.date} onChange={(e) => update(i, { date: e.target.value })} className="h-8 w-36" /></TableCell>
                        <TableCell>
                          <Select value={r.shift} onValueChange={(v) => update(i, { shift: v as "DAY" | "NIGHT" })}>
                            <SelectTrigger className="h-8 w-24"><SelectValue /></SelectTrigger>
                            <SelectContent><SelectItem value="DAY">DAY</SelectItem><SelectItem value="NIGHT">NIGHT</SelectItem></SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Select value={r.line || "__none__"} onValueChange={(v) => update(i, { line: v === "__none__" ? "" : v })}>
                            <SelectTrigger className="h-8 w-36"><SelectValue placeholder="Pick line" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">—</SelectItem>
                              {lines.map((l) => <SelectItem key={l.id} value={l.name}>{l.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Select
                            value={r.sku_id ?? "__none__"}
                            onValueChange={(v) => {
                              if (v === "__none__") { update(i, { sku_id: null, matched_code: null, match_score: 0 }); return; }
                              const s = skus.find((x) => x.id === v);
                              update(i, { sku_id: v, matched_code: s?.code ?? null, match_score: 1 });
                            }}
                          >
                            <SelectTrigger className="h-8 w-56"><SelectValue placeholder="Unmatched" /></SelectTrigger>
                            <SelectContent className="max-h-72">
                              <SelectItem value="__none__">— Unmatched —</SelectItem>
                              {skus.slice(0, 500).map((s) => (
                                <SelectItem key={s.id} value={s.id}>
                                  <span className="font-mono text-xs mr-2">{s.code}</span>{s.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="text-xs tabular-nums">{r.sku_id ? `${Math.round(r.match_score * 100)}%` : "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={runImport} disabled={importing || readyToImport === 0}>
            <Upload className="h-4 w-4 mr-2" />
            {importing ? "Importing…" : `Import ${readyToImport} orders`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default AssemblyListImporter;
