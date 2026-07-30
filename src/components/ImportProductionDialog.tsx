import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
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
    const isExcel = /\.(xlsx|xls|xlsm)$/i.test(file.name);

    let header: string[] = [];
    let dataRows: string[][] = [];

    if (isExcel) {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: false });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, raw: false, defval: "" });
      if (aoa.length < 2) { toast.error("Empty file"); return; }
      header = (aoa[0] as any[]).map((c) => String(c ?? "").trim());
      dataRows = (aoa.slice(1) as any[][]).map((r) => r.map((c) => String(c ?? "").trim()));
    } else {
      const text = await file.text();
      const sep = detectSeparator(text);
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length < 2) { toast.error("Empty file"); return; }
      header = lines[0].split(sep).map((c) => c.replace(/^"|"$/g, "").trim());
      dataRows = lines.slice(1).map((l) => l.split(sep).map((c) => c.replace(/^"|"$/g, "").trim()));
    }

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
    for (const cols of dataRows) {
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
      // One transactional call: the whole import runs inside a single SECURITY
      // DEFINER function, so it's all-or-nothing. Previously this looped inserts
      // client-side, so a failure mid-way left a partial import with no rollback.
      // Code matching (case-insensitive + base code) and the free-text fallback
      // for unmatched codes now live in the SQL function.
      const payload = valid.map((r) => ({
        date: r.date, shift: r.shift, line: r.line, sku_code: r.sku_code, qty: r.qty,
      }));
      const { data, error } = await (supabase.rpc as any)("import_production_rows", { _rows: payload });
      if (error) throw error;
      const res = (data ?? {}) as { sessions?: number; items?: number; freetext?: number };
      const sessionCount = res.sessions ?? 0;
      const itemCount = res.items ?? 0;
      const skippedUnknown = res.freetext ?? 0;
      toast.success(`Imported ${itemCount} items across ${sessionCount} sessions${skippedUnknown ? ` · ${skippedUnknown} not in catalog, kept as typed` : ""}`);
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
            <Label>CSV or Excel file (exported from Intouch or ERP)</Label>
            <Input type="file" accept=".csv,.txt,.tsv,.xlsx,.xls,.xlsm" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
            <p className="text-xs text-muted-foreground mt-1">
              Required columns: <b>Date</b>, <b>Work Centre</b>, <b>Product Code</b>, <b>Qty</b>. Optional: <b>Start Time</b> for shift detection.
              Supports .csv, .xlsx, .xls. Auto-detects separator and European dates (dd/mm/yyyy).
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
                        <TableCell className="text-xs">{r.valid ? <span className="text-green-500">OK</span> : <span className="text-destructive-strong">{r.error}</span>}</TableCell>
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
