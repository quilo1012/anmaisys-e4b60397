import { useEffect, useMemo, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useDowntime } from "@/hooks/useDowntime";
import { formatMinutes } from "@/lib/formatDuration";
import { Skeleton } from "@/components/ui/skeleton";
import { Lightbulb, CalendarIcon } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { unionMs, type Interval } from "@/lib/downtimeReconcile";

type RangePreset = "today" | "shift" | "7d" | "30d" | "90d" | "custom";
const STORAGE_KEY = "downtime-heatmap-range";

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function endOfDay(d: Date) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }

function presetRange(preset: Exclude<RangePreset, "custom">): { from: number; to: number } {
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  switch (preset) {
    case "today": return { from: startOfDay(new Date()).getTime(), to: now };
    case "shift": {
      const d = new Date();
      const h = d.getHours();
      const start = new Date(d);
      if (h >= 6 && h < 18) start.setHours(6, 0, 0, 0);
      else if (h >= 18) start.setHours(18, 0, 0, 0);
      else { start.setDate(start.getDate() - 1); start.setHours(18, 0, 0, 0); }
      return { from: start.getTime(), to: now };
    }
    case "7d": return { from: now - 7 * DAY, to: now };
    case "30d": return { from: now - 30 * DAY, to: now };
    case "90d": return { from: now - 90 * DAY, to: now };
  }
}

const RANGE_LABEL: Record<RangePreset, string> = {
  today: "Today",
  shift: "Current shift",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  custom: "Custom range",
};




const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const SHIFTS = ["Day", "Night"] as const;
type Shift = (typeof SHIFTS)[number];

interface Cell {
  minutes: number;
  count: number;
}

/** Returns London-local { weekdayIdx 0=Mon..6=Sun, hour 0-23 } for a date. */
function londonParts(d: Date): { dayIdx: number; hour: number } {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    hour: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  const hr = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const map: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  return { dayIdx: map[wd] ?? 0, hour: hr === 24 ? 0 : hr };
}

function shiftOf(hour: number): Shift {
  // Day shift 06:00–17:59, Night 18:00–05:59
  return hour >= 6 && hour < 18 ? "Day" : "Night";
}

/** London wall-clock parts for a given instant. */
function londonAllParts(at: Date) {
  const dtf = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = Object.fromEntries(
    dtf.formatToParts(at).filter((x) => x.type !== "literal").map((x) => [x.type, x.value]),
  ) as Record<string, string>;
  return {
    year: +p.year, month: +p.month, day: +p.day,
    hour: +p.hour === 24 ? 0 : +p.hour,
    minute: +p.minute, second: +p.second,
  };
}

function londonOffsetMinutes(at: Date): number {
  const p = londonAllParts(at);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUTC - at.getTime()) / 60000);
}

/** Convert a London wall-clock time to a UTC epoch ms. */
function londonWallToUtc(y: number, mo: number, d: number, h: number): number {
  const naive = Date.UTC(y, mo - 1, d, h, 0, 0);
  const off = londonOffsetMinutes(new Date(naive));
  return naive - off * 60000;
}

/** Next London 06:00 or 18:00 boundary strictly after `t`. */
function nextShiftBoundary(t: number): number {
  const p = londonAllParts(new Date(t));
  if (p.hour < 6) return londonWallToUtc(p.year, p.month, p.day, 6);
  if (p.hour < 18) return londonWallToUtc(p.year, p.month, p.day, 18);
  return londonWallToUtc(p.year, p.month, p.day + 1, 6);
}

function cellColor(minutes: number, max: number): string {
  if (minutes <= 0) return "bg-background";
  const pct = max > 0 ? minutes / max : 0;
  if (pct < 0.15) return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
  if (pct < 0.35) return "bg-amber-400/25 text-amber-800 dark:text-amber-200";
  if (pct < 0.65) return "bg-orange-500/40 text-orange-900 dark:text-orange-100";
  return "bg-red-600/70 text-white";
}

