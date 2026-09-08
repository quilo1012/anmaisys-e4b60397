import { useState } from "react";
import XLSX from "xlsx-js-style";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { parseQualityImport, type QualityImportResult } from "@/lib/qualityImport";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Upload } from "lucide-react";

/**
 * Imports a workbook exported by "Export Excel" (the `Actions` sheet) after it was
 * filled or corrected by hand. Shows every row with its verdict first; only the valid
 * rows are written, and only after the user confirms.
 */
export function QualityTemplateImportDialog({
  open, onOpenChange, leaders, onImported,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  leaders: { id: string; name: string }[];
  onImported: () => void;
}) {
  const { user } = useAuth();
  const [result, setResult] = useState<QualityImportResult | null>(null);
  const [fileName, setFileName] = useState("");
  const [importing, setImporting] = useState(false);

  const reset = () => { setResult(null); setFileName(""); };

  const handleFile = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets["Actions"] ?? wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(ws, { defval: "", raw: false }) as Record<string, unknown>[];
      const parsed = parseQualityImport(json, leaders);
      if (parsed.rows.length === 0) { toast.error("No rows found on the Actions sheet."); return; }
      setResult(parsed);
      setFileName(file.name);
    } catch (e) {
      toast.error(`Could not read file: ${(e as Error)?.message ?? "unknown error"}`);
    }
  };

  const importValid = async () => {
    if (!result || result.valid === 0) return;
    setImporting(true);
    try {
      const payload = result.rows
        .filter((r) => r.payload)
        .map((r) => ({ ...r.payload!, recorded_by: user?.id ?? null }));
      for (let i = 0; i < payload.length; i += 200) {
        const { error } = await supabase.from("quality_actions").insert(payload.slice(i, i + 200));
        if (error) throw error;
      }
      toast.success(`Imported ${payload.length} action${payload.length === 1 ? "" : "s"}`);
      onImported();
      onOpenChange(false);
      reset();
    } catch (e) {
      toast.error(`Import failed: ${(e as Error)?.message ?? "unknown error"}`);
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader><DialogTitle>Import a filled report (Excel)</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Reads the <span className="font-medium">Actions</span> sheet of a workbook exported from this page.
            The Product column is ignored (it is looked up from the SKU). Rows with an unreadable date,
            an unknown severity or an incomplete safety row are listed but not imported.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">
              <Upload className="h-4 w-4" /> Choose file
              <input type="file" accept=".xlsx,.xls,.csv" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
            </label>
            {result && (
              <span className="text-xs text-muted-foreground">
                {fileName} · {result.valid} valid · {result.rejected > 0 && <span className="text-destructive">{result.rejected} rejected</span>}{result.rejected === 0 && "0 rejected"}
              </span>
            )}
          </div>

          {result && (
            <div className="overflow-x-auto rounded border">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/40 uppercase text-muted-foreground">
                    <th className="px-2 py-1 text-left font-medium">Row</th>
                    <th className="px-2 py-1 text-left font-medium">Date</th>
                    <th className="px-2 py-1 text-left font-medium">Line</th>
                    <th className="px-2 py-1 text-left font-medium">Leader</th>
                    <th className="px-2 py-1 text-left font-medium">Sev.</th>
                    <th className="px-2 py-1 text-left font-medium">SKU</th>
                    <th className="px-2 py-1 text-left font-medium">Notes</th>
                    <th className="px-2 py-1 text-left font-medium">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.slice(0, 50).map((r) => (
                    <tr key={r.rowNo} className={`border-b last:border-0 ${r.payload ? "" : "bg-destructive/5"}`}>
                      <td className="px-2 py-1 font-mono">{r.rowNo}</td>
                      <td className="whitespace-nowrap px-2 py-1">{r.form.date || "—"}</td>
                      <td className="px-2 py-1">{r.form.line || "—"}</td>
                      <td className="px-2 py-1">{r.form.leader_name || "—"}</td>
                      <td className="px-2 py-1">{r.form.severity || "—"}</td>
                      <td className="px-2 py-1 font-mono">{r.form.sku || "—"}</td>
                      <td className="max-w-[200px] truncate px-2 py-1">{r.form.description || "—"}</td>
                      <td className="px-2 py-1">
                        {r.errors.length > 0
                          ? <span className="text-destructive">{r.errors.join("; ")}</span>
                          : <span className="text-emerald-600">OK</span>}
                        {r.warnings.length > 0 && <span className="ml-1 text-amber-600">{r.warnings.join("; ")}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {result.rows.length > 50 && <p className="px-2 py-1 text-2xs text-muted-foreground">Showing first 50 of {result.rows.length}.</p>}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={importValid} disabled={!result || result.valid === 0 || importing}>
            {importing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Upload className="mr-1 h-4 w-4" />}
            Import {result?.valid ?? 0} valid
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
