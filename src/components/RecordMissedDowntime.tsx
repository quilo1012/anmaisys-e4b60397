import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, Clock } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useRole } from "@/hooks/useRole";

/**
 * Downtime that happened and was never written down.
 *
 * The line-stopped flag is a checkbox on the form that raises the order, and the live
 * stop control disappears the moment the order is finished. Between those two, an
 * order worked for eighty-five minutes on a line that was plainly standing still can
 * end its life with no downtime against it at all — and nothing anywhere says so.
 * WO-2026-000808 is that order; nine of the last hundred and forty-five went the same
 * way, and every one of them is invisible on the heatmap.
 *
 * This is the correction, and it is deliberately not the live control:
 *
 *  - It takes both times, because the stop began when the line stopped and not when
 *    somebody remembered. The live control stamps `now()`, which is the reason a late
 *    correction was worse than useless.
 *  - It defaults to the order's own span, which is the closest thing to evidence the
 *    system holds, and leaves both fields editable because the order is not the stop.
 *  - It is for supervisors and above. Writing downtime onto a finished order changes a
 *    number somebody is measured by.
 *  - It writes the reason it was entered late, so a report can tell a stop that was
 *    recorded as it happened from one reconstructed afterwards.
 */
const REASONS = [
  "Mechanical stop", "Electrical stop", "Leak", "Blender fault", "Filler fault",
  "Capper fault", "Labeller issue", "Metal detector", "Waiting for parts",
];

/** `2026-08-05T08:40` — what `datetime-local` wants, in London time. */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(d).filter((x) => x.type !== "literal")
    .reduce((a, x) => ({ ...a, [x.type]: x.value }), {} as Record<string, string>);
  const hour = p.hour === "24" ? "00" : p.hour;
  return `${p.year}-${p.month}-${p.day}T${hour}:${p.minute}`;
}

export function RecordMissedDowntime({
  workOrderId, woNumber, problem, createdAt, finishedAt, onRecorded,
}: {
  workOrderId: string;
  woNumber: number | string;
  problem?: string | null;
  createdAt: string | null;
  finishedAt: string | null;
  onRecorded?: () => void;
}) {
  const { user, profile } = useAuth();
  const { can } = useRole();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(() => toLocalInput(createdAt));
  const [to, setTo] = useState(() => toLocalInput(finishedAt));
  const [reason, setReason] = useState(problem?.trim() || REASONS[0]);
  const [busy, setBusy] = useState(false);

  const minutes = useMemo(() => {
    if (!from || !to) return null;
    const a = Date.parse(from), b = Date.parse(to);
    if (Number.isNaN(a) || Number.isNaN(b)) return null;
    return Math.round((b - a) / 60000);
  }, [from, to]);

  // `downtime.adjust` — the action that already gates changing a downtime figure.
  // Writing minutes onto a finished order changes a number people are measured by,
  // so it belongs behind the same gate and not behind "can see this order".
  if (!can("downtime.adjust")) return null;

  const save = async () => {
    // A second click, or Enter while the first insert is still in the air, is how
    // WO-824 ended up with two byte-identical stoppages on the record.
    if (busy) return;
    if (minutes == null || minutes <= 0) {
      toast.error("The line has to come back after it stopped");
      return;
    }
    setBusy(true);
    try {
      const name = profile?.name?.trim() || user?.email?.split("@")[0] || "Unknown";
      const { error } = await (supabase as any).from("downtime_events").insert({
        work_order_id: workOrderId,
        stopped_at: new Date(from).toISOString(),
        stopped_by: user?.id ?? null,
        stopped_by_name: name,
        stopped_reason: reason.trim() || null,
        resumed_at: new Date(to).toISOString(),
        resumed_by: user?.id ?? null,
        resumed_by_name: name,
        // Said in the record itself: this stop was reconstructed, not timed. A report
        // that cannot tell the two apart will average them together.
        resumed_note: `Recorded after the fact by ${name} — the stop was not logged while it was happening.`,
      });
      if (error) throw error;
      toast.success(`${minutes} minutes of downtime recorded against WO-${woNumber}`);
      // Everything that counts downtime, so the heatmap moves without a reload.
      for (const k of ["downtime-events", "shift-downtime", "downtime", "wo-metrics", "report-summary"]) {
        qc.invalidateQueries({ queryKey: [k] });
      }
      setOpen(false);
      onRecorded?.();
    } catch (e) {
      // The unique index downtime_events_no_duplicate_span refusing the second copy.
      const code = (e as { code?: string })?.code;
      toast.error(
        code === "23505"
          ? "That stoppage is already recorded on this order."
          : (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Clock className="mr-1.5 h-4 w-4" /> Record missed downtime
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Record downtime that was not logged</DialogTitle>
            <DialogDescription>
              For a stop that happened but was never marked while it was happening. The times
              default to this order's own span — correct them to when the line actually stopped
              and restarted.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Line stopped</Label>
                <Input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 h-9" />
              </div>
              <div>
                <Label className="text-xs">Line restarted</Label>
                <Input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 h-9" />
              </div>
            </div>

            <div>
              <Label className="text-xs">Reason</Label>
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {/* The order's own problem first: a stop opened from a capper fault
                      is that fault, and picking from a generic list threw that away. */}
                  {problem?.trim() && <SelectItem value={problem.trim()}>{problem.trim()}</SelectItem>}
                  {REASONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <p className="flex items-start gap-1.5 rounded-md border border-warning/30 bg-warning/5 p-2.5 text-2xs">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning-strong" />
              <span>
                {minutes == null ? "Set both times." : minutes <= 0
                  ? "The restart has to come after the stop."
                  : <><b>{minutes} minutes</b> will be added to this line's downtime and appear on the
                    heatmap. The record will say it was entered afterwards rather than timed.</>}
              </span>
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={save} disabled={busy || minutes == null || minutes <= 0}>
              {busy ? "Saving…" : "Record downtime"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
