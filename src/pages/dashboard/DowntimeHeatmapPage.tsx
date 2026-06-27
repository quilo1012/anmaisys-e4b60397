import { useMemo } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useDowntime } from "@/hooks/useDowntime";
import { formatMinutes } from "@/lib/formatDuration";
import { Skeleton } from "@/components/ui/skeleton";
import { Lightbulb } from "lucide-react";

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

  const { matrix, lines, lineTotals, dayShiftTotals, insights, grandMax } = useMemo(() => {
    type LineMap = Map<string, Cell>; // key: `${dayIdx}-${shift}`
    const perLine = new Map<string, LineMap>();
    const dayShiftTotals = new Map<string, Cell>(); // key: `${dayIdx}-${shift}`
    const lineTotals = new Map<string, Cell>();
    let grandMax = 0;

    for (const r of records ?? []) {
      if (!r.started_at) continue;
      const line = r.line || "—";
      const start = new Date(r.started_at).getTime();
      const end = r.ended_at ? new Date(r.ended_at).getTime() : Date.now();
      const minutes = Math.max(0, Math.round((end - start) / 60000));
      if (minutes <= 0) continue;
      const { dayIdx, hour } = londonParts(new Date(start));
      const shift = shiftOf(hour);
      const key = `${dayIdx}-${shift}`;

      const lm = perLine.get(line) ?? new Map<string, Cell>();
      const cell = lm.get(key) ?? { minutes: 0, count: 0 };
      cell.minutes += minutes;
      cell.count += 1;
      lm.set(key, cell);
      perLine.set(line, lm);

      const dst = dayShiftTotals.get(key) ?? { minutes: 0, count: 0 };
      dst.minutes += minutes;
      dst.count += 1;
      dayShiftTotals.set(key, dst);

      const lt = lineTotals.get(line) ?? { minutes: 0, count: 0 };
      lt.minutes += minutes;
      lt.count += 1;
      lineTotals.set(line, lt);

      if (cell.minutes > grandMax) grandMax = cell.minutes;
    }

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
  }, [records]);

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Downtime Heatmap</h1>
          <p className="text-sm text-muted-foreground">
            Line × Weekday × Shift — last 90 days, Europe/London time.
          </p>
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
                      {DAYS.map((d) => (
                        <>
                          <th key={`${d}-D`} className="font-normal">D</th>
                          <th key={`${d}-N`} className="font-normal">N</th>
                        </>
                      ))}
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {lines.length === 0 && (
                      <tr>
                        <td colSpan={16} className="p-8 text-center text-muted-foreground">
                          No downtime recorded in the last 90 days.
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
                        <td />
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
