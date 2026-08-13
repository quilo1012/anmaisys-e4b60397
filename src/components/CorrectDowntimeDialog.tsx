import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { formatMinutes } from "@/lib/formatDuration";
import { resolveCorrection, isCorrectionError } from "@/lib/downtimeCorrection";
import { useCorrectDowntime } from "@/hooks/useDowntimeCorrections";
import type { DowntimeEvent } from "@/hooks/useDowntimeEvents";

/** `2026-08-05T08:40` — what `datetime-local` wants, in London time. */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(iso)).filter((x) => x.type !== "literal")
    .reduce((a, x) => ({ ...a, [x.type]: x.value }), {} as Record<string, string>);
  const hour = p.hour === "24" ? "00" : p.hour;
  return `${p.year}-${p.month}-${p.day}T${hour}:${p.minute}`;
}

interface Props {
  event: DowntimeEvent;
  workOrderId: string;
}

/**
 * Correcting the time of a recorded stoppage, with the corrector's name on it.
 *
 * The original values stay on screen above the fields on purpose: a correction is a
 * comparison, not a blind overwrite. Typing a duration moves the end time and typing
 * an end time moves the duration, because the boards read the minutes and this screen
 * reads the stamps, and the two must not be allowed to drift apart.
 */
export function CorrectDowntimeDialog({ event, workOrderId }: Props) {
  const [open, setOpen] = useState(false);
  const correct = useCorrectDowntime();

  const isOpenStop = !event.resumed_at;
  const originalMinutes =
    event.duration_minutes ??
    (event.resumed_at
      ? Math.round((new Date(event.resumed_at).getTime() - new Date(event.stopped_at).getTime()) / 60_000)
      : null);

  const [stoppedAt, setStoppedAt] = useState(() => toLocalInput(event.stopped_at));
  const [resumedAt, setResumedAt] = useState(() => toLocalInput(event.resumed_at));
  const [minutes, setMinutes] = useState<string>(originalMinutes != null ? String(originalMinutes) : "");
  const [reason, setReason] = useState("");
  /** Which field the user last touched decides which one wins. */
  const [driver, setDriver] = useState<"minutes" | "end">("end");

  useEffect(() => {
    if (!open) return;
    setStoppedAt(toLocalInput(event.stopped_at));
    setResumedAt(toLocalInput(event.resumed_at));
    setMinutes(originalMinutes != null ? String(originalMinutes) : "");
    setReason("");
    setDriver("end");
  }, [open, event.stopped_at, event.resumed_at, originalMinutes]);

  const parsedMinutes = minutes.trim() === "" ? null : Number(minutes);

  const preview = useMemo(() => resolveCorrection({
    stoppedAt: stoppedAt ? new Date(stoppedAt) : null,
    resumedAt: resumedAt ? new Date(resumedAt) : null,
    minutes: driver === "minutes" ? parsedMinutes : null,
    reason: reason.trim() || "placeholder",
    isOpen: isOpenStop,
  }), [stoppedAt, resumedAt, parsedMinutes, driver, reason, isOpenStop]);

  // Keep the two views of the same stoppage showing the same thing while typing.
  useEffect(() => {
    if (isCorrectionError(preview)) return;
    if (driver === "minutes" && preview.resumedAt) {
      const next = toLocalInput(preview.resumedAt.toISOString());
      if (next !== resumedAt) setResumedAt(next);
    }
    if (driver === "end") {
      const next = preview.durationMinutes != null ? String(preview.durationMinutes) : "";
      if (next !== minutes) setMinutes(next);
    }
  }, [preview, driver]); // eslint-disable-line react-hooks/exhaustive-deps

  const invalid = isCorrectionError(preview) ? preview.error : null;
  const canSave = !invalid && reason.trim().length > 0 && !correct.isPending;

  const save = async () => {
    if (isCorrectionError(preview)) return;
    try {
      const res = await correct.mutateAsync({
        eventId: event.id,
        workOrderId,
        stoppedAt: preview.stoppedAt.toISOString(),
        resumedAt: preview.resumedAt ? preview.resumedAt.toISOString() : null,
        minutes: driver === "minutes" ? preview.durationMinutes : null,
        reason: reason.trim(),
      });
      toast.success(
        `Stoppage corrected — ${res?.prev_minutes ?? "?"} min → ${res?.new_minutes ?? "?"} min`,
      );
      setOpen(false);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 print:hidden"
        title="Correct this stoppage"
        aria-label="Correct this stoppage"
        onClick={() => setOpen(true)}
      >
        <Pencil className="h-3.5 w-3.5" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Correct stoppage time</DialogTitle>
            <DialogDescription>
              The correction is recorded with your name, the previous value and your reason.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-md border bg-muted/40 p-3 text-xs space-y-1">
            <p className="font-medium text-foreground">On record now</p>
            <p className="text-muted-foreground">
              Stopped {format(new Date(event.stopped_at), "dd/MM HH:mm")} ·{" "}
              {event.resumed_at ? `Resumed ${format(new Date(event.resumed_at), "dd/MM HH:mm")}` : "ongoing"} ·{" "}
              {originalMinutes != null ? formatMinutes(originalMinutes) : "—"}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label htmlFor="corr-start" className="text-xs">Start</Label>
              <Input
                id="corr-start" type="datetime-local" value={stoppedAt}
                onChange={(e) => setStoppedAt(e.target.value)} className="h-9"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="corr-end" className="text-xs">End</Label>
              <Input
                id="corr-end" type="datetime-local" value={resumedAt}
                disabled={isOpenStop}
                onChange={(e) => { setDriver("end"); setResumedAt(e.target.value); }}
                className="h-9"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="corr-min" className="text-xs">Duration (min)</Label>
              <Input
                id="corr-min" type="number" min={0} value={minutes}
                disabled={isOpenStop}
                onChange={(e) => { setDriver("minutes"); setMinutes(e.target.value); }}
                className="h-9"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="corr-reason" className="text-xs">Reason (required)</Label>
            <Textarea
              id="corr-reason" value={reason} rows={2}
              placeholder="e.g. the line was running from 07:30, the order was only resumed at 11:34"
              onChange={(e) => setReason(e.target.value)}
            />
          </div>

          {invalid && <p className="text-xs text-destructive">{invalid}</p>}
          {!invalid && !isCorrectionError(preview) && (
            <p className="text-xs text-muted-foreground">
              New duration:{" "}
              <span className="font-medium text-foreground">
                {preview.durationMinutes != null ? formatMinutes(preview.durationMinutes) : "still open"}
              </span>
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={!canSave}>
              {correct.isPending ? "Saving…" : "Save correction"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
