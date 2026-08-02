import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { UserMinus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AllocStatus, HeadcountArea } from "@/hooks/useHeadcount";

/** The shifts a board can be, which is what `daily_allocations.shift` accepts. */
const BOARD_SHIFTS = ["Day", "Night", "Weekend"] as const;

const STATUS: { value: AllocStatus; label: string; hint: string; cls: string }[] = [
  { value: "assigned", label: "In", hint: "Working their normal day", cls: "border-emerald-500/40 bg-emerald-500/10 text-success-strong" },
  { value: "overtime", label: "Overtime", hint: "Working, and the day counts as overtime", cls: "border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300" },
  { value: "absence", label: "Absence", hint: "Did not come in", cls: "border-amber-500/40 bg-amber-500/10 text-warning-strong" },
  { value: "holiday", label: "Holiday", hint: "Booked leave", cls: "border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300" },
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
  open, onOpenChange, name, shiftGroup, status, areaId, areas, canManage, isLeader,
  onSetStatus, onSetArea, onSetShift, onSetLeader, onRemove,
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
  onSetArea: (areaId: string) => void;
  onSetShift: (shiftGroup: string) => void;
  onSetLeader: (leader: boolean) => void;
  onRemove: () => void;
  isLeader: boolean;
}) {
  const areaName = areaId ? areas.find((a) => a.id === areaId)?.name ?? null : null;

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
              Overtime keeps the area — they are working. Absence and holiday clear it.
            </p>
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
