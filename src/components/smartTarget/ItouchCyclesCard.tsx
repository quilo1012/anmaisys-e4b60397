import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { Download, FileSpreadsheet, RefreshCw, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useAuth } from "@/contexts/AuthContext";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cleanCycles, type CycleRecord } from "@/lib/smartTargetRates";
import {
  parseProductDetails,
  rejectedCyclesCsv,
  summariseCycles,
  toImportRows,
  type ProductDetailsImport,
} from "@/lib/itouchCycleImport";

const PAGE = 1000;
/** Rows drawn in the list; the CSV always has all of them. */
const LIST_LIMIT = 300;

interface StoredCycles {
  records: CycleRecord[];
  source: string | null;
  importedAt: string | null;
}

/** Every stored row, a page at a time: PostgREST returns at most 1000 per request. */
async function fetchStoredCycles(): Promise<StoredCycles> {
  const rows: { machine: string; sku: string; cycle_seconds: number | null; cavities: number | null; source: string; imported_at: string }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("itouch_cycle_times")
      .select("machine, sku, cycle_seconds, cavities, source, imported_at")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return {
    records: rows.map((r) => ({
      line: r.machine,
      sku: r.sku,
      cycleSeconds: r.cycle_seconds === null ? null : Number(r.cycle_seconds),
      cavities: r.cavities === null ? null : Number(r.cavities),
      source: r.source,
    })),
    source: rows[0]?.source ?? null,
    importedAt: rows.reduce<string | null>((max, r) => (max && max > r.imported_at ? max : r.imported_at), null),
  };
}

