// Shared downtime heatmap aggregation — used by both the on-screen Pattern
// Matrix and the PDF report so they never diverge. Buckets each stop into
// weekday × shift cells (splitting across shift boundaries), unions overlapping
// intervals, and derives per-line / per-cell / grand totals + PM insights.
import { type Interval, unionMinutes } from "./downtimeReconcile";
import { buildPatternInsight, isSystemClosed, type PatternInsight } from "./downtimeAttribution";

export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export const SHIFTS = ["Day", "Night"] as const;
export type Shift = (typeof SHIFTS)[number];

export interface Cell {
  minutes: number;
  count: number;
  /** Of `minutes`, how many came from stops the system closed rather than a person. */
  systemMinutes: number;
}

export interface HeatmapRecord {
  line?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
  /** Manual rows carry a typed end time, so the boundary heuristic must skip them. */
  source?: "manual" | "wo_event";
  /** Who pressed Resume, and what note was left — see isSystemClosed. */
  resumed_by?: string | null;
  resumed_by_name?: string | null;
  notes?: string | null;
  /** Identity of this row. A stop split by an exclusion arrives as several rows. */
  id?: string | null;
  /** The stoppage a split piece came from — what a "count" means in this table. */
  source_row_id?: string | null;
}


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
  /** Of `grandTotalMinutes`, the share nobody resumed. */
  grandSystemMinutes: number;
  insights: PatternInsight[];
}

/** Interval buckets kept twice: every stop, and only the system-closed ones. */
interface Buckets {
  all: Interval[];
  system: Interval[];
}

function bucket(map: Map<string, Buckets>, key: string): Buckets {
  const b = map.get(key) ?? { all: [], system: [] };
  map.set(key, b);
  return b;
}

export function computeHeatmap(
  records: HeatmapRecord[] | undefined,
  fromMs: number,
  toMs: number,
  lineFilter: string,
  shiftFilter: "all" | Shift,
): HeatmapResult {
  const perLineIntervals = new Map<string, Map<string, Buckets>>();
  const perLineCounts = new Map<string, Map<string, number>>();
  const lineAllIntervals = new Map<string, Buckets>();
  const allKeyIntervals = new Map<string, Buckets>();
  const globalIntervals: Buckets = { all: [], system: [] };

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

    // A clock closed this one, not a person — its minutes are evidence the line
    // was down, but not a measurement of how long.
    const unresumed = isSystemClosed(r);

    const li = perLineIntervals.get(line) ?? new Map<string, Buckets>();
    perLineIntervals.set(line, li);
    const lc = perLineCounts.get(line) ?? new Map<string, number>();
    perLineCounts.set(line, lc);
    const lineBucket = bucket(lineAllIntervals, line);

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
          const slice: Interval = [cursor, boundary];
          for (const b of [bucket(li, key), lineBucket, bucket(allKeyIntervals, key), globalIntervals]) {
            b.all.push(slice);
            if (unresumed) b.system.push(slice);
          }
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
    buckets.forEach((b, key) => {
      const minutes = unionMinutes(b.all);
      const count = counts?.get(key) ?? 0;
      cells.set(key, { minutes, count, systemMinutes: unionMinutes(b.system) });
      if (minutes > grandMax) grandMax = minutes;
    });
    matrix.set(line, cells);
    const lineBucket = lineAllIntervals.get(line) ?? { all: [], system: [] };
    const totalCount = Array.from(counts?.values() ?? []).reduce((a, b) => a + b, 0);
    lineTotals.set(line, {
      minutes: unionMinutes(lineBucket.all),
      count: totalCount,
      systemMinutes: unionMinutes(lineBucket.system),
    });
  });

  allKeyIntervals.forEach((b, key) =>
    dayShiftTotals.set(key, { minutes: unionMinutes(b.all), count: 0, systemMinutes: unionMinutes(b.system) }),
  );
  const grandTotalMinutes = unionMinutes(globalIntervals.all);
  const grandSystemMinutes = unionMinutes(globalIntervals.system);

  const lines = Array.from(matrix.keys()).sort((a, b) => {
    const ma = /line\s*(\d+)/i.exec(a)?.[1];
    const mb = /line\s*(\d+)/i.exec(b)?.[1];
    if (ma && mb) return Number(ma) - Number(mb);
    return a.localeCompare(b);
  });

  const insights: PatternInsight[] = [];
  for (const line of lines) {
    const cells = Array.from(matrix.get(line)!.entries()).map(([key, c]) => ({
      key,
      minutes: c.minutes,
      systemMinutes: c.systemMinutes,
    }));
    const insight = buildPatternInsight(line, lineTotals.get(line)?.minutes ?? 0, cells);
    if (insight) insights.push(insight);
  }

  return {
    matrix,
    lines,
    lineTotals,
    dayShiftTotals,
    grandMax,
    grandTotalMinutes,
    grandSystemMinutes,
    insights,
  };
}
