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

/**
 * A coluna a que uma fatia pertence, 0 = segunda.
 *
 * A noite corre das 18:00 às 06:00 e é toda do dia em que entrou: quem a fez
 * chama-lhe a noite do 28, não meia noite do 28 e meia do 29, e o resto do
 * sistema já a arruma assim — ver `getCurrentFactoryShift` e o comentário do
 * `shiftSessionDate` em `lib/shifts.ts`.
 *
 * Isto lia a data de calendário e mais nada. Das 00:00 às 06:00 a data de
 * calendário já é o dia seguinte, por isso a cauda de cada noite ia para a noite
 * do dia a seguir — que já lá tinha a sua própria noite inteira. A célula somava
 * as duas e chegava a 18 horas, num turno que tem doze. Apareceu no ecrã do
 * armazém, numa espera que atravessou quatro noites seguidas.
 */
function shiftDayIndex(parts: { year: number; month: number; day: number; hour: number }): number {
  const atMidnight = Date.UTC(parts.year, parts.month - 1, parts.day);
  const owning = new Date(parts.hour < 6 ? atMidnight - 86_400_000 : atMidnight);
  return (owning.getUTCDay() + 6) % 7;
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
  /** Distinct stoppages per line per cell — pieces of one stop share an id. */
  const perLineCounts = new Map<string, Map<string, Set<string>>>();
  const perLineAllIds = new Map<string, Set<string>>();
  const perKeyIds = new Map<string, Set<string>>();
  const lineAllIntervals = new Map<string, Buckets>();
  const allKeyIntervals = new Map<string, Buckets>();
  const globalIntervals: Buckets = { all: [], system: [] };

  let idx = -1;
  for (const r of records ?? []) {
    idx += 1;
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

    // A stop a break cut in half arrives here as two rows. It is still one stoppage.
    const stoppageId = String(r.source_row_id ?? r.id ?? `#${idx}`);

    // A clock closed this one, not a person — its minutes are evidence the line
    // was down, but not a measurement of how long.
    const unresumed = isSystemClosed(r);

    const li = perLineIntervals.get(line) ?? new Map<string, Buckets>();
    perLineIntervals.set(line, li);
    const lc = perLineCounts.get(line) ?? new Map<string, Set<string>>();
    perLineCounts.set(line, lc);
    const lineBucket = bucket(lineAllIntervals, line);

    let cursor = clampedStart;
    while (cursor < clampedEnd) {
      const boundary = Math.min(nextShiftBoundary(cursor), clampedEnd);
      if (boundary > cursor) {
        const parts = londonAllParts(new Date(cursor));
        const dayIdx = shiftDayIndex(parts);
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
    const startShift = shiftOf(sp.hour);
    if (shiftFilter === "all" || startShift === shiftFilter) {
      // A contagem segue a mesma coluna que os minutos: uma paragem que entra às
      // 23:30 é da noite de quarta, não de duas noites diferentes.
      const startKey = `${shiftDayIndex(sp)}-${startShift}`;
      const cellIds = lc.get(startKey) ?? new Set<string>();
      lc.set(startKey, cellIds);
      cellIds.add(stoppageId);
      const lineIds = perLineAllIds.get(line) ?? new Set<string>();
      perLineAllIds.set(line, lineIds);
      lineIds.add(stoppageId);
      const keyIds = perKeyIds.get(startKey) ?? new Set<string>();
      perKeyIds.set(startKey, keyIds);
      keyIds.add(stoppageId);
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
      const count = counts?.get(key)?.size ?? 0;
      cells.set(key, { minutes, count, systemMinutes: unionMinutes(b.system) });
      if (minutes > grandMax) grandMax = minutes;
    });
    matrix.set(line, cells);
    const lineBucket = lineAllIntervals.get(line) ?? { all: [], system: [] };
    const totalCount = perLineAllIds.get(line)?.size ?? 0;
    lineTotals.set(line, {
      minutes: unionMinutes(lineBucket.all),
      count: totalCount,
      systemMinutes: unionMinutes(lineBucket.system),
    });
  });

  allKeyIntervals.forEach((b, key) =>
    dayShiftTotals.set(key, {
      minutes: unionMinutes(b.all),
      count: perKeyIds.get(key)?.size ?? 0,
      systemMinutes: unionMinutes(b.system),
    }),
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