function downloadCsv(name: string, body: string) {
  const url = URL.createObjectURL(new Blob([body], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const londonDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "medium", timeStyle: "short" });

/**
 * iTouch's ideal cycle per product and Filler Line, as loaded from its Product Details
 * export. It shows what Smart Target can use and lists the rest for Production. The
 * cycles are not a forecast on their own: they become a rate only with each line's
 * performance factor, which comes from the shift history (the next step).
 */
export function ItouchCyclesCard() {
  const { role } = useAuth();
  const mayImport = can(role, "sku.manage");
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<(ProductDetailsImport & { fileName: string }) | null>(null);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["itouch_cycle_times"],
    queryFn: fetchStoredCycles,
  });

  const clean = useMemo(() => (data ? cleanCycles(data.records) : null), [data]);
  const summary = useMemo(() => (clean ? summariseCycles(clean.cycles, clean.rejected) : []), [clean]);
  const previewClean = useMemo(() => (preview ? cleanCycles(preview.records) : null), [preview]);

  async function readFile(file: File) {
    setReading(true);
    setSaveError(null);
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa = ws ? XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: "" }) : [];
      const today = new Date().toLocaleDateString("en-GB", { timeZone: "Europe/London" });
      setPreview({ ...parseProductDetails(aoa, `iTouch Product Details (${file.name}, loaded ${today})`), fileName: file.name });
    } catch (e) {
      setPreview(null);
      toast.error(`The file could not be read: ${(e as Error).message}`);
    } finally {
      setReading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function save() {
    if (!preview || !preview.records.length) return;
    setSaving(true);
    setSaveError(null);
    const { data: result, error: rpcError } = await supabase.rpc("import_itouch_cycles", {
      p_rows: toImportRows(preview.records) as unknown as Json,
      p_source: preview.records[0].source,
    });
    setSaving(false);
    if (rpcError) {
      setSaveError(rpcError.message);
      return;
    }
    const inserted = (result as { inserted?: number } | null)?.inserted;
    toast.success(`${inserted ?? preview.records.length} iTouch rows loaded.`);
    setPreview(null);
    await queryClient.invalidateQueries({ queryKey: ["itouch_cycle_times"] });
  }

  const loaded = (data?.records.length ?? 0) > 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">iTouch ideal cycle times</CardTitle>
            <p className="text-sm text-muted-foreground">
              Seconds per container for each product on each Filler Line, from iTouch's Product Details export. This
              is the ideal speed: it becomes a rate only once each line's performance is measured from past shifts.
            </p>
          </div>
          {mayImport && (
            <>
              <input
                ref={fileInput}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                aria-label="iTouch Product Details export"
                onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])}
              />
              <Button variant="outline" size="sm" disabled={reading || saving} onClick={() => fileInput.current?.click()}>
                <Upload className="mr-1.5 h-4 w-4" /> {reading ? "Reading…" : "Import iTouch cycles"}
              </Button>
            </>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {preview && (
          <div className="space-y-3 rounded-md border border-primary/40 bg-primary/5 p-3" aria-live="polite">
            <div className="flex items-center gap-2 font-medium">
              <FileSpreadsheet className="h-4 w-4" /> {preview.fileName}
            </div>
            {preview.problems.length > 0 ? (
              <ul className="list-disc pl-5 text-destructive">
                {preview.problems.map((p) => <li key={p}>{p}</li>)}
              </ul>
            ) : (
              <>
                <p>
                  {preview.records.length} rows on {preview.perMachine.length} machines.
                  {previewClean && ` Smart Target can use ${previewClean.cycles.length}; ${previewClean.rejected.length} would go on the list for Production.`}
                  {preview.skippedRows > 0 && ` ${preview.skippedRows} rows without a machine or part code are left out.`}
                </p>
                <ul className="grid gap-1 sm:grid-cols-3">
                  {preview.perMachine.map((m) => (
                    <li key={m.machine} className="tabular-nums">
                      {m.machine}: {m.rows} rows, {m.withCycle} with a cycle
                    </li>
                  ))}
                </ul>
                {preview.unreadable.length > 0 && (
                  <div className="text-amber-700 dark:text-amber-400">
                    {preview.unreadable.length} cells are not numbers and will be stored as no value:
                    <ul className="mt-1 list-disc pl-5">
                      {preview.unreadable.slice(0, 10).map((u, i) => (
                        <li key={i}>{u.machine} · {u.sku} · {u.column}: "{u.value}"</li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="text-muted-foreground">Loading replaces every cycle time stored now.</p>
              </>
            )}
            {saveError && <p className="text-destructive">Not loaded: {saveError}</p>}
            <div className="flex gap-2">
              {preview.problems.length === 0 && (
                <Button size="sm" onClick={save} disabled={saving}>
                  {saving ? "Loading…" : `Load ${preview.records.length} rows`}
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => { setPreview(null); setSaveError(null); }} disabled={saving}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {error ? (
          <div className="flex flex-wrap items-center justify-between gap-3 text-destructive">
            <span>The cycle times could not be loaded: {(error as Error).message}</span>
            <button type="button" onClick={() => refetch()} className="inline-flex items-center gap-1.5 font-medium underline-offset-4 hover:underline">
              <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} /> Try again
            </button>
          </div>
        ) : isLoading ? (
          <Skeleton className="h-20" />
        ) : !loaded ? (
          <p className="text-muted-foreground">
            No iTouch cycles loaded yet.
            {mayImport ? " Export Product Details from iTouch and import the file here." : " Someone who manages SKUs can import them."}
          </p>
        ) : (
          <>
            <p className="text-muted-foreground">
              {data!.source}
              {data!.importedAt && <>, stored {londonDateTime(data!.importedAt)}</>}.
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {summary.map((s) => (
                <div key={s.line} className="rounded-md border p-2">
                  <div className="font-medium">Line {s.line}</div>
                  <div className="tabular-nums">{s.usable} usable</div>
                  <div className={cn("tabular-nums text-xs", s.forProduction ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
                    {s.forProduction} for Production
                  </div>
                </div>
              ))}
            </div>
            {clean && clean.rejected.length > 0 && (
              <details className="rounded-md border p-3">
                <summary className="cursor-pointer font-medium">
                  For Production to fix in iTouch <Badge variant="outline" className="ml-1">{clean.rejected.length}</Badge>
                </summary>
                <div className="mt-2 flex justify-end">
                  <Button size="sm" variant="outline" onClick={() => downloadCsv("itouch-cycles-for-production.csv", rejectedCyclesCsv(clean.rejected))}>
                    <Download className="mr-1.5 h-4 w-4" /> Download CSV
                  </Button>
                </div>
                <div className="mt-2 max-h-80 overflow-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-card">
                      <tr><th className="py-1 pr-2">Line</th><th className="py-1 pr-2">SKU</th><th className="py-1 pr-2">Cycle (s)</th><th className="py-1">Why it is not used</th></tr>
                    </thead>
                    <tbody>
                      {clean.rejected.slice(0, LIST_LIMIT).map((r, i) => (
                        <tr key={`${r.line}|${r.sku}|${i}`} className="border-t">
                          <td className="py-1 pr-2 whitespace-nowrap">{r.line}</td>
                          <td className="py-1 pr-2 font-mono">{r.sku}</td>
                          <td className="py-1 pr-2 tabular-nums">{r.cycleSeconds ?? "—"}</td>
                          <td className="py-1">{r.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {clean.rejected.length > LIST_LIMIT && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Showing the first {LIST_LIMIT} of {clean.rejected.length}. The CSV has all of them.
                  </p>
                )}
              </details>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
