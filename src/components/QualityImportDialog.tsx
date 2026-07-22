import { useState } from "react";
import XLSX from "xlsx-js-style";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Upload, FileDown } from "lucide-react";

interface ActionType { id: string; label: string }

interface ParsedRow {
  action_no: string | null;
  line: string | null;
  status: string;
  department: string | null;
  leader_name: string | null;
  labels: string[];
  action_type_id: string | null;
  description: string | null;
  recorded_at: string;
}

const TEMPLATE_HEADERS = ["Date", "Action #", "Line", "Status", "Department", "Leader", "Labels", "Type", "Notes"];

function cell(row: Record<string, unknown>, aliases: string[]): string {
  for (const key of Object.keys(row)) {
    const k = key.trim().toLowerCase();
    if (aliases.includes(k)) return String(row[key] ?? "").trim();
  }
  return "";
}

function parseDate(s: string): string {
  if (!s) return new Date().toISOString();
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (dmy) {
    const d = Number(dmy[1]); const m = Number(dmy[2]); let y = Number(dmy[3]);
    if (y < 100) y += 2000;
    const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    if (!isNaN(dt.getTime())) return dt.toISOString();
  }
  const dt = new Date(s);
  return isNaN(dt.getTime()) ? new Date().toISOString() : dt.toISOString();
}

function mapStatus(s: string): string {
  const v = s.toLowerCase();
  if (/(progress|wip|andamento)/.test(v)) return "in_progress";
  if (/(complete|completed|done|closed|conclu|fechad)/.test(v)) return "complete";
  return "todo";
}

export function QualityImportDialog({
  open,
  onOpenChange,
  types,
  onImported,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  types: ActionType[];
  onImported: () => void;
}) {
  const { user } = useAuth();
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [importing, setImporting] = useState(false);

  const handleFile = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: false });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(ws, { defval: "", raw: false }) as Record<string, unknown>[];
      const typeByLabel = new Map(types.map((t) => [t.label.trim().toLowerCase(), t.id]));
      const parsed: ParsedRow[] = json
        .map((r) => {
          const typeStr = cell(r, ["type", "tipo"]);
          const labelsStr = cell(r, ["labels", "label", "etiquetas", "etiqueta"]);
          return {
            action_no: cell(r, ["action #", "action no", "action", "ac", "number", "numero", "número", "#"]) || null,
            line: cell(r, ["line", "linha"]) || null,
            status: mapStatus(cell(r, ["status"])),
            department: cell(r, ["department", "dept", "departamento"]) || null,
            leader_name: cell(r, ["leader", "lider", "líder"]) || null,
            labels: labelsStr ? labelsStr.split(/[,;]/).map((x) => x.trim()).filter(Boolean) : [],
            action_type_id: typeStr ? (typeByLabel.get(typeStr.toLowerCase()) ?? null) : null,
            description: cell(r, ["notes", "note", "problem", "problema", "description", "descrição", "descricao", "nota"]) || null,
            recorded_at: parseDate(cell(r, ["date", "when", "data"])),
          };
        })
        .filter((r) => r.description || r.action_no || r.line || r.labels.length);
      if (parsed.length === 0) {
        toast.error("No rows found. Check the column headers.");
        return;
      }
      setRows(parsed);
      setFileName(file.name);
    } catch (e) {
      toast.error(`Could not read file: ${(e as Error)?.message ?? "unknown error"}`);
    }
  };

  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS, ["22/07/2026", "AC-6114", "Line 4", "To do", "Quality", "John Doe", "CCP; Foreign Body", "", "Piece of plastic found in the barrel"]]);
    ws["!cols"] = TEMPLATE_HEADERS.map(() => ({ wch: 18 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Actions");
    XLSX.writeFile(wb, "quality-actions-template.xlsx");
  };

  const importAll = async () => {
    if (rows.length === 0) return;
    setImporting(true);
    try {
      const payload = rows.map((r) => ({ ...r, recorded_by: user?.id ?? null, points: 1 }));
      // insert in chunks to stay well within request limits
      for (let i = 0; i < payload.length; i += 200) {
        const { error } = await supabase.from("quality_actions").insert(payload.slice(i, i + 200));
        if (error) throw error;
      }
      toast.success(`Imported ${rows.length} action${rows.length === 1 ? "" : "s"}`);
      onImported();
      onOpenChange(false);
      setRows([]);
      setFileName("");
    } catch (e) {
      toast.error(`Import failed: ${(e as Error)?.message ?? "unknown error"}`);
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) { setRows([]); setFileName(""); } }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>Import quality actions from Excel</DialogTitle></DialogHeader>

        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Columns (any order, header row required): <span className="font-medium">{TEMPLATE_HEADERS.join(", ")}</span>.
            Status accepts To do / In progress / Complete. Labels separated by comma or semicolon.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={downloadTemplate}><FileDown className="mr-1 h-4 w-4" /> Template</Button>
            <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">
              <Upload className="h-4 w-4" /> Choose file
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
              />
            </label>
            {fileName && <span className="text-xs text-muted-foreground">{fileName} · {rows.length} rows</span>}
          </div>

          {rows.length > 0 && (
            <div className="overflow-x-auto rounded border">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/40 uppercase text-muted-foreground">
                    <th className="px-2 py-1 text-left font-medium">Date</th>
                    <th className="px-2 py-1 text-left font-medium">#</th>
                    <th className="px-2 py-1 text-left font-medium">Line</th>
                    <th className="px-2 py-1 text-left font-medium">Status</th>
                    <th className="px-2 py-1 text-left font-medium">Dept</th>
                    <th className="px-2 py-1 text-left font-medium">Labels</th>
                    <th className="px-2 py-1 text-left font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 20).map((r, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="whitespace-nowrap px-2 py-1">{r.recorded_at.slice(0, 10)}</td>
                      <td className="px-2 py-1 font-mono">{r.action_no ?? "—"}</td>
                      <td className="px-2 py-1">{r.line ?? "—"}</td>
                      <td className="px-2 py-1">{r.status}</td>
                      <td className="px-2 py-1">{r.department ?? "—"}</td>
                      <td className="px-2 py-1"><div className="flex flex-wrap gap-0.5">{r.labels.map((l) => <Badge key={l} variant="secondary" className="text-[9px]">{l}</Badge>)}</div></td>
                      <td className="max-w-[220px] truncate px-2 py-1">{r.description ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 20 && <p className="px-2 py-1 text-[11px] text-muted-foreground">Showing first 20 of {rows.length}.</p>}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button onClick={importAll} disabled={rows.length === 0 || importing}>
            {importing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Upload className="mr-1 h-4 w-4" />}
            Import {rows.length > 0 ? rows.length : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
