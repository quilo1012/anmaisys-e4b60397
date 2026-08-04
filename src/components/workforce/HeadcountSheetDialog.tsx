import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Download, Upload, AlertTriangle, Loader2 } from "lucide-react";
import {
  buildHeadcountWorkbook, parseHeadcountWorkbook, datesBetween,
  type ImportPreview,
} from "@/lib/headcountSheet";
import type { HeadcountArea, HeadcountEmployee, Allocation } from "@/hooks/useHeadcount";

/**
 * The board out to the factory's spreadsheet and back again, over a range of days.
 *
 * Import never writes on the strength of a guess. It shows what it matched and what
 * it could not, and waits — a name it cannot place is listed rather than dropped
 * silently, because a board that is quietly missing three people looks exactly like
 * a board that is right.
 */
export function HeadcountSheetDialog({
  open, onOpenChange, mode, date, shift, areas, roster, canManage, onImported,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mode: "export" | "import";
  /** The day the board is on, used as the default range and the year for bare tabs. */
  date: string;
  shift: string;
  areas: HeadcountArea[];
  roster: HeadcountEmployee[];
  canManage: boolean;
  onImported: () => void;
}) {
  const [from, setFrom] = useState(date);
  const [to, setTo] = useState(date);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const close = () => { setPreview(null); onOpenChange(false); };

  const runExport = async () => {
    setBusy(true);
    try {
      const days = datesBetween(from, to);
      if (days.length === 0 || days.length > 62) {
        toast.error("Choose a range between one day and two months");
        return;
      }
      const { data, error } = await supabase
        .from("daily_allocations")
        .select("*")
        .gte("on_date", from).lte("on_date", to).eq("shift", shift);
      if (error) throw error;

      const byDay = new Map<string, Allocation[]>();
      for (const a of (data ?? []) as unknown as Allocation[]) {
        const key = `${a.on_date}|${a.shift}`;
        if (!byDay.has(key)) byDay.set(key, []);
        byDay.get(key)!.push(a);
      }

      const wb = buildHeadcountWorkbook({
        days: days.map((d) => ({ date: d, shift })),
        areas,
        employeeById: new Map(roster.map((e) => [e.id, e])),
        allocationsFor: (d, s) => byDay.get(`${d}|${s}`) ?? [],
      });
      XLSX.writeFile(wb, `headcount-${shift.toLowerCase()}-${from}-to-${to}.xlsx`);
      toast.success(`Exported ${days.length} day${days.length === 1 ? "" : "s"}`);
      close();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const readFile = async (file: File) => {
    setBusy(true);
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      setPreview(parseHeadcountWorkbook(wb, {
        areas, roster, shift, fallbackYear: Number(date.slice(0, 4)),
      }));
    } catch (e) {
      toast.error(`Could not read the file: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!preview || preview.matched.length === 0) return;
    setBusy(true);
    try {
      const rows = preview.matched.map((m) => ({
        on_date: m.date,
        shift: m.shift,
        employee_id: m.employeeId,
        area_id: m.status === "assigned" || m.status === "overtime" ? m.areaId : null,
        status: m.status,
      }));
      // Upsert on the day/shift/person key the table already enforces, so importing
      // the same sheet twice moves people rather than duplicating them. Anyone
      // already on the day and absent from the file is left alone — the file says
      // what it knows, not what is untrue.
      const { error } = await supabase
        .from("daily_allocations")
        .upsert(rows, { onConflict: "on_date,shift,employee_id" });
      if (error) throw error;
      toast.success(`Imported ${rows.length} allocation${rows.length === 1 ? "" : "s"}`);
      onImported();
      close();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(v) : close())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === "export" ? "Export headcount" : "Import headcount"}</DialogTitle>
          <DialogDescription>
            {mode === "export"
              ? `One sheet per day, in the factory's layout. ${shift} shift.`
              : `Reads the same layout back. Nothing is saved until you confirm. ${shift} shift.`}
          </DialogDescription>
        </DialogHeader>

        {mode === "export" && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">From</Label>
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">To</Label>
                <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1" />
              </div>
            </div>
            <Button onClick={runExport} disabled={busy || !from || !to} className="w-full">
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              Export {datesBetween(from, to).length || 0} day(s)
            </Button>
          </div>
        )}

        {mode === "import" && (
          <div className="space-y-4">
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f); e.target.value = ""; }}
            />
            {!preview && (
              <Button onClick={() => fileRef.current?.click()} disabled={busy} className="w-full">
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                Choose a spreadsheet
              </Button>
            )}

            {preview && (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline" className="border-emerald-500/40 text-success-strong">
                    {preview.matched.length} matched
                  </Badge>
                  <Badge variant="outline">{preview.days.length} day(s)</Badge>
                  {preview.unmatchedNames.length > 0 && (
                    <Badge variant="outline" className="border-amber-500/40 text-warning-strong">
                      {preview.unmatchedNames.length} not matched
                    </Badge>
                  )}
                </div>

                {(preview.unmatchedNames.length > 0 || preview.unknownColumns.length > 0 || preview.skippedSheets.length > 0) && (
                  <div className="max-h-52 space-y-2 overflow-y-auto rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 text-2xs">
                    <div className="flex items-center gap-1.5 font-semibold text-warning-strong">
                      <AlertTriangle className="h-3.5 w-3.5" /> These will not be imported
                    </div>
                    {preview.unmatchedNames.length > 0 && (
                      <div>
                        <div className="font-semibold">Names nobody on this shift answers to</div>
                        <ul className="mt-0.5 space-y-0.5 text-muted-foreground">
                          {preview.unmatchedNames.slice(0, 25).map((u, i) => (
                            <li key={i}>“{u.name}” — {u.column}, {u.date}</li>
                          ))}
                          {preview.unmatchedNames.length > 25 && <li>…and {preview.unmatchedNames.length - 25} more</li>}
                        </ul>
                      </div>
                    )}
                    {preview.unknownColumns.length > 0 && (
                      <div>
                        <div className="font-semibold">Columns that are not an area</div>
                        <div className="text-muted-foreground">{preview.unknownColumns.join(", ")}</div>
                      </div>
                    )}
                    {preview.skippedSheets.length > 0 && (
                      <div>
                        <div className="font-semibold">Tabs with no readable date</div>
                        <div className="text-muted-foreground">{preview.skippedSheets.join(", ")}</div>
                      </div>
                    )}
                  </div>
                )}

                <p className="text-2xs text-muted-foreground">
                  Anyone already on these days who is not in the file keeps their place — the
                  file says what it knows, not what is untrue.
                </p>

                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setPreview(null)} className="flex-1">Choose another</Button>
                  <Button onClick={commit} disabled={busy || !canManage || preview.matched.length === 0} className="flex-1">
                    {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Import {preview.matched.length}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