export default function DowntimeHeatmapPage() {
  const { data: records, isLoading } = useDowntime();

  const [range, setRange] = useState<RangePreset>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.range && parsed.range in RANGE_LABEL) return parsed.range as RangePreset;
      }
    } catch { /* ignore */ }
    return "30d";
  });
  const [customFrom, setCustomFrom] = useState<Date | undefined>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (p?.from) return new Date(p.from);
      }
    } catch { /* ignore */ }
    return undefined;
  });
  const [customTo, setCustomTo] = useState<Date | undefined>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (p?.to) return new Date(p.to);
      }
    } catch { /* ignore */ }
    return undefined;
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        range,
        from: customFrom?.toISOString() ?? null,
        to: customTo?.toISOString() ?? null,
      }));
    } catch { /* ignore */ }
  }, [range, customFrom, customTo]);

  const { fromMs, toMs } = useMemo(() => {
    if (range === "custom") {
      const f = customFrom ? startOfDay(customFrom).getTime() : Date.now() - 7 * 86400000;
      const t = customTo ? endOfDay(customTo).getTime() : Date.now();
      return { fromMs: f, toMs: t };
    }
    const r = presetRange(range);
    return { fromMs: r.from, toMs: r.to };
  }, [range, customFrom, customTo]);



  const { matrix, lines, lineTotals, dayShiftTotals, insights, grandMax } = useMemo(() => {
    // Collect intervals per (line, day, shift) and per-line so parallel /
    // overlapping stops on the same line are UNION'd (counted once), matching
    // Downtime Records / Shift Breakdown behaviour.
    const perLineIntervals = new Map<string, Map<string, Interval[]>>(); // line -> key -> intervals
    const perLineCounts = new Map<string, Map<string, number>>();        // line -> key -> event count
    const lineAllIntervals = new Map<string, Interval[]>();              // line -> all intervals

    for (const r of records ?? []) {
      if (!r.started_at) continue;
      const line = r.line || "—";
      const start = new Date(r.started_at).getTime();
      const end = r.ended_at ? new Date(r.ended_at).getTime() : Date.now();
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
      if (end <= fromMs || start >= toMs) continue;
      const clampedStart = Math.max(start, fromMs);
      const clampedEnd = Math.min(end, toMs);
      if (clampedEnd <= clampedStart) continue;

      const li = perLineIntervals.get(line) ?? new Map<string, Interval[]>();
      perLineIntervals.set(line, li);
      const lc = perLineCounts.get(line) ?? new Map<string, number>();
      perLineCounts.set(line, lc);

      const allIvs = lineAllIntervals.get(line) ?? [];
      allIvs.push([clampedStart, clampedEnd]);
      lineAllIntervals.set(line, allIvs);

      // Split at London 06:00/18:00 shift boundaries so each segment lands in
      // the correct (weekday, shift) bucket even when a stop crosses shifts.
      let cursor = clampedStart;
      while (cursor < clampedEnd) {
        const boundary = Math.min(nextShiftBoundary(cursor), clampedEnd);
        if (boundary > cursor) {
          const parts = londonAllParts(new Date(cursor));
          const jsWd = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
          const dayIdx = (jsWd + 6) % 7; // 0=Mon..6=Sun
          const shift = shiftOf(parts.hour);
          const key = `${dayIdx}-${shift}`;
          const ivs = li.get(key) ?? [];
          ivs.push([cursor, boundary]);
          li.set(key, ivs);
        }
        cursor = boundary;
      }

      // Count each event once, on the shift/day it started in.
      const sp = londonAllParts(new Date(clampedStart));
      const sJsWd = new Date(Date.UTC(sp.year, sp.month - 1, sp.day)).getUTCDay();
      const startKey = `${(sJsWd + 6) % 7}-${shiftOf(sp.hour)}`;
      lc.set(startKey, (lc.get(startKey) ?? 0) + 1);
    }

    // Reduce intervals -> minutes (union per bucket, per line total).
    const perLine = new Map<string, Map<string, Cell>>();
    const dayShiftTotals = new Map<string, Cell>();
    const lineTotals = new Map<string, Cell>();
    let grandMax = 0;

    perLineIntervals.forEach((buckets, line) => {
      const cells = new Map<string, Cell>();
      const counts = perLineCounts.get(line);
      buckets.forEach((ivs, key) => {
        const minutes = Math.round(unionMs(ivs) / 60_000);
        const count = counts?.get(key) ?? 0;
        cells.set(key, { minutes, count });
        if (minutes > grandMax) grandMax = minutes;
        const dst = dayShiftTotals.get(key) ?? { minutes: 0, count: 0 };
        dst.minutes += minutes; // per-line unions summed across lines
        dst.count += count;
        dayShiftTotals.set(key, dst);
      });
      perLine.set(line, cells);
      const totalMin = Math.round(unionMs(lineAllIntervals.get(line) ?? []) / 60_000);
      const totalCount = Array.from(counts?.values() ?? []).reduce((a, b) => a + b, 0);
      lineTotals.set(line, { minutes: totalMin, count: totalCount });
    });

    const lines = Array.from(perLine.keys()).sort((a, b) => {
      const ma = /line\s*(\d+)/i.exec(a)?.[1];
      const mb = /line\s*(\d+)/i.exec(b)?.[1];
      if (ma && mb) return Number(ma) - Number(mb);
      return a.localeCompare(b);
    });

    // Insights: worst day×shift per line if it's ≥ 40% of line's total
    const insights: string[] = [];
    for (const line of lines) {
      const lm = perLine.get(line)!;
      const total = lineTotals.get(line)?.minutes ?? 0;
      if (total < 60) continue;
      let worst: { key: string; minutes: number } | null = null;
      lm.forEach((cell, key) => {
        if (!worst || cell.minutes > worst.minutes) worst = { key, minutes: cell.minutes };
      });
      if (worst && worst.minutes / total >= 0.35) {
        const [d, s] = worst.key.split("-");
        const dayName = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][Number(d)];
        const pmDay = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][Number(d)];
        insights.push(
          `${dayName} ${s} shift concentrates ${Math.round((worst.minutes / total) * 100)}% of ${line}'s downtime (${formatMinutes(worst.minutes)}). Consider scheduling PM on ${pmDay} ${s === "Day" ? "night" : "day"}.`,
        );
      }
    }

    return { matrix: perLine, lines, lineTotals, dayShiftTotals, insights, grandMax };
  }, [records, fromMs, toMs]);

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">Downtime Heatmap</h1>
            <p className="text-sm text-muted-foreground">
              Line × Weekday × Shift — {RANGE_LABEL[range]}, Europe/London time.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={range} onValueChange={(v) => setRange(v as RangePreset)}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(RANGE_LABEL) as RangePreset[]).map((k) => (
                  <SelectItem key={k} value={k}>{RANGE_LABEL[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {range === "custom" && (
              <>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("w-[160px] justify-start text-left font-normal", !customFrom && "text-muted-foreground")}>
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {customFrom ? format(customFrom, "PP") : "From"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={customFrom} onSelect={setCustomFrom} initialFocus className={cn("p-3 pointer-events-auto")} />
                  </PopoverContent>
                </Popover>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("w-[160px] justify-start text-left font-normal", !customTo && "text-muted-foreground")}>
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {customTo ? format(customTo, "PP") : "To"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={customTo} onSelect={setCustomTo} initialFocus className={cn("p-3 pointer-events-auto")} />
                  </PopoverContent>
                </Popover>
              </>
            )}
          </div>
        </div>



        {isLoading ? (
          <Skeleton className="h-96" />
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Pattern Matrix</CardTitle>
                <CardDescription>
                  Each cell shows total downtime and number of events. Darker = worse.
                </CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full text-xs border-separate border-spacing-1 min-w-[760px]">
                  <thead>
                    <tr>
                      <th className="text-left p-2 sticky left-0 bg-card">Line</th>
                      {DAYS.map((d) => (
                        <th key={d} colSpan={2} className="text-center p-1 font-semibold">
                          {d}
                        </th>
                      ))}
                      <th className="text-right p-2">Total</th>
                    </tr>
                    <tr className="text-[10px] text-muted-foreground">
                      <th />
                      {DAYS.flatMap((d) => [
                        <th key={`${d}-D`} className="font-normal">D</th>,
                        <th key={`${d}-N`} className="font-normal">N</th>,
                      ])}
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {lines.length === 0 && (
                      <tr>
                        <td colSpan={16} className="p-8 text-center text-muted-foreground">
                          No downtime recorded in the selected range ({RANGE_LABEL[range]}).
                        </td>

                      </tr>
                    )}
                    {lines.map((line) => {
                      const lm = matrix.get(line)!;
                      const total = lineTotals.get(line)?.minutes ?? 0;
                      return (
                        <tr key={line}>
                          <td className="p-2 font-medium sticky left-0 bg-card">{line}</td>
                          {DAYS.map((_, di) =>
                            SHIFTS.map((s) => {
                              const c = lm.get(`${di}-${s}`) ?? { minutes: 0, count: 0 };
                              return (
                                <td
                                  key={`${line}-${di}-${s}`}
                                  className={`text-center rounded ${cellColor(c.minutes, grandMax)}`}
                                  title={`${line} • ${DAYS[di]} ${s}: ${formatMinutes(c.minutes)} (${c.count} events)`}
                                >
                                  <div className="px-1 py-1 leading-tight">
                                    <div className="font-semibold tabular-nums">
                                      {c.minutes > 0 ? formatMinutes(c.minutes) : "—"}
                                    </div>
                                    {c.count > 0 && (
                                      <div className="text-[10px] opacity-80">{c.count}×</div>
                                    )}
                                  </div>
                                </td>
                              );
                            }),
                          )}
                          <td className="p-2 text-right font-semibold tabular-nums">
                            {formatMinutes(total)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {lines.length > 0 && (
                    <tfoot>
                      <tr className="border-t">
                        <td className="p-2 font-semibold sticky left-0 bg-card">Totals</td>
                        {DAYS.map((_, di) =>
                          SHIFTS.map((s) => {
                            const c = dayShiftTotals.get(`${di}-${s}`) ?? { minutes: 0, count: 0 };
                            return (
                              <td
                                key={`tot-${di}-${s}`}
                                className="text-center p-1 font-semibold tabular-nums text-muted-foreground"
                              >
                                {c.minutes > 0 ? formatMinutes(c.minutes) : "—"}
                              </td>
                            );
                          }),
                        )}
                        <td className="p-2 text-right font-bold tabular-nums">
                          {(() => {
                            let g = 0;
                            for (const c of dayShiftTotals.values()) g += c.minutes;
                            return g > 0 ? formatMinutes(g) : "—";
                          })()}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Lightbulb className="h-5 w-5 text-amber-500" />
                  Auto Insights
                </CardTitle>
                <CardDescription>
                  Suggested PM windows based on recurring downtime concentration.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {insights.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No strong day/shift concentration detected. Downtime is distributed evenly.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {insights.map((msg, i) => (
                      <li
                        key={i}
                        className="text-sm rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2"
                      >
                        {msg}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
