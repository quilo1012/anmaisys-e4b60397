import { useEffect, useState } from "react";
import { differenceInMinutes, format } from "date-fns";
import { PowerOff, CheckCircle2, Circle } from "lucide-react";
import { cn } from "@/lib/utils";

interface LineStatusBannerProps {
  lineStopped: boolean;
  lineStoppedAt?: string | null;
  lineResumedAt?: string | null;
  machine?: string;
  variant?: "compact" | "detail";
  className?: string;
}

/**
 * Visual banner indicating production line status for a Maintenance Order.
 * - Red (pulsing) when the line is currently stopped
 * - Green when the line was previously stopped but is back to running
 * - Neutral when the line never stopped
 */
export function LineStatusBanner({
  lineStopped,
  lineStoppedAt,
  lineResumedAt,
  machine,
  variant = "compact",
  className,
}: LineStatusBannerProps) {
  // Live ticker — updates every 30s while the line is stopped
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!lineStopped || !lineStoppedAt) return;
    const t = setInterval(() => setTick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, [lineStopped, lineStoppedAt]);

  const stoppedDuration =
    lineStoppedAt && lineStopped
      ? differenceInMinutes(new Date(), new Date(lineStoppedAt))
      : null;
  const totalDowntime =
    lineStoppedAt && lineResumedAt
      ? differenceInMinutes(new Date(lineResumedAt), new Date(lineStoppedAt))
      : null;

  // STATE 1: Line currently stopped
  if (lineStopped) {
    if (variant === "detail") {
      return (
        <div
          className={cn(
            "rounded-lg border-2 border-destructive bg-destructive/10 p-4 animate-pulse",
            className,
          )}
        >
          <div className="flex items-start gap-3">
            <PowerOff className="h-12 w-12 text-destructive-strong shrink-0" aria-hidden="true" />
            <div className="flex-1">
              <p className="text-xl font-bold text-destructive-strong uppercase tracking-wide">
                Line Stopped
              </p>
              {lineStoppedAt && (
                <p className="text-sm text-destructive-strong/80 mt-1">
                  Stopped at:{" "}
                  <span className="font-semibold">
                    {format(new Date(lineStoppedAt), "dd/MM/yyyy HH:mm")}
                  </span>
                </p>
              )}
              {stoppedDuration !== null && (
                <p className="text-sm text-destructive-strong/80">
                  Currently down for:{" "}
                  <span className="font-mono font-bold">
                    {stoppedDuration}m
                  </span>
                </p>
              )}
            </div>
          </div>
        </div>
      );
    }
    return (
      <div
        className={cn(
          "rounded-md bg-destructive text-destructive-foreground px-3 py-2 flex items-center gap-2 text-sm font-semibold animate-pulse",
          className,
        )}
        role="status"
        aria-live="polite"
      >
        <PowerOff className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>LINE STOPPED</span>
        {stoppedDuration !== null && (
          <span className="font-mono">· {stoppedDuration}m ago</span>
        )}
        {machine && <span className="opacity-80">· {machine}</span>}
      </div>
    );
  }

  // STATE 2: Line was stopped, now resumed
  if (lineResumedAt && lineStoppedAt) {
    if (variant === "detail") {
      return (
        <div
          className={cn(
            "rounded-lg border-2 border-success bg-success/10 p-4",
            className,
          )}
        >
          <div className="flex items-start gap-3">
            <CheckCircle2 className="h-12 w-12 text-success-strong shrink-0" aria-hidden="true" />
            <div className="flex-1">
              <p className="text-xl font-bold text-success-strong uppercase tracking-wide">
                In Operation
              </p>
              <p className="text-sm text-success-strong/80 mt-1">
                Resumed at:{" "}
                <span className="font-semibold">
                  {format(new Date(lineResumedAt), "dd/MM/yyyy HH:mm")}
                </span>
              </p>
              {totalDowntime !== null && (
                <p className="text-sm text-success-strong/80">
                  Total downtime:{" "}
                  <span className="font-mono font-bold">{totalDowntime}m</span>
                </p>
              )}
              <p className="text-xs text-muted-foreground mt-2">
                Engineer still working on this order.
              </p>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div
        className={cn(
          "rounded-md bg-success/15 text-success-strong px-3 py-2 flex items-center gap-2 text-sm font-medium border border-success/40",
          className,
        )}
      >
        <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>LINE RUNNING</span>
        {totalDowntime !== null && (
          <span className="font-mono">· downtime: {totalDowntime}m</span>
        )}
      </div>
    );
  }

  // STATE 3: Line never stopped
  if (variant === "detail") {
    return (
      <div
        className={cn(
          "rounded-lg border bg-muted/40 p-4",
          className,
        )}
      >
        <div className="flex items-center gap-3">
          <Circle className="h-10 w-10 text-muted-foreground shrink-0" aria-hidden="true" />
          <div>
            <p className="text-base font-semibold text-foreground">
              Line Running
            </p>
            <p className="text-xs text-muted-foreground">
              No production stoppage reported.
            </p>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div
      className={cn(
        "rounded-md bg-muted text-muted-foreground px-3 py-1.5 flex items-center gap-2 text-xs font-medium",
        className,
      )}
    >
      <Circle className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span>LINE RUNNING · no stoppage</span>
    </div>
  );
}
