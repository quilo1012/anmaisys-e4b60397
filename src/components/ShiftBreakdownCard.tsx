import { useMemo, useState } from "react";
import { Sun, Moon, ChevronLeft, ChevronRight, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  useShiftDowntime,
  getShiftWindows,
  eventMinutesInWindow,
  type ShiftType,
} from "@/hooks/useShiftDowntime";
import type { DowntimeEvent } from "@/hooks/useDowntimeEvents";
import { reconcileMinutes } from "@/lib/downtimeReconcile";

function toLondonISODate(d: Date): string {
  // YYYY-MM-DD in London local time
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  return dtf.format(d);
}

function fmtDur(min: number): string {
  if (min <= 0) return "0m";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

interface ShiftPanelProps {
  shift: ShiftType;
  events: DowntimeEvent[];
  windowStart: Date;
  windowEnd: Date;
}

function ShiftPanel({ shift, events, windowStart, windowEnd }: ShiftPanelProps) {
  // Aggregate per asset/line. Do not use stopped_reason as the row label: it is
  // the problem text (e.g. "Again"), not the machine/line that is down.
  const rows = useMemo(() => {
    const byKey: Record<string, { label: string; minutes: number; ongoing: boolean }> = {};
    events.forEach((e) => {
      const machine = (e.machine ?? "").toString().trim();
      const line = (e.line_name ?? e.line_at_time ?? "").toString().trim();
      const key = machine || line || "Unassigned machine";
      const min = eventMinutesInWindow(e, windowStart, windowEnd);
      if (min <= 0) return;
      if (!byKey[key]) byKey[key] = { label: key, minutes: 0, ongoing: false };
      byKey[key].minutes += min;
      if (!e.resumed_at) byKey[key].ongoing = true;
    });
    return Object.values(byKey).sort((a, b) => b.minutes - a.minutes);
  }, [events, windowStart, windowEnd]);

  // Wall-clock total via shared reconciler (same math as DowntimePage KPI).
  const total = useMemo(
    () =>
      reconcileMinutes(
        events.map((e) => ({ start: e.stopped_at, end: e.resumed_at })),
        windowStart.getTime(),
        windowEnd.getTime(),
      ),
    [events, windowStart, windowEnd],
  );
  const isDay = shift === "day";

  return (
    <Card className={isDay ? "border-amber-500/40" : "border-indigo-500/40"}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          {isDay ? (
            <Sun className="h-5 w-5 text-amber-500" />
          ) : (
            <Moon className="h-5 w-5 text-indigo-400" />
          )}
          {isDay ? "Day Shift" : "Night Shift"}
          <span className="text-xs font-normal text-muted-foreground ml-1">
            {isDay ? "06:00 – 18:00" : "18:00 – 06:00"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No downtime recorded.</p>
        ) : (
          <div className="space-y-1.5">
            <div className="grid grid-cols-[1fr_auto] text-xs text-muted-foreground border-b pb-1">
              <span>Machine / Line</span>
              <span>Downtime</span>
            </div>
            {rows.map((r) => (
              <div key={r.label} className="grid grid-cols-[1fr_auto] text-sm py-1 items-center">
                <span className="truncate flex items-center gap-1">
                  {r.label}
                  {r.ongoing && (
                    <Badge variant="outline" className="text-[10px] border-red-500 text-red-600 ml-1">
                      LIVE
                    </Badge>
                  )}
                </span>
                <span className="font-mono">{fmtDur(r.minutes)}</span>
              </div>
            ))}
          </div>
        )}
        <div className="border-t pt-2 flex items-center justify-between">
          <span className="text-sm font-semibold">Total</span>
          <span className="font-mono font-bold">{fmtDur(total)}</span>
        </div>
        <div className="text-xs text-muted-foreground">
          Stops: {events.length}
        </div>
      </CardContent>
    </Card>
  );
}

interface ShiftBreakdownCardProps {
  /** Optional controlled date. When provided, the card follows this date instead of its own state. */
  date?: Date;
  onDateChange?: (d: Date) => void;
}

export function ShiftBreakdownCard({ date: externalDate, onDateChange }: ShiftBreakdownCardProps = {}) {
  const [internalDate, setInternalDate] = useState<Date>(new Date());
  const date = externalDate ?? internalDate;
  const setDate = (d: Date) => {
    if (onDateChange) onDateChange(d);
    if (externalDate === undefined) setInternalDate(d);
  };
  const dateISO = toLondonISODate(date);
  const { data, isLoading } = useShiftDowntime(dateISO);
  const { dayStart, dayEnd, nightStart, nightEnd } = getShiftWindows(dateISO);

  const shiftDay = data?.day || [];
  const shiftNight = data?.night || [];

  const shift = (() => {
    const dtf = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London", hour: "numeric", hour12: false,
    });
    const h = parseInt(dtf.format(new Date()), 10);
    return h >= 6 && h < 18 ? "day" : "night";
  })();

  const totalLive =
    shiftDay.filter((e) => !e.resumed_at).length +
    shiftNight.filter((e) => !e.resumed_at).length;

  const adjust = (days: number) => {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    setDate(next);
  };

  const labelDate = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short", day: "2-digit", month: "short", year: "numeric",
  }).format(date);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base flex items-center gap-2">
            Shift Breakdown
            {totalLive > 0 && (
              <Badge variant="outline" className="border-red-500 text-red-600">
                <AlertTriangle className="h-3 w-3 mr-1" /> {totalLive} live
              </Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => adjust(-1)} aria-label="Previous day">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium min-w-[160px] text-center">{labelDate}</span>
            <Button variant="outline" size="sm" onClick={() => adjust(1)} aria-label="Next day">
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setDate(new Date())}>
              Today
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Day/Night downtime per machine — Europe/London time. Total = wall-clock
          (parallel stoppages counted once). Current shift:{" "}
          <span className="font-semibold capitalize">{shift}</span>.
        </p>

      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <ShiftPanel shift="day" events={shiftDay} windowStart={dayStart} windowEnd={dayEnd} />
            <ShiftPanel shift="night" events={shiftNight} windowStart={nightStart} windowEnd={nightEnd} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
