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

const TEAM_WINDOW_MINUTES = 15;

const STATUS_LABEL: Record<string, string> = {
  overtime: "Overtime",
  sick: "Sick",
  unpaid: "Unpaid",
  holiday: "Holiday",
  training: "Training",
};

function dismissalKey(shiftStart: Date) {
  return `an_shift_team_seen_${shiftStart.toISOString()}`;
}

function wasDismissed(shiftStart: Date) {
  try {
    return sessionStorage.getItem(dismissalKey(shiftStart)) === "1";
  } catch {
    return false;
  }
}

function rememberDismissal(shiftStart: Date) {
  try {
    sessionStorage.setItem(dismissalKey(shiftStart), "1");
  } catch {
    // The acknowledgement remains closed in React state for this visit.
  }
}

/** The start-of-shift team acknowledgement shown only inside operator line screens. */
export function ShiftTeamPopup() {
  const { selectedLineId, selectedLineName } = useDeviceLineCtx();
  const teamQuery = useLineTeamBoard(selectedLineId);
  const [now, setNow] = useState(() => new Date());
  const shiftStart = useMemo(() => getCurrentShiftStart(now), [now]);
  const shiftStartMs = shiftStart.getTime();
  const windowEndMs = shiftStartMs + TEAM_WINDOW_MINUTES * 60_000;
  const inWindow = now.getTime() >= shiftStartMs && now.getTime() < windowEndMs;
  const [dismissed, setDismissed] = useState(() => wasDismissed(shiftStart));

  useEffect(() => {
    setDismissed(wasDismissed(new Date(shiftStartMs)));
  }, [shiftStartMs]);

  useEffect(() => {
    const nextChangeMs = inWindow ? windowEndMs : getCurrentShiftEnd(now).getTime();
    const timer = window.setTimeout(
      () => setNow(new Date()),
      Math.max(1_000, nextChangeMs - Date.now() + 250),
    );
    return () => window.clearTimeout(timer);
  }, [inWindow, now, windowEndMs]);

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

  const open = inWindow && !dismissed && teamQuery.isSuccess && (teamQuery.data?.length ?? 0) > 0;
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