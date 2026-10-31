import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Loader2, FileText, Download, Share2, History, ChevronDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  fetchMaintenanceShiftReport, quickShift, validateShiftSelection, londonStamp, shiftWindowAt,
  type QuickShift, type ShiftReport,
} from "@/lib/maintenanceShiftReport";
import { reportToFile, type ReportFormat } from "@/lib/maintenanceReportExport";
import { recordReportGenerated, useMaintenanceReportHistory } from "@/hooks/useMaintenanceReportHistory";
import type { ShiftCode } from "@/lib/shifts";

/** The chosen option has to read as chosen from arm's length on a line tablet. */
const ON = "data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground";

const QUICK: { value: QuickShift | "custom"; label: string }[] = [
  { value: "current", label: "Current shift" },
  { value: "previous", label: "Previous shift" },
  { value: "yesterday-day", label: "Yesterday — Day" },
  { value: "yesterday-night", label: "Yesterday — Night" },
  { value: "custom", label: "Custom date" },
];

const FORMATS: { value: ReportFormat; label: string }[] = [
  { value: "pdf", label: "PDF" },
  { value: "txt", label: "TXT" },
  { value: "xlsx", label: "Excel" },
];

const ddmmyyyy = (iso: string) => iso.split("-").reverse().join("/");

function download(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoked on the next tick: Safari cancels a download whose URL is revoked at once.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

const canShareFile = (file: File) =>
  typeof navigator !== "undefined" && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] });

/**
 * Pick a shift — the running one, an earlier one, any date — and get that shift's
 * maintenance report as PDF, TXT or Excel.
 *
 * Every "Generate" reads the database again for the shift chosen. Downloading the
 * same report in another format afterwards reuses that one reading on purpose, so the
 * PDF and the TXT of one report are the same report.
 */
