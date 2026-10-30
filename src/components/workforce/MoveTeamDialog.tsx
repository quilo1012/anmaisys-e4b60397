import { useEffect, useState } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";

export type MoveTeamPreview = {
  movers: { id: string; name: string }[];
  staying: { id: string; name: string; reason: string }[];
  /** Name of the leader whose mark goes with the team, if any. */
  carriesLeader: string | null;
  /** Name of whoever already leads the destination, if anyone. */
  destinationLeader: string | null;
  /** People drawn on each line now: the source, and the destination once one is chosen. */
  counts: { from: number; to: number | null };
};

/**
 * Move a whole line's team to another line, after saying exactly who goes.
 *
 * The preview is recomputed for the chosen destination (the leader rule depends on it).
 * Nothing is written until "Move" is pressed; Cancel leaves the board as it was.
 */
export function MoveTeamDialog({
  open, onOpenChange, from, destinations, shiftLabel, preview, onConfirm, busy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  from: { id: string; name: string };
  /** Every other line on this board, hidden ones included (marked). */
  destinations: { id: string; name: string; hidden: boolean }[];
  shiftLabel: string;
  preview: (toAreaId: string | null) => MoveTeamPreview;
  onConfirm: (toAreaId: string) => void;
  busy?: boolean;
}) {
  const [to, setTo] = useState<string | null>(null);
  useEffect(() => { if (open) setTo(null); }, [open, from.id]);
  const p = preview(to);
  const toName = destinations.find((d) => d.id === to)?.name ?? null;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-h-[90dvh] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>Move the whole team from {from.name}</AlertDialogTitle>
          <AlertDialogDescription>
            {shiftLabel} shift. Only the line changes — shift, status, half days, times and attendance stay as they are.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-3 text-sm">
          <div className="space-y-1.5">
            <Label htmlFor="move-team-to">Move to</Label>
            <Select value={to ?? undefined} onValueChange={setTo}>
              <SelectTrigger id="move-team-to" aria-label="Destination line" className="h-11 sm:h-9">
                <SelectValue placeholder="Choose a line" />
              </SelectTrigger>
              <SelectContent>
                {destinations.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}{d.hidden ? " (hidden on this shift)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {to && toName && p.movers.length > 0 && p.counts.to !== null && (
            // The decision is the two totals; the names below are the check.
            <table aria-label="Headcount before and after" className="w-full border-collapse text-sm tabular-nums">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-1 font-medium">Line</th>
                  <th className="py-1 text-right font-medium">Now</th>
                  <th className="py-1 text-right font-medium">After</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t">
                  <td className="py-1.5">{from.name}</td>
                  <td className="py-1.5 text-right">{p.counts.from}</td>
                  <td className="py-1.5 text-right font-semibold">{p.counts.from - p.movers.length}</td>
                </tr>
                <tr className="border-t">
                  <td className="py-1.5">{toName}</td>
                  <td className="py-1.5 text-right">{p.counts.to}</td>
                  <td className="py-1.5 text-right font-semibold">{p.counts.to + p.movers.length}</td>
                </tr>
              </tbody>
            </table>
          )}

          <div>
            <p className="font-semibold">
              {p.movers.length === 0
                ? "Nobody on this line can be moved."
                : `${p.movers.length} ${p.movers.length === 1 ? "person" : "people"} will move${toName ? ` to ${toName}` : ""}:`}
            </p>
            {p.movers.length > 0 && (
              <ul aria-label="People who will move" className="mt-1 list-disc space-y-0.5 pl-5">
                {p.movers.map((m) => <li key={m.id}>{m.name}</li>)}
              </ul>
            )}
          </div>

          {p.staying.length > 0 && (
            <div role="note" className="rounded-md border border-warning/50 bg-warning/10 p-2">
              <p className="font-semibold">{p.staying.length} cannot be moved and will stay on {from.name}:</p>
              <ul aria-label="People who will stay" className="mt-1 space-y-1">
                {p.staying.map((s) => (
                  <li key={s.id}><span className="font-medium">{s.name}</span> — {s.reason}</li>
                ))}
              </ul>
            </div>
          )}

          {to && p.carriesLeader && (
            <p className="text-muted-foreground">{p.carriesLeader} keeps leading the team on {toName}.</p>
          )}
          {to && p.destinationLeader && (
            <p className="text-muted-foreground">
              {toName} is already led by {p.destinationLeader}; the leader mark from {from.name} does not move with the team.
            </p>
          )}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={!to || p.movers.length === 0 || busy}
            onClick={(e) => {
              if (!to) { e.preventDefault(); return; }
              onConfirm(to);
            }}
          >
            {p.movers.length > 0 && toName ? `Move ${p.movers.length} to ${toName}` : "Move"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
