import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { CloudDownload, Loader2, CheckCircle2, AlertTriangle, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { parseRagLayoutFile, type ParseResult } from "@/lib/ragLayoutParser";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  knownLines: string[];
  weekStart: Date;
  weekDates: Date[];
  onImported?: () => void;
}

export function SharePointImportDialog({
  open, onOpenChange, knownLines, weekStart, weekDates, onImported,
}: Props) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [shareUrl, setShareUrl] = useState("");
  const [preview, setPreview] = useState<ParseResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const reset = () => { setShareUrl(""); setPreview(null); setErr(null); };

  const parseFile = async (file: File) => {
    setErr(null);
    const result = await parseRagLayoutFile(file, knownLines, weekStart, weekDates);
    if (!result.rows.length) throw new Error("No RAG data detected for selected week. Check line names and dates.");
    setPreview(result);
  };

  const fetchMutation = useMutation({
    mutationFn: async () => {
      setErr(null); setPreview(null);
      const { data, error } = await supabase.functions.invoke("sharepoint-download-file", {
        body: { shareUrl: shareUrl.trim() },
      });
      if (error) throw error;
      if (data?.fallback) throw new Error(data.message || data.error || "SharePoint download is not available for this Microsoft account. Upload the Excel file manually below.");
      if (!data?.base64) throw new Error("No file returned");
      const bin = atob(data.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const file = new File([bytes], "sharepoint-rag.xlsx", {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const result = await parseRagLayoutFile(file, knownLines, weekStart, weekDates);
      if (!result.rows.length) throw new Error("No RAG data detected for selected week. Check line names and dates.");
      return result;
    },
    onSuccess: (p) => setPreview(p),
    onError: (e: Error) => setErr(e.message),
  });

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!preview) throw new Error("Nothing to import");
      const BATCH = 500;
      let count = 0;
      for (let i = 0; i < preview.rows.length; i += BATCH) {
        const slice = preview.rows.slice(i, i + BATCH);
        const { error } = await supabase
          .from("rag_weekly_entries")
          .upsert(slice as any, { onConflict: "entry_date,line,shift" });
        if (error) throw error;
        count += slice.length;
      }
      return count;
    },
    onSuccess: (n) => {
      toast.success(`Imported ${n} records from SharePoint`);
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
            <CloudDownload className="h-5 w-5" /> Import RAG from SharePoint
          </DialogTitle>
          <DialogDescription>
            Cola o link de partilha (Share link) do ficheiro Excel no SharePoint/OneDrive.
            O sistema baixa, lê e atualiza apenas os números (Plan / Actual / Downtime) para a semana selecionada.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) parseFile(f).catch((error) => setErr(error instanceof Error ? error.message : String(error)));
            }}
          />

          <div>
            <Label htmlFor="sp-url">SharePoint Share URL</Label>
            <Input
              id="sp-url"
              value={shareUrl}
              onChange={(e) => setShareUrl(e.target.value)}
              placeholder="https://yourtenant.sharepoint.com/:x:/s/..."
            />
            <p className="text-xs text-muted-foreground mt-1">
              No Excel/SharePoint: <strong>Share → Copy link</strong> (permissão "Anyone with link" ou "People in your org").
            </p>
          </div>

          {err && (
            <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 p-2 rounded">
              <AlertTriangle className="h-4 w-4 mt-0.5" /> {err}
            </div>
          )}

          <div className="rounded border border-dashed p-3 text-sm space-y-2">
            <div className="text-muted-foreground">
              If SharePoint cannot download with this Microsoft account, download the Excel file and upload it here.
            </div>
            <Button type="button" variant="outline" onClick={() => inputRef.current?.click()}>
              <FileSpreadsheet className="h-4 w-4 mr-1" />Upload Excel manually
            </Button>
          </div>

          {preview && (
            <div className="flex items-start gap-2 text-sm bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 p-2 rounded">
              <CheckCircle2 className="h-4 w-4 mt-0.5" />
              {preview.rows.length} registros detectados.
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {!preview ? (
            <Button onClick={() => fetchMutation.mutate()} disabled={!shareUrl.trim() || fetchMutation.isPending}>
              {fetchMutation.isPending ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Fetching...</> : "Fetch & Preview"}
            </Button>
          ) : (
            <Button onClick={() => importMutation.mutate()} disabled={importMutation.isPending}>
              {importMutation.isPending ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Importing...</> : `Import ${preview.rows.length} records`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
