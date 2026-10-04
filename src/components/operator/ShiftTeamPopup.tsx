import { useEffect, useMemo, useState } from "react";
import { Clock3, Crown, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useDeviceLineCtx } from "@/contexts/DeviceLineContext";
import { useLineTeamBoard, type LineTeamMember } from "@/hooks/useLineTeamBoard";
import { getCurrentFactoryShift, getCurrentShiftEnd, getCurrentShiftStart, SHIFT_LABEL } from "@/lib/shifts";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<string, string> = {
  overtime: "Overtime",
  sick: "Sick",
  unpaid: "Unpaid",
  holiday: "Holiday",
  training: "Training",
};

const KEY_PREFIX = "an_shift_team_seen_";

function dismissalKey(shiftStart: Date) {
  return `${KEY_PREFIX}${shiftStart.toISOString()}`;
}

/**
 * The acknowledgement outlives the tab.
 *
 * This was `sessionStorage`, which a kiosk tablet empties every time the app is closed
 * and reopened — so a tablet restarted at nine in the morning asked again about a crew
 * acknowledged at six. `localStorage` is per-device and survives that, which is what
 * "once a shift" was always meant to mean. The dedicated team page is still there for
 * anyone who wants the roster again mid-shift.
 */
function wasDismissed(shiftStart: Date) {
  try {
    return localStorage.getItem(dismissalKey(shiftStart)) === "1";
  } catch {
    return false;
  }
}

function rememberDismissal(shiftStart: Date) {
  const key = dismissalKey(shiftStart);
  try {
    // Keep exactly one. `sessionStorage` used to do this pruning by being wiped; a
    // per-device store would otherwise accumulate a key for every shift ever worked.
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const existing = localStorage.key(i);
      if (existing && existing !== key && existing.startsWith(KEY_PREFIX)) {
        localStorage.removeItem(existing);
      }
    }
    localStorage.setItem(key, "1");
  } catch {
    // The acknowledgement remains closed in React state for this visit.
  }
}

/**
 * The start-of-shift team acknowledgement shown only inside operator line screens.
 *
 * It opens the first time the operator reaches a line screen in a shift, not inside a
 * window after the shift bell. It used to insist on the first fifteen minutes, which
 * tied the roster to a wall clock rather than to somebody arriving: a tablet switched
 * on at 06:20, a login at 07:00, or a crew held back while the line was cleaned down
 * all got a first screen with no team on it and no error either. `an_shift_team_seen_
 * <shift start>` is what keeps this from nagging, and it always did.
 */
export function ShiftTeamPopup() {
  const { selectedLineId, selectedLineName } = useDeviceLineCtx();
  const teamQuery = useLineTeamBoard(selectedLineId);
  const [now, setNow] = useState(() => new Date());
  const shiftStart = useMemo(() => getCurrentShiftStart(now), [now]);
  const shiftStartMs = shiftStart.getTime();
  const [dismissed, setDismissed] = useState(() => wasDismissed(shiftStart));

  useEffect(() => {
    setDismissed(wasDismissed(new Date(shiftStartMs)));
  }, [shiftStartMs]);

  // One re-render per shift, at the handover. That is the only moment both the roster
  // and the acknowledgement change; there is no window left to expire.
  useEffect(() => {
    const endMs = getCurrentShiftEnd(now).getTime();
    const timer = window.setTimeout(
      () => setNow(new Date()),
      Math.max(1_000, endMs - Date.now() + 250),
    );
    return () => window.clearTimeout(timer);
  }, [now]);

  const groups = useMemo(() => {
    const byArea = new Map<string, { name: string; sort: number; members: LineTeamMember[] }>();
    for (const member of teamQuery.data ?? []) {
      const name = member.area_name || selectedLineName;
      const current = byArea.get(name) ?? {
        name,
        sort: member.area_sort ?? Number.MAX_SAFE_INTEGER,
        members: [],
      };
      current.sort = Math.min(current.sort, member.area_sort ?? Number.MAX_SAFE_INTEGER);
      current.members.push(member);
      byArea.set(name, current);
    }
    return [...byArea.values()]
      .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))
      .map((group) => ({
        ...group,
        members: [...group.members].sort((a, b) =>
          Number(b.is_leader) - Number(a.is_leader)
          || (a.display_name || a.employee_name).localeCompare(b.display_name || b.employee_name),
        ),
      }));
  }, [teamQuery.data, selectedLineName]);

  const dismiss = () => {
    setDismissed(true);
    rememberDismissal(new Date(shiftStartMs));
  };

  const open = !dismissed && teamQuery.isSuccess && (teamQuery.data?.length ?? 0) > 0;
  if (!open) return null;

  const currentShift = getCurrentFactoryShift(now);
  const dateLabel = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(now);

  return (
    <Dialog open onOpenChange={(next) => { if (!next) dismiss(); }}>
      <DialogContent className="h-[calc(100dvh-1rem)] max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-5xl gap-5 overflow-y-auto p-5 sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:p-7">
        <DialogHeader className="pr-12 text-left">
          <DialogTitle className="text-2xl leading-tight sm:text-3xl">
            {selectedLineName} · {SHIFT_LABEL[currentShift.shiftCode]}
          </DialogTitle>
          <DialogDescription className="text-base capitalize">{dateLabel}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {groups.map((group) => (
            <section key={group.name} className="space-y-3 border-t pt-4 first:border-t-0 first:pt-0">
              <h3 className="flex items-center gap-2 text-xl font-bold">
                <Users className="h-6 w-6 text-primary" />
                {group.name}
                <Badge variant="outline" className="text-sm">{group.members.length}</Badge>
              </h3>
              <div className="grid gap-3 md:grid-cols-2">
                {group.members.map((member, index) => (
                  <div
                    key={`${member.employee_name}-${index}`}
                    className={cn(
                      "flex min-h-20 items-center gap-3 rounded-md border bg-card px-4 py-3",
                      member.is_leader && "border-warning bg-warning/10",
                    )}
                  >
                    {member.is_leader && (
                      <Badge className="shrink-0 bg-warning text-warning-foreground">LEAD</Badge>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cn("text-lg font-semibold", member.is_leader && "text-warning-strong")}>
                          {member.display_name || member.employee_name}
                        </span>
                        {member.is_leader && <Crown className="h-5 w-5 text-warning-strong" />}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                        <span>{group.name}</span>
                        {member.sheet_start_time && (
                          <Badge variant="outline" className="gap-1 text-sm">
                            <Clock3 className="h-4 w-4" /> {member.sheet_start_time}
                          </Badge>
                        )}
                        {member.sheet_tag && <Badge variant="outline">{member.sheet_tag}</Badge>}
                        {member.half_day && <Badge variant="outline">½ day</Badge>}
                        {member.status !== "assigned" && (
                          <Badge variant={member.status === "overtime" ? "secondary" : "destructive"}>
                            {STATUS_LABEL[member.status] ?? member.status}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        <DialogFooter className="sticky bottom-0 bg-background pt-2">
          <Button type="button" className="h-14 w-full text-lg font-bold sm:w-52" onClick={dismiss}>
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}