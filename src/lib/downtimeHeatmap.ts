// Shared downtime heatmap aggregation — used by both the on-screen Pattern
// Matrix and the PDF report so they never diverge. Buckets each stop into
// weekday × shift cells (splitting across shift boundaries), unions overlapping
// intervals, and derives per-line / per-cell / grand totals + PM insights.
import { type Interval, unionMs } from "./downtimeReconcile";
import { formatMinutes } from "./formatDuration";

export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export const SHIFTS = ["Day", "Night"] as const;
export type Shift = (typeof SHIFTS)[number];
export interface Cell { minutes: number; count: number }

export interface HeatmapRecord { line?: string | null; started_at?: string | null; ended_at?: string | null }

export function shiftOf(hour: number): Shift {
  return hour >= 6 && hour < 18 ? "Day" : "Night";
}

export function londonAllParts(at: Date) {
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

function londonWallToUtc(y: number, mo: number, d: number, h: number): number {
  const naive = Date.UTC(y, mo - 1, d, h, 0, 0);
  const off = londonOffsetMinutes(new Date(naive));
  return naive - off * 60000;
}

function unionMinutes(intervals: Interval[]): number {
  const ms = unionMs(intervals);
  if (ms <= 0) return 0;
  return Math.max(1, Math.round(ms / 60_000));
}

export function nextShiftBoundary(t: number): number {
  const p = londonAllParts(new Date(t));
  if (p.hour < 6) return londonWallToUtc(p.year, p.month, p.day, 6);
  if (p.hour < 18) return londonWallToUtc(p.year, p.month, p.day, 18);
  return londonWallToUtc(p.year, p.month, p.day + 1, 6);
}

export interface HeatmapResult {
  matrix: Map<string, Map<string, Cell>>;
  lines: string[];
  lineTotals: Map<string, Cell>;
  dayShiftTotals: Map<string, Cell>;
  grandMax: number;
  grandTotalMinutes: number;
  insights: string[];
}

export function computeHeatmap(
  records: HeatmapRecord[] | undefined,
  fromMs: number,
  toMs: number,
  lineFilter: string,
  shiftFilter: "all" | Shift,
): HeatmapResult {
  const perLineIntervals = new Map<string, Map<string, Interval[]>>();
  const perLineCounts = new Map<string, Map<string, number>>();
  const lineAllIntervals = new Map<string, Interval[]>();
  const allKeyIntervals = new Map<string, Interval[]>();
  const globalIntervals: Interval[] = [];

  for (const r of records ?? []) {
    if (!r.started_at) continue;
    const line = r.line || "—";
    if (lineFilter !== "all" && line !== lineFilter) continue;
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
    lineAllIntervals.set(line, allIvs);

    let cursor = clampedStart;
    while (cursor < clampedEnd) {
      const boundary = Math.min(nextShiftBoundary(cursor), clampedEnd);
      if (boundary > cursor) {
        const parts = londonAllParts(new Date(cursor));
        const jsWd = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
        const dayIdx = (jsWd + 6) % 7;
        const shift = shiftOf(parts.hour);
        if (shiftFilter === "all" || shift === shiftFilter) {
          const key = `${dayIdx}-${shift}`;
          const ivs = li.get(key) ?? [];
          ivs.push([cursor, boundary]);
          li.set(key, ivs);
          allIvs.push([cursor, boundary]);
          const ak = allKeyIntervals.get(key) ?? [];
          ak.push([cursor, boundary]);
          allKeyIntervals.set(key, ak);
          globalIntervals.push([cursor, boundary]);
        }
      }
      cursor = boundary;
    }

    const sp = londonAllParts(new Date(clampedStart));
    const sJsWd = new Date(Date.UTC(sp.year, sp.month - 1, sp.day)).getUTCDay();
    const startShift = shiftOf(sp.hour);
    if (shiftFilter === "all" || startShift === shiftFilter) {
      const startKey = `${(sJsWd + 6) % 7}-${startShift}`;
      lc.set(startKey, (lc.get(startKey) ?? 0) + 1);
    }
  }

  const matrix = new Map<string, Map<string, Cell>>();
  const dayShiftTotals = new Map<string, Cell>();
  const lineTotals = new Map<string, Cell>();
  let grandMax = 0;

  perLineIntervals.forEach((buckets, line) => {
    const cells = new Map<string, Cell>();
    const counts = perLineCounts.get(line);
    buckets.forEach((ivs, key) => {
      const minutes = unionMinutes(ivs);
      const count = counts?.get(key) ?? 0;
      cells.set(key, { minutes, count });
      if (minutes > grandMax) grandMax = minutes;
    });
    matrix.set(line, cells);
    const totalMin = unionMinutes(lineAllIntervals.get(line) ?? []);
    const totalCount = Array.from(counts?.values() ?? []).reduce((a, b) => a + b, 0);
    lineTotals.set(line, { minutes: totalMin, count: totalCount });
  });

  allKeyIntervals.forEach((ivs, key) => dayShiftTotals.set(key, { minutes: unionMinutes(ivs), count: 0 }));
  const grandTotalMinutes = unionMinutes(globalIntervals);

  const lines = Array.from(matrix.keys()).sort((a, b) => {
    const ma = /line\s*(\d+)/i.exec(a)?.[1];
    const mb = /line\s*(\d+)/i.exec(b)?.[1];
    if (ma && mb) return Number(ma) - Number(mb);
    return a.localeCompare(b);
  });

  const insights: string[] = [];
  for (const line of lines) {
    const lm = matrix.get(line)!;
    const total = lineTotals.get(line)?.minutes ?? 0;
    if (total < 60) continue;
    let worst: { key: string; minutes: number } | null = null;
    lm.forEach((cell, key) => { if (!worst || cell.minutes > worst.minutes) worst = { key, minutes: cell.minutes }; });
    if (worst && worst.minutes / total >= 0.35) {
      const [d, s] = worst.key.split("-");
      const dayName = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][Number(d)];
      const pmDay = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][Number(d)];
      insights.push(
        `${dayName} ${s} shift concentrates ${Math.round((worst.minutes / total) * 100)}% of ${line}'s downtime (${formatMinutes(worst.minutes)}). Consider scheduling PM on ${pmDay} ${s === "Day" ? "night" : "day"}.`,
      );
    }
  }

  return { matrix, lines, lineTotals, dayShiftTotals, grandMax, grandTotalMinutes, insights };
}