export function MaintenanceReportDialog({
  open, onOpenChange, generatedBy,
}: { open: boolean; onOpenChange: (v: boolean) => void; generatedBy: string | null }) {
  const { toast } = useToast();
  const [quick, setQuick] = useState<QuickShift | "custom">("current");
  const [sessionDate, setSessionDate] = useState(() => shiftWindowAt(new Date()).sessionDate);
  const [shift, setShift] = useState<ShiftCode>(() => shiftWindowAt(new Date()).shift);
  const [format, setFormat] = useState<ReportFormat>("pdf");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ report: ShiftReport; file: File; format: ReportFormat } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const history = useMaintenanceReportHistory(open && historyOpen);

  // Re-anchor the quick choices every time the dialog opens: a tablet left on all
  // night must not offer yesterday's "current shift".
  useEffect(() => {
    if (!open) return;
    const q = quickShift("current", new Date());
    setQuick("current"); setSessionDate(q.sessionDate); setShift(q.shift);
    setResult(null); setError(null);
  }, [open]);

  const pickQuick = (v: string) => {
    if (!v) return;
    const k = v as QuickShift | "custom";
    setQuick(k);
    setResult(null); setError(null);
    if (k !== "custom") {
      const q = quickShift(k, new Date());
      setSessionDate(q.sessionDate); setShift(q.shift);
    }
  };

  const todayFactory = shiftWindowAt(new Date()).sessionDate;
  const check = useMemo(() => validateShiftSelection(sessionDate, shift, new Date()), [sessionDate, shift]);

  const generate = async () => {
    const now = new Date();
    const v = validateShiftSelection(sessionDate, shift, now);
    // `"error" in v`, not `!v.ok`: this project compiles without strictNullChecks,
    // which leaves a boolean discriminant unnarrowed.
    if ("error" in v) { setError(v.error); return; }
    setBusy(true); setError(null); setResult(null);
    try {
      const report = await fetchMaintenanceShiftReport(now, { window: v.window, generatedBy, handoverNotes: notes });
      const file = await reportToFile(report, format);
      download(file);
      setResult({ report, file, format });
      void recordReportGenerated(report, format);
      if (report.problems.length > 0) {
        toast({
          title: "Report downloaded — NOT validated",
          description: `${report.problems.length} record${report.problems.length === 1 ? "" : "s"} disagree. They are listed in the file.`,
          variant: "destructive",
        });
      } else {
        toast({ title: "Report downloaded", description: `${file.name} · ${report.stopsRead} stop(s) read` });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "The stoppages could not be read. Check the connection and try again.";
      setError(msg);
      toast({ title: "Report not downloaded", description: msg, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const again = async (f: ReportFormat) => {
    if (!result) return;
    const file = f === result.format ? result.file : await reportToFile(result.report, f);
    download(file);
  };

  const share = async () => {
    if (!result) return;
    try {
      await navigator.share({ files: [result.file], title: result.file.name });
    } catch (err: unknown) {
      // Closing the share sheet is a choice, not an error.
      if (!(err instanceof Error) || err.name !== "AbortError") {
        toast({ title: "Could not share", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
      }
    }
  };

  const w = "window" in check ? check.window : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Maintenance Shift Report</DialogTitle>
          <DialogDescription>Choose the shift. The report is read from the database when you press Generate.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Quick selection</Label>
            <ToggleGroup type="single" value={quick} onValueChange={pickQuick} className="flex flex-wrap justify-start gap-1.5">
              {QUICK.map((q) => (
                <ToggleGroupItem key={q.value} value={q.value} variant="outline" size="sm" className={cn("h-9", ON)}>{q.label}</ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Shift</Label>
              <ToggleGroup
                type="single" value={shift}
                onValueChange={(v) => { if (v) { setShift(v as ShiftCode); setQuick("custom"); setResult(null); setError(null); } }}
                className="grid grid-cols-1 gap-1.5"
              >
                <ToggleGroupItem value="day" variant="outline" size="sm" className={cn("h-9 justify-start", ON)}>Day Shift (06:00–18:00)</ToggleGroupItem>
                <ToggleGroupItem value="night" variant="outline" size="sm" className={cn("h-9 justify-start", ON)}>Night Shift (18:00–06:00)</ToggleGroupItem>
              </ToggleGroup>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="report-date">Report date</Label>
              <Input
                id="report-date" type="date" value={sessionDate} max={todayFactory}
                onChange={(e) => { setSessionDate(e.target.value); setQuick("custom"); setResult(null); setError(null); }}
                className="h-9"
              />
              <p className="text-xs text-muted-foreground">A night shift keeps the date it started on.</p>
            </div>
          </div>

          <div className={cn("rounded-md border p-3 text-sm", w ? "bg-muted/40" : "border-destructive/40 bg-destructive/5")} aria-live="polite">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Selected report</div>
            {w ? (
              <>
                <div className="font-semibold">{shift === "day" ? "Day" : "Night"} Shift · {ddmmyyyy(w.sessionDate)}</div>
                <div className="text-xs text-muted-foreground">{londonStamp(w.start)} → {londonStamp(w.end)} (Europe/London)</div>
              </>
            ) : (
              <div className="font-medium text-destructive">{"error" in check ? check.error : ""}</div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Download format</Label>
            <ToggleGroup type="single" value={format} onValueChange={(v) => v && setFormat(v as ReportFormat)} className="justify-start gap-1.5">
              {FORMATS.map((f) => (
                <ToggleGroupItem key={f.value} value={f.value} variant="outline" size="sm" className={cn("h-9 min-w-16", ON)}>{f.label}</ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="report-notes">Handover notes (optional)</Label>
            <Textarea
              id="report-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Next actions, who follows up…"
            />
            <p className="text-xs text-muted-foreground">Printed as written, under your name, in the hand-over of a recent shift.</p>
          </div>

          {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}

          {result && (
            <div className="space-y-2 rounded-md border p-3">
              <div className="flex flex-wrap items-center gap-2">
                {result.report.problems.length === 0
                  ? <Badge variant="secondary">Checked</Badge>
                  : <Badge variant="destructive">NOT validated · {result.report.problems.length}</Badge>}
                <span className="text-xs text-muted-foreground">
                  {result.report.stopsRead} stop(s) read · {result.report.items.length} order(s) over 15 min · read {londonStamp(result.report.generatedAt)}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {FORMATS.map((f) => (
                  <Button key={f.value} variant="outline" size="sm" onClick={() => void again(f.value)} className="gap-1">
                    <Download className="h-4 w-4" /> {f.label}
                  </Button>
                ))}
                {canShareFile(result.file) && (
                  <Button variant="outline" size="sm" onClick={() => void share()} className="gap-1">
                    <Share2 className="h-4 w-4" /> Share
                  </Button>
                )}
              </div>
            </div>
          )}

          <Collapsible open={historyOpen} onOpenChange={setHistoryOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-1 px-0 text-muted-foreground">
                <History className="h-4 w-4" /> Report history
                <ChevronDown className={cn("h-4 w-4 transition-transform", historyOpen && "rotate-180")} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-1 pt-1 text-xs">
              {history.isPending && <p className="text-muted-foreground">Loading…</p>}
              {history.isError && <p className="text-destructive">History could not be read.</p>}
              {history.isSuccess && history.data.length === 0 && (
                <p className="text-muted-foreground">
                  No reports recorded — or this account cannot see them. The history is visible to admins, managers and maintenance managers.
                </p>
              )}
              {history.isSuccess && history.data.map((h) => (
                <div key={h.id} className="flex flex-wrap items-center justify-between gap-x-3 border-b py-1 last:border-0">
                  <span className="font-medium">
                    {h.details?.shift === "night" ? "Night" : h.details?.shift === "day" ? "Day" : "?"} · {h.details?.session_date ? ddmmyyyy(h.details.session_date) : "—"}
                  </span>
                  <span className="text-muted-foreground">
                    {londonStamp(new Date(h.created_at))} · {h.details?.engineer || h.user_name}
                    {" · "}{(h.details?.format ?? "").toUpperCase()}
                  </span>
                  {h.details?.validated === false
                    ? <Badge variant="destructive" className="h-5">Not validated</Badge>
                    : <Badge variant="secondary" className="h-5">Checked</Badge>}
                </div>
              ))}
            </CollapsibleContent>
          </Collapsible>
        </div>

        {/* Pinned: on a line tablet (~600px tall) the form is taller than the screen,
            and Generate has to be reachable without scrolling for it. `-bottom-6`
            because sticky offsets are measured inside the scroller's padding. */}
        <DialogFooter className="sticky -bottom-6 -mx-6 -mb-6 gap-2 border-t bg-background px-6 py-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button onClick={() => void generate()} disabled={busy || !w} className="gap-1">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} Generate Report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
