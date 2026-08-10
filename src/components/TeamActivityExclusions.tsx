import { useEffect, useMemo, useState } from "react";
import { differenceInMinutes, format } from "date-fns";
import { Coffee, Beaker, Brush, ArrowLeftRight, Timer, Radar } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  useWoExclusions,
  useStartExclusion,
  useEndExclusion,
} from "@/hooks/useWoExclusions";
import { activityLabel, type ExclusionActivity } from "@/lib/downtimeExclusions";

const ACTIVITIES: { key: ExclusionActivity; label: string; icon: typeof Coffee }[] = [
  { key: "break", label: "Break", icon: Coffee },
  { key: "filling_blender", label: "Filling blender", icon: Beaker },
  { key: "brushing_cleaning", label: "Brushing & cleaning", icon: Brush },
];

interface Props {
  workOrderId: string;
  /** Only rendered while the line is actually stopped for this order. */
  lineStopped: boolean;
}

/**
 * "Team activity during stop" — time the line team spends on break, filling a
 * blender or cleaning is not maintenance downtime. Starting an activity opens
 * an exclusion; "Back to stop" closes it. Only one may run at a time.
 */
export function TeamActivityExclusions({ workOrderId, lineStopped }: Props) {
  const { toast } = useToast();
  const { data: exclusions = [] } = useWoExclusions(workOrderId);
  const start = useStartExclusion();
  const end = useEndExclusion();
  const [, setTick] = useState(0);

  const open = useMemo(() => exclusions.find((e) => !e.ended_at) || null, [exclusions]);
  const past = useMemo(() => exclusions.filter((e) => e.ended_at), [exclusions]);

  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setTick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, [open]);

  if (!lineStopped && exclusions.length === 0) return null;

  const handleStart = async (activity: ExclusionActivity) => {
    try {
      await start.mutateAsync({ workOrderId, activity });
      toast({ title: `${activityLabel(activity)} started`, description: "This time will not count as downtime." });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleEnd = async () => {
    if (!open) return;
    try {
      const row = await end.mutateAsync({ exclusionId: open.id });
      const mins = row.ended_at
        ? differenceInMinutes(new Date(row.ended_at), new Date(row.started_at))
        : 0;
      toast({ title: "Back to stop", description: `${activityLabel(row.activity)} — ${mins}m excluded from downtime.` });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  return (
    <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-2.5">
      <p className="text-sm font-semibold flex items-center gap-1.5">
        <Timer className="h-4 w-4 text-muted-foreground" />
        Team activity during stop
      </p>

      {open ? (
        <div className="space-y-2">
          <p className="text-sm">
            <span className="font-semibold">{activityLabel(open.activity)}</span> running since{" "}
            {format(new Date(open.started_at), "HH:mm")} ·{" "}
            {differenceInMinutes(new Date(), new Date(open.started_at))}m
            {open.started_by_name ? ` · ${open.started_by_name}` : ""}
          </p>
          {open.source === "intouch" && (
            /* Said on the row: iTouching reported this, nobody pressed the button.
               A reading and a person's record should not look the same. */
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <Radar className="h-3 w-3" /> Reported by iTouching — ends when the line comes back.
            </p>
          )}
          <Button
            size="lg"
            className="w-full h-12 text-base font-bold"
            onClick={handleEnd}
            disabled={end.isPending}
          >
            <ArrowLeftRight className="h-5 w-5 mr-2" /> BACK TO STOP
          </Button>
        </div>
      ) : lineStopped ? (
        <div className="grid gap-2 sm:grid-cols-3">
          {ACTIVITIES.map(({ key, label, icon: Icon }) => (
            <Button
              key={key}
              variant="outline"
              className="h-14 text-sm font-semibold"
              onClick={() => handleStart(key)}
              disabled={start.isPending}
            >
              <Icon className="h-4 w-4 mr-2" /> {label}
            </Button>
          ))}
        </div>
      ) : null}

      {past.length > 0 && (
        <div className="space-y-1 pt-1 border-t">
          {past.map((e) => {
            const mins = differenceInMinutes(new Date(e.ended_at!), new Date(e.started_at));
            return (
              <div key={e.id} className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="flex min-w-0 items-center gap-1 truncate">
                  {activityLabel(e.activity)} · {format(new Date(e.started_at), "HH:mm")}–
                  {format(new Date(e.ended_at!), "HH:mm")}
                  {e.source === "intouch" && (
                    <Badge variant="outline" className="shrink-0 text-[9px] leading-4" title="Recorded automatically from an iTouching planned stop code">
                      iTouching
                    </Badge>
                  )}
                </span>
                <span className="font-figure shrink-0">{mins}m</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
