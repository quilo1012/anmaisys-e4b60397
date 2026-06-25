import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { format, getISOWeek } from "date-fns";
import { parseRagLayoutFile, type ParseResult } from "@/lib/ragLayoutParser";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  knownLines: string[];
  weekStart: Date;
  weekDates: Date[];
  onImported?: () => void;
}

export function RAGImportDialog({
  open, onOpenChange, knownLines, weekStart, weekDates, onImported,
}: Props) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ParseResult | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  const reset = () => {
    setFile(null); setPreview(null); setParseError(null); setParsing(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleFile = async (f: File) => {
    setFile(f); setParsing(true); setParseError(null); setPreview(null);
    try {
      const result = await parseRagLayoutFile(f, knownLines, weekStart, weekDates);
      if (!result.rows.length) {
        setParseError("No RAG data detected. Check that line names match and dates fall in the selected week.");
      } else {
        setPreview(result);
      }
    } catch (e) {
      setParseError(e instanceof Error ? e.message : String(e));
    } finally {
      setParsing(false);
    }
  };

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!preview) throw new Error("Nothing to import");
      const BATCH = 500;
      let count = 0;
      for (let i = 0; i < preview.rows.length; i += BATCH) {
        const slice = preview.rows.slice(i, i + BATCH);
        const { error } = await supabase
          .from("rag_weekly_entries")
          .upsert(slice, { onConflict: "entry_date,line,shift" });
        if (error) throw error;
        count += slice.length;
      }
      return count;
    },
    onSuccess: (n) => {
      toast.success(`Imported ${n} records`);
      qc.invalidateQueries({ queryKey: ["rag-week"] });
      onImported?.();
      reset();
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" /> Import RAG Excel
          </DialogTitle>
          <DialogDescription>
            Week {getISOWeek(weekStart)} · {format(weekStart, "dd MMM")} – {format(weekDates[6], "dd MMM yyyy")}.
            Upload the weekly RAG file (block layout: Plan / Actual / Downtime per line, Day/Night).
          </DialogDescription>
        </DialogHeader>

        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />

        {!file && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="border-2 border-dashed rounded-lg p-8 text-center hover:bg-muted/40 transition"
          >
            <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
            <div className="font-medium">Click to select Excel file</div>
            <div className="text-xs text-muted-foreground mt-1">.xlsx or .xls</div>
          </button>
        )}

        {file && (
          <div className="space-y-3">
            <div className="flex items-center justify-between bg-muted/40 rounded p-3">
              <div className="flex items-center gap-2 text-sm">
                <FileSpreadsheet className="h-4 w-4" />
                <span className="font-medium truncate">{file.name}</span>
                <span className="text-muted-foreground">({(file.size / 1024).toFixed(1)} KB)</span>
              </div>
              <Button variant="ghost" size="sm" onClick={reset}>Change</Button>
            </div>

            {parsing && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Parsing file…
              </div>
            )}

            {parseError && (
              <div className="flex items-start gap-2 rounded border border-destructive/30 bg-destructive/5 p-3 text-sm">
                <AlertTriangle className="h-4 w-4 mt-0.5 text-destructive" />
                <div className="text-destructive">{parseError}</div>
              </div>
            )}

            {preview && (
              <div className="rounded border bg-emerald-500/5 border-emerald-500/30 p-3 space-y-2 text-sm">
                <div className="flex items-center gap-2 font-medium text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="h-4 w-4" /> Preview ready
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div><span className="text-muted-foreground">Records:</span> <b>{preview.rows.length}</b></div>
                  <div><span className="text-muted-foreground">Blocks:</span> <b>{preview.blocksFound}</b></div>
                  <div><span className="text-muted-foreground">Metric rows:</span> <b>{preview.metricRowsFound}</b></div>
                  <div><span className="text-muted-foreground">Dates:</span> <b>{preview.datesDetected.length}</b></div>
                </div>
                <div className="text-xs">
                  <div className="text-muted-foreground mb-1">Lines detected ({preview.linesDetected.length}):</div>
                  <div className="flex flex-wrap gap-1">
                    {preview.linesDetected.map((l) => (
                      <span key={l} className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-800 dark:text-emerald-200">
                        {l}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
            disabled={!preview || importMutation.isPending}
            onClick={() => importMutation.mutate()}
          >
            {importMutation.isPending ? (
              <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Importing…</>
            ) : (
              <>Import {preview?.rows.length ?? 0} records</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
