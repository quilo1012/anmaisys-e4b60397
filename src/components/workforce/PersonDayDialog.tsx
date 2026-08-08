import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { UserMinus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AllocStatus, HeadcountArea } from "@/hooks/useHeadcount";
import { describeSchedule, type ShiftPattern } from "@/hooks/useWorkforce";
import { earlyLeave } from "@/lib/earlyLeave";

/** The shifts a board can be, which is what `daily_allocations.shift` accepts. */
const BOARD_SHIFTS = ["Day", "Night", "Weekend"] as const;

const STATUS: { value: AllocStatus; label: string; hint: string; cls: string }[] = [
  { value: "assigned", label: "In", hint: "Working their normal day", cls: "border-success/40 bg-success/10 text-success-strong" },
  { value: "overtime", label: "Overtime", hint: "Working, and the day counts as overtime", cls: "border-primary/40 bg-primary/10 text-primary" },
  { value: "sick", label: "Sickness", hint: "Off ill", cls: "border-destructive/40 bg-destructive/10 text-destructive-strong" },
  { value: "unpaid", label: "Unpaid", hint: "Away, and not paid for the day", cls: "border-warning/40 bg-warning/10 text-warning-strong" },
  { value: "holiday", label: "Holiday", hint: "Booked leave", cls: "border-primary/40 bg-primary/10 text-primary" },
];

/**
 * One person, on one day.
 *
 * Two kinds of fact live here and the dialog keeps them apart, because they do not
 * undo the same way. The status and the area are about *this day* — change them and
 * only this day moves. The shift is about the person: changing it moves every day
 * still ahead of them and is the thing somebody means by "he moved to nights".
 */
