import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useLoggingShift } from "@/contexts/LoggingShiftContext";
import { londonHM } from "@/lib/shifts";
import { ArrowLeftRight, Clock, Sun, Moon } from "lucide-react";

/**
 * The question asked at every handover, and the reminder that follows it.
 *
 * For thirty minutes after a shift ends both crews are on the screen at once: one
 * writing up the run it just finished, one starting its own. Guessing between them is
 * what filed a day's last quantity under the night. So it asks, once per handover per
 * device, and then says out loud which shift it is writing to until the window shuts.
 *
 * Outside that window it renders nothing at all — twenty-three and a half hours a day
 * there is only one answer and no reason to interrupt anyone.
 */

export function ShiftHandoverGate() {
  const { needsChoice, incoming, outgoing, graceEndsAt, choose } = useLoggingShift();

  if (!needsChoice || !outgoing || !graceEndsAt) return null;

  const OutIcon = outgoing.shiftCode === "day" ? Sun : Moon;
  const InIcon = incoming.shiftCode === "day" ? Sun : Moon;
  const closesAt = londonHM(graceEndsAt);

  return (
    <Dialog open>
      {/* No dismiss: the two buttons are the only way out. A dialog closed by a stray
          palm on a tablet would fall back to the incoming shift silently, which is the
          behaviour this replaced. */}
      <DialogContent
        className="max-w-xl [&>button]:hidden"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <ArrowLeftRight className="h-5 w-5" />
            Shift handover — which shift are you logging?
          </DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Both shifts are open until <b>{closesAt}</b>. Pick the shift the production
          you are about to enter was made on.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <Button
            variant="outline"
            className="h-auto flex-col items-start gap-1 whitespace-normal p-4 text-left"
            onClick={() => choose("outgoing")}
          >
            <span className="flex items-center gap-2 text-base font-semibold">
              <OutIcon className="h-4 w-4" />
              {outgoing.shiftCode === "day" ? "Day shift" : "Night shift"} — just finished
            </span>
            <span className="text-xs font-normal text-muted-foreground">
              {outgoing.shiftCode === "day" ? "06:00–18:00" : "18:00–06:00"} · {outgoing.sessionDate}
            </span>
            <span className="text-xs font-normal text-muted-foreground">
              Closes at {closesAt}
            </span>
          </Button>

          <Button
            className="h-auto flex-col items-start gap-1 whitespace-normal p-4 text-left"
            onClick={() => choose("incoming")}
          >
            <span className="flex items-center gap-2 text-base font-semibold">
              <InIcon className="h-4 w-4" />
              {incoming.shiftCode === "day" ? "Day shift" : "Night shift"} — just started
            </span>
            <span className="text-xs font-normal opacity-80">
              {incoming.shiftCode === "day" ? "06:00–18:00" : "18:00–06:00"} · {incoming.sessionDate}
            </span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The standing reminder while an operator is writing to a shift that has already ended.
 *
 * Someone who picked the outgoing shift and then got pulled away must not come back to
 * a screen that looks normal and keep typing into a closed shift. The way out is one tap.
 */
export function CarriedOverShiftBanner() {
  const { isCarriedOver, graceEndsAt, shiftCode, choose } = useLoggingShift();

  if (!isCarriedOver || !graceEndsAt) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
      <Clock className="h-4 w-4 shrink-0 text-warning-strong" />
      <span className="text-warning-strong">
        Logging the <b>{shiftCode === "day" ? "day" : "night"} shift that has ended</b> — closes at{" "}
        <b>{londonHM(graceEndsAt)}</b>.
      </span>
      <Button size="sm" variant="outline" className="ml-auto" onClick={() => choose("incoming")}>
        Switch to the current shift
      </Button>
    </div>
  );
}
