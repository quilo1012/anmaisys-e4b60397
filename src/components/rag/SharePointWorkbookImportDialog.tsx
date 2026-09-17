import { useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertTriangle, CheckCircle2, ChevronDown, FileSpreadsheet, Loader2, Upload,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { logAuditEvent } from "@/hooks/useAuditLogs";
import {
  buildNewRowInserts, buildPlanUpdates, diffPlans, parseSharePointRagWorkbook, WorkbookShapeError,
  type ExistingRow, type ImportDiff, type WorkbookParseResult,
} from "@/lib/ragSharePointWorkbook";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional display mapping for line names, so the preview reads like the board. */
  lineLabel?: (name: string) => string;
  onImported?: () => void;
}

function day(iso: string) {
  return format(new Date(`${iso}T00:00:00`), "EEE dd MMM");
}

/**
 * Manual reader for the SharePoint "Production RAG Performance" workbook.
 * Parsing happens in the browser — the file is never uploaded. Only plan_qty is
 * written; actuals, UPM, downtime and notes belong to this system.
 */
export function SharePointWorkbookImportDialog({ open, onOpenChange, lineLabel, onImported }: Props) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<WorkbookParseResult | null>(null);
  const [diff, setDiff] = useState<ImportDiff | null>(null);
  const [createMissing, setCreateMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  const label = (l: string) => (lineLabel ? lineLabel(l) : l);

  const reset = () => {
    setFileName(null); setParsed(null); setDiff(null);
    setCreateMissing(false); setError(null); setDragging(false);
  };

  const readFile = async (file: File) => {
    setError(null); setParsed(null); setDiff(null); setCreateMissing(false);
    setFileName(file.name);
    if (!/\.xlsx?$/i.test(file.name)) {
      setError("That is not an Excel file. Choose the .xlsx RAG workbook downloaded from SharePoint.");
      return;
    }
    setBusy(true);
    try {
      const buf = await file.arrayBuffer();

      // The database's own spelling of the lines is the one that wins.
      const { data: lineRows, error: lineErr } = await supabase
        .from("rag_weekly_entries")
        .select("line")
        .order("line");
      if (lineErr) throw lineErr;
      const knownLines = [...new Set((lineRows ?? []).map((r: { line: string }) => r.line))];
      if (knownLines.length === 0) {
        throw new WorkbookShapeError(
          "There are no RAG lines recorded yet, so the file's lines cannot be matched. Add a week on the board first.",
        );
      }

      const result = parseSharePointRagWorkbook(buf, knownLines);
      if (!result.dateRange) {
        throw new WorkbookShapeError("No dated plan columns were found in the weekly sheets.");
      }

      const { data: rows, error: rowsErr } = await supabase
        .from("rag_weekly_entries")
        .select("id, entry_date, line, shift, plan_qty, actual_qty, upm_target, upm_actual, downtime_min, notes, actual_source")
        .gte("entry_date", result.dateRange.from)
        .lte("entry_date", result.dateRange.to);
      if (rowsErr) throw rowsErr;

      setParsed(result);
      setDiff(diffPlans(result.plans, (rows ?? []) as ExistingRow[]));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const rowsToWrite = useMemo(() => {
    if (!diff) return 0;
    return diff.changes.length + (createMissing ? diff.newRows.length : 0);
  }, [diff, createMissing]);

  const writeMutation = useMutation({
    mutationFn: async () => {
      if (!diff) throw new Error("Nothing to import");
      const newRows = createMissing ? diff.newRows : [];
      const planUpdates = buildPlanUpdates(diff.changes);
      const inserts = buildNewRowInserts(newRows);
      if (planUpdates.length === 0 && inserts.length === 0) throw new Error("Nothing to import");

      // Existing rows: keyed on the primary key, plan_qty only. Nothing else is
      // sent, so a newer actual cannot be overwritten by the preview's snapshot.
      // Each change is audited by trg_log_rag_plan_change — we do not duplicate it.
      if (planUpdates.length > 0) {
        const { error } = await (supabase as any)
          .from("rag_weekly_entries")
          .upsert(planUpdates, { onConflict: "id" });
        if (error) throw error;
      }

      if (inserts.length > 0) {
        const { error } = await (supabase as any).from("rag_weekly_entries").insert(inserts);
        if (error) throw error;
      }

      // One summary event per import: who imported which file, when, how many rows.
      await logAuditEvent("import_rag_plan_workbook", "rag_weekly_entry", undefined, {
        source_file: fileName,
        sheets: parsed?.sheets.map((s) => s.name) ?? [],
        date_from: parsed?.dateRange?.from ?? null,
        date_to: parsed?.dateRange?.to ?? null,
        changed_count: planUpdates.length,
        created_count: inserts.length,
      });

      return { updated: planUpdates.length, created: inserts.length };
    },
    onSuccess: ({ updated, created }) => {
      toast.success(
        created > 0
          ? `Plan updated on ${updated} rows and ${created} new rows created`
          : `Plan updated on ${updated} rows`,
      );
      qc.invalidateQueries({ queryKey: ["rag-week"] });
      onImported?.();
      reset();
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message || "Import failed — nothing was changed"),
  });

  const nothingToDo = diff && diff.changes.length === 0 && diff.newRows.length === 0;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />Import from SharePoint file
          </DialogTitle>
          <DialogDescription>
            Choose the "Production RAG Performance" workbook. The file is read here in the browser and
            only the <strong>Plan</strong> figures are written — actual, UPM, downtime and notes are left alone.
          </DialogDescription>
        </DialogHeader>

        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void readFile(f);
            e.target.value = "";
          }}
        />

        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault(); setDragging(false);
            const f = e.dataTransfer.files?.[0];
            if (f) void readFile(f);
          }}
          className={`rounded-md border border-dashed p-4 text-center text-sm ${dragging ? "border-primary bg-primary/5" : "border-border"}`}
        >
          <div className="text-muted-foreground mb-2">
            {fileName ? fileName : "Drop the .xlsx here, or choose it below."}
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />}
            Choose file
          </Button>
        </div>

        {error && (
          <div className="flex items-start gap-2 text-sm bg-destructive/10 text-destructive p-2 rounded">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />{error}
          </div>
        )}

        {parsed && diff && (
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              {parsed.sheets.length} week sheet{parsed.sheets.length === 1 ? "" : "s"} read
              {" — "}
              {parsed.sheets.map((s) => s.name).join(", ")}
              {parsed.dateRange && <> · {day(parsed.dateRange.from)} to {day(parsed.dateRange.to)}</>}
            </div>

            {parsed.overlappingKeys.length > 0 && (
              <div className="text-xs bg-warning/10 text-warning-strong p-2 rounded">
                {parsed.overlappingKeys.length} date/line/shift values appear on more than one sheet — the last sheet wins.
              </div>
            )}

            {parsed.unrecognisedLines.length > 0 && (
              <div className="text-xs bg-warning/10 text-warning-strong p-2 rounded">
                Unrecognised line{parsed.unrecognisedLines.length === 1 ? "" : "s"} — skipped:{" "}
                {parsed.unrecognisedLines.join(", ")}
              </div>
            )}

            {nothingToDo ? (
              <div className="flex items-start gap-2 text-sm bg-success/10 text-success-strong p-2 rounded">
                <CheckCircle2 className="h-4 w-4 mt-0.5" />
                Every plan figure in the file already matches the board. Nothing to change.
              </div>
            ) : (
              <>
                <Collapsible defaultOpen>
                  <CollapsibleTrigger className="flex w-full items-center justify-between rounded border px-3 py-2 text-sm font-medium">
                    <span>Changes <Badge variant="secondary" className="ml-1">{diff.changes.length}</Badge></span>
                    <ChevronDown className="h-4 w-4" />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    {diff.changes.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-muted-foreground">No existing row changes plan.</div>
                    ) : (
                      <ScrollArea className="max-h-72">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Date</TableHead>
                              <TableHead>Line</TableHead>
                              <TableHead>Shift</TableHead>
                              <TableHead className="text-right">Current plan</TableHead>
                              <TableHead className="text-right">File plan</TableHead>
                              <TableHead className="text-right">Difference</TableHead>
                              <TableHead className="text-right">Actual</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {diff.changes.map((c) => {
                              const d = c.filePlan - c.currentPlan;
                              return (
                                <TableRow key={`${c.entry_date}|${c.line}|${c.shift}`}>
                                  <TableCell className="whitespace-nowrap">{day(c.entry_date)}</TableCell>
                                  <TableCell>{label(c.line)}</TableCell>
                                  <TableCell>{c.shift}</TableCell>
                                  <TableCell className="text-right tabular-nums">{c.currentPlan.toLocaleString()}</TableCell>
                                  <TableCell className="text-right tabular-nums font-medium">{c.filePlan.toLocaleString()}</TableCell>
                                  <TableCell className={`text-right tabular-nums ${d > 0 ? "text-success-strong" : "text-destructive"}`}>
                                    {d > 0 ? "+" : ""}{d.toLocaleString()}
                                  </TableCell>
                                  <TableCell className="text-right tabular-nums text-muted-foreground">
                                    {c.actual.toLocaleString()}
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </ScrollArea>
                    )}
                  </CollapsibleContent>
                </Collapsible>

                <Collapsible>
                  <CollapsibleTrigger className="flex w-full items-center justify-between rounded border px-3 py-2 text-sm font-medium">
                    <span>New rows <Badge variant="secondary" className="ml-1">{diff.newRows.length}</Badge></span>
                    <ChevronDown className="h-4 w-4" />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="px-3 py-2 space-y-2">
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={createMissing}
                          disabled={diff.newRows.length === 0}
                          onCheckedChange={(v) => setCreateMissing(Boolean(v))}
                        />
                        also create missing rows (plan only, actual left at 0)
                      </label>
                      {diff.newRows.length > 0 && (
                        <ScrollArea className="max-h-60">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Date</TableHead>
                                <TableHead>Line</TableHead>
                                <TableHead>Shift</TableHead>
                                <TableHead className="text-right">File plan</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {diff.newRows.map((n) => (
                                <TableRow key={`${n.entry_date}|${n.line}|${n.shift}`}>
                                  <TableCell className="whitespace-nowrap">{day(n.entry_date)}</TableCell>
                                  <TableCell>{label(n.line)}</TableCell>
                                  <TableCell>{n.shift}</TableCell>
                                  <TableCell className="text-right tabular-nums">{n.filePlan.toLocaleString()}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </ScrollArea>
                      )}
                    </div>
                  </CollapsibleContent>
                </Collapsible>

                <Collapsible>
                  <CollapsibleTrigger className="flex w-full items-center justify-between rounded border px-3 py-2 text-sm font-medium">
                    <span>
                      Unchanged / skipped
                      <Badge variant="secondary" className="ml-1">{diff.unchanged + diff.skippedEmpty}</Badge>
                    </span>
                    <ChevronDown className="h-4 w-4" />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="px-3 py-2 text-sm text-muted-foreground">
                      {diff.unchanged.toLocaleString()} already match the file · {diff.skippedEmpty.toLocaleString()} empty
                      file cells with no row on the board
                      {parsed.unrecognisedLines.length > 0 && <> · {parsed.unrecognisedLines.length} unrecognised line(s)</>}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {diff && !nothingToDo && (
            <Button onClick={() => writeMutation.mutate()} disabled={rowsToWrite === 0 || writeMutation.isPending}>
              {writeMutation.isPending
                ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Writing...</>
                : `Confirm — write plan on ${rowsToWrite} row${rowsToWrite === 1 ? "" : "s"}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