export function PersonDayDialog({
  open, onOpenChange, name, shiftGroup, status, areaId, areas, canManage, isLeader, halfDay, onSetHalfDay,
  leftEarlyAt, onSetLeftEarlyAt,
  patterns, patternId,
  onSetStatus, onSetArea, onSetShift, onSetPattern, onSetLeader, onRemove,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  name: string;
  shiftGroup: string | null;
  /** Null when they are on the roster but not placed on the day. */
  status: AllocStatus | null;
  areaId: string | null;
  areas: HeadcountArea[];
  canManage: boolean;
  onSetStatus: (s: AllocStatus) => void;
  /** Half a day: worked the morning, off the afternoon, or the other way round. */
  halfDay: boolean;
  onSetHalfDay: (v: boolean) => void;
  /** `"HH:MM"` if they came in and went home early, null if they worked the shift out. */
  leftEarlyAt: string | null;
  onSetLeftEarlyAt: (v: string | null) => void;
  onSetArea: (areaId: string) => void;
  onSetShift: (shiftGroup: string) => void;
  onSetPattern: (patternId: string | null) => void;
  onSetLeader: (leader: boolean) => void;
  patterns: ShiftPattern[];
  patternId: string | null;
  onRemove: () => void;
  isLeader: boolean;
}) {
  const areaName = areaId ? areas.find((a) => a.id === areaId)?.name ?? null : null;

  // Null when the person has no rota: without one there is no shift length to measure
  // the shortfall against, and "0h unpaid" would be worse than saying nothing.
  const rota = patternId ? patterns.find((p) => p.id === patternId) : null;
  const cut = rota
    ? earlyLeave(leftEarlyAt, {
        startsAt: (rota as any).starts_at,
        endsAt: (rota as any).ends_at,
        breakMinutes: (rota as any).break_minutes,
      })
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{name}</DialogTitle>
          <DialogDescription>
            {areaName ? `On ${areaName} today` : "Not on an area today"}
            {shiftGroup ? ` · ${shiftGroup} shift` : " · no shift recorded"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="text-xs">How the day counts</Label>
            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
              {STATUS.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  disabled={!canManage}
                  onClick={() => onSetStatus(s.value)}
                  className={cn(
                    "rounded-lg border px-2 py-1.5 text-left text-xs transition-colors",
                    status === s.value ? s.cls : "hover:bg-muted",
                  )}
                >
                  <div className="font-semibold">{s.label}</div>
                  <div className="text-2xs text-muted-foreground">{s.hint}</div>
                </button>
              ))}
            </div>
            {/* Said here because it is the one that surprises people: overtime keeps
                the line, absence and holiday take them off it. */}
            <p className="mt-1.5 text-2xs text-muted-foreground">
              Overtime keeps the area — they are working. Sickness, unpaid and holiday clear it.
            </p>

            {/* Half a day is not a smaller version of a day off; it is a different
                fact. Somebody on a half-day holiday worked a shift, and counting them
                as absent loses the hours they were on the line.
                Offered on a working day too, because the factory's own sheet writes
                "half day" beside people who were on a line — two of them in the month
                imported — and with the box hidden those marks could be seen and never
                changed. */}
            {status !== null && (
              <label className={cn(
                "mt-2 flex items-center gap-2.5 rounded-lg border p-2.5 text-xs",
                canManage ? "cursor-pointer hover:bg-muted" : "opacity-60",
              )}>
                <Checkbox
                  checked={halfDay}
                  disabled={!canManage}
                  onCheckedChange={(v) => onSetHalfDay(v === true)}
                />
                <span>
                  <span className="font-semibold">Half day</span>
                  <span className="block text-2xs text-muted-foreground">
                    {status === "assigned" || status === "overtime"
                      ? "They worked half the shift. Use Left early below when the time is known."
                      : "They worked part of the shift. Counts as ½ against the day, not a whole one."}
                  </span>
                </span>
              </label>
            )}

            {/* Went home early, which the board had no way to say. Somebody who left
                at two was on the line all morning, so this is not an absence and not a
                half day off — it is a day worked that got cut short. Kept as its own
                fact, with the time, because "he went early" and "he wasn't in" are
                the two things a supervisor must never have to guess between. */}
            {(status === "assigned" || status === "overtime") && (
              <div className="mt-2 rounded-lg border p-2.5">
                <label className={cn(
                  "flex items-center gap-2.5 text-xs",
                  canManage ? "cursor-pointer" : "opacity-60",
                )}>
                  <Checkbox
                    checked={leftEarlyAt !== null}
                    disabled={!canManage}
                    // A default of 14:00 so the common case is one click; the time
                    // stays editable and is what actually gets recorded.
                    onCheckedChange={(v) => onSetLeftEarlyAt(v === true ? "14:00" : null)}
                  />
                  <span>
                    <span className="font-semibold">Left early</span>
                    <span className="block text-2xs text-muted-foreground">
                      Came in and went home before the end of the shift.
                    </span>
                  </span>
                </label>

                {leftEarlyAt !== null && (
                  <div className="mt-2 flex items-center gap-2 pl-7">
                    <Label htmlFor="left-early-at" className="text-2xs text-muted-foreground">
                      Went home at
                    </Label>
                    <Input
                      id="left-early-at"
                      type="time"
                      value={leftEarlyAt}
                      disabled={!canManage}
                      onChange={(e) => onSetLeftEarlyAt(e.target.value || null)}
                      className="h-8 w-28"
                    />
                    {/* What the time costs, said where it is typed. The board stored
                        this for months and no screen ever turned it into hours, so
                        somebody who went home two hours into an eleven-hour shift
                        counted as a full day everywhere. */}
                    {cut && (
                      <span className="text-2xs text-muted-foreground">
                        {cut.workedHours}h worked ·{" "}
                        <b className="text-warning-strong">{cut.missedHours}h unpaid</b>
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <Label className="text-xs">Area today</Label>
            <Select value={areaId ?? ""} onValueChange={onSetArea} disabled={!canManage}>
              <SelectTrigger className="mt-1.5 h-9"><SelectValue placeholder="Not on an area" /></SelectTrigger>
              <SelectContent>
                {areas.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                    <span className="ml-2 text-2xs text-muted-foreground">
                      {a.kind === "production" ? "production" : "support"}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-lg border border-dashed p-2.5">
            <Label className="text-xs">Shift</Label>
            <Select value={shiftGroup ?? ""} onValueChange={onSetShift} disabled={!canManage}>
              <SelectTrigger className="mt-1.5 h-9"><SelectValue placeholder="No shift recorded" /></SelectTrigger>
              <SelectContent>
                {BOARD_SHIFTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                <SelectItem value="Warehouse Day">Warehouse Day</SelectItem>
                <SelectItem value="Warehouse Weekend">Warehouse Weekend</SelectItem>
              </SelectContent>
            </Select>
            <p className="mt-1.5 text-2xs text-muted-foreground">
              Changes the person, not just today: every day still ahead moves to the new
              board. Days already worked keep the shift they were worked on.
            </p>

            {/* The rota is the other half, and a different question: the shift says
                which crew, the rota says which weekdays. Mon–Thu exists on days and on
                nights, so one list could not answer both. */}
            <Label className="mt-3 block text-xs">Working pattern</Label>
            <Select value={patternId ?? "__none__"} onValueChange={(v) => onSetPattern(v === "__none__" ? null : v)} disabled={!canManage}>
              <SelectTrigger className="mt-1.5 h-9"><SelectValue placeholder="No rota recorded" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No rota recorded</SelectItem>
                {patterns.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                    <span className="ml-2 text-2xs text-muted-foreground">{describeSchedule(p)}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1.5 text-2xs text-muted-foreground">
              Decides which weekdays they are due in. Somebody put on a line on a day
              their rota does not cover is a call-in, and the board says so.
            </p>
          </div>

          {/* Leadership is a fact about the day, not about the person: the same line
              can be led by somebody else tomorrow, and the leader on days is not the
              leader on nights. Kept off `department`, which holds their trade. */}
          <label className={cn(
            "flex items-center gap-2.5 rounded-lg border p-2.5 text-xs",
            areaId && canManage ? "cursor-pointer hover:bg-muted" : "opacity-60",
          )}>
            <Checkbox
              checked={isLeader}
              disabled={!canManage || !areaId}
              onCheckedChange={(v) => onSetLeader(v === true)}
            />
            <span>
              <span className="font-semibold">Leads this area today</span>
              <span className="block text-2xs text-muted-foreground">
                {areaId ? "Goes to the top of the column. Only one leader per area." : "Put them on an area first."}
              </span>
            </span>
          </label>

          {status && canManage && (
            <Button variant="outline" size="sm" className="w-full" onClick={onRemove}>
              <UserMinus className="mr-1.5 h-4 w-4" /> Take off the day
            </Button>
          )}

          {!canManage && (
            <Badge variant="outline" className="text-2xs">Read only — you cannot change allocations</Badge>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
