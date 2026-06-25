import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Upload, FileSpreadsheet, AlertCircle, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type ParsedRow = {
  date: string;          // yyyy-mm-dd
  shift: "DAY" | "NIGHT";
  line: string;
  sku_code: string;
  qty: number;
  valid: boolean;
  error?: string;
};

function detectSeparator(text: string): string {
  const first = text.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";
  const candidates = [",", ";", "\t", "|"];
  let best = ","; let bestCount = 0;
  for (const c of candidates) {
    const n = first.split(c).length;
    if (n > bestCount) { bestCount = n; best = c; }
  }
  return best;
}

function parseDate(raw: string): string | null {
  if (!raw) return null;
  const s = raw.trim();
  // dd/mm/yyyy or dd-mm-yyyy
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (m) {
    const [, d, mo, y] = m;
    const yyyy = y.length === 2 ? `20${y}` : y;
    return `${yyyy}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  // yyyy-mm-dd
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // Excel serial
  const n = Number(s);
  if (!isNaN(n) && n > 30000 && n < 80000) {
    const d = new Date(Math.round((n - 25569) * 86400 * 1000));
    return d.toISOString().slice(0, 10);
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

function deriveShift(time: string | undefined): "DAY" | "NIGHT" {
  if (!time) return "DAY";
  const m = time.match(/(\d{1,2}):(\d{2})/);
  if (!m) return "DAY";
  const h = parseInt(m[1], 10);
  return h >= 6 && h < 18 ? "DAY" : "NIGHT";
}

function findCol(header: string[], names: string[]): number {
  const lower = header.map((h) => h.trim().toLowerCase());
  for (const n of names) {
    const i = lower.findIndex((h) => h === n.toLowerCase() || h.includes(n.toLowerCase()));
    if (i !== -1) return i;
  }
  return -1;
}

export function ImportProductionDialog({ open, onOpenChange, onImported }: {
  open: boolean; onOpenChange: (o: boolean) => void; onImported?: () => void;
}) {
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [importing, setImporting] = useState(false);

  const valid = useMemo(() => rows.filter((r) => r.valid), [rows]);
  const invalid = useMemo(() => rows.filter((r) => !r.valid), [rows]);

  const handleFile = async (file: File) => {
    setFileName(file.name);
    const text = await file.text();
    const sep = detectSeparator(text);
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) { toast.error("Empty file"); return; }
    const header = lines[0].split(sep).map((c) => c.replace(/^"|"$/g, ""));
    const dateIdx = findCol(header, ["date", "data"]);
    const timeIdx = findCol(header, ["start time", "time", "hora"]);
    const lineIdx = findCol(header, ["work centre", "work center", "line", "linha"]);
    const codeIdx = findCol(header, ["product code", "sku", "code", "codigo", "código"]);
    const qtyIdx = findCol(header, ["qty", "quantity", "qtd", "quantidade"]);

    if (dateIdx === -1 || lineIdx === -1 || codeIdx === -1 || qtyIdx === -1) {
      toast.error("Missing required columns: Date, Work Centre, Product Code, Qty");
      return;
    }

    const parsed: ParsedRow[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(sep).map((c) => c.replace(/^"|"$/g, "").trim());
      const date = parseDate(cols[dateIdx] ?? "");
      const line = cols[lineIdx] ?? "";
      const sku_code = cols[codeIdx] ?? "";
      const qty = Number((cols[qtyIdx] ?? "0").replace(/[, ]/g, ""));
      const shift = deriveShift(timeIdx !== -1 ? cols[timeIdx] : undefined);
      let valid = true; let error: string | undefined;
      if (!date) { valid = false; error = "Invalid date"; }
      else if (!line) { valid = false; error = "Missing line"; }
      else if (!sku_code) { valid = false; error = "Missing SKU code"; }
      else if (!qty || isNaN(qty)) { valid = false; error = "Invalid qty"; }
      parsed.push({ date: date ?? "", shift, line, sku_code, qty, valid, error });
    }
    setRows(parsed);
  };

  const runImport = async () => {
    if (valid.length === 0) { toast.error("No valid rows to import"); return; }
    setImporting(true);
    try {
      // Pre-fetch SKU map
      const codes = Array.from(new Set(valid.map((r) => r.sku_code)));
      const { data: skus } = await supabase.from("sku_products").select("id, code").in("code", codes);
      const skuMap = new Map((skus ?? []).map((s: any) => [s.code, s.id]));

      // Group rows by date+shift+line
      const groups = new Map<string, ParsedRow[]>();
      for (const r of valid) {
        const k = `${r.date}|${r.shift}|${r.line}`;
        const g = groups.get(k) ?? [];
        g.push(r); groups.set(k, g);
      }

      let sessionCount = 0; let itemCount = 0; let skippedUnknown = 0;
      for (const [k, grp] of groups) {
        const [session_date, shift, line] = k.split("|");
        // upsert session
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
        sessionCount++;
        // aggregate qty per sku
        const aggr = new Map<string, number>();
        for (const r of grp) {
          if (!skuMap.has(r.sku_code)) { skippedUnknown++; continue; }
          aggr.set(r.sku_code, (aggr.get(r.sku_code) ?? 0) + r.qty);
        }
        for (const [code, qty] of aggr) {
          const sku_id = skuMap.get(code)!;
          const { data: existingItem } = await supabase
            .from("production_items").select("id, actual_qty")
            .eq("session_id", sessionId).eq("sku_id", sku_id).maybeSingle();
          if (existingItem) {
            await supabase.from("production_items")
              .update({ actual_qty: qty }).eq("id", existingItem.id);
          } else {
            await supabase.from("production_items").insert({
              session_id: sessionId, sku_id, target_qty: 0, planned_qty: 0, actual_qty: qty,
            });
          }
          itemCount++;
        }
      }
      toast.success(`Imported ${itemCount} items across ${sessionCount} sessions${skippedUnknown ? ` · ${skippedUnknown} unknown SKUs skipped` : ""}`);
      onImported?.();
      onOpenChange(false);
      setRows([]); setFileName("");
    } catch (e: any) {
      toast.error(e.message ?? "Import failed");
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5" />Import Production</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>CSV file (exported from Intouch or ERP)</Label>
            <Input type="file" accept=".csv,.txt,.tsv" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
            <p className="text-xs text-muted-foreground mt-1">
              Required columns: <b>Date</b>, <b>Work Centre</b>, <b>Product Code</b>, <b>Qty</b>. Optional: <b>Start Time</b> for shift detection.
              Auto-detects separator (, ; \t |) and European dates (dd/mm/yyyy).
            </p>
          </div>

          {rows.length > 0 && (
            <>
              <div className="flex items-center gap-2 text-sm">
                <Badge variant="secondary" className="gap-1"><CheckCircle2 className="h-3 w-3 text-green-500" />{valid.length} valid</Badge>
                {invalid.length > 0 && <Badge variant="destructive" className="gap-1"><AlertCircle className="h-3 w-3" />{invalid.length} invalid</Badge>}
                <span className="text-muted-foreground">· {fileName}</span>
              </div>

              <div className="border rounded-md max-h-72 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead><TableHead>Shift</TableHead><TableHead>Line</TableHead>
                      <TableHead>SKU</TableHead><TableHead>Qty</TableHead><TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.slice(0, 200).map((r, i) => (
                      <TableRow key={i} className={r.valid ? "" : "bg-destructive/10"}>
                        <TableCell>{r.date || "—"}</TableCell>
                        <TableCell>{r.shift}</TableCell>
                        <TableCell>{r.line || "—"}</TableCell>
                        <TableCell className="font-mono text-xs">{r.sku_code || "—"}</TableCell>
                        <TableCell>{r.qty || "—"}</TableCell>
                        <TableCell className="text-xs">{r.valid ? <span className="text-green-500">OK</span> : <span className="text-destructive">{r.error}</span>}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {rows.length > 200 && <div className="p-2 text-xs text-muted-foreground text-center">Showing first 200 of {rows.length} rows</div>}
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={runImport} disabled={importing || valid.length === 0}>
            <Upload className="h-4 w-4 mr-2" />
            {importing ? "Importing…" : `Import ${valid.length} rows`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ImportProductionDialog;
