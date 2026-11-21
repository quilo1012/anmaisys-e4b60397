/**
 * Machine time for a period: where each line's hours went, the way iTouching's
 * "OEE Machine by Period" lays them out.
 *
 *   Total time      the hours searched (every shift in the period, up to now)
 *   Planned down    stopped on a code iTouching has ticked Planned (breaks, line
 *                   preparation, cleaning, No Planned Shift…)
 *   Available       Total − Planned
 *   Run time        the machine running
 *   Unplanned down  stopped on any other code, or stopped with no code at all
 *   Availability    Run ÷ (Run + Unplanned) — Run ÷ Available whenever the log covers
 *                   the whole period
 *
 * Production Control already showed "8h51 running · 4h55 between runs", but that clock
 * is built from the start and finish typed on each production row. This one is the
 * machine's own: `intouch_status_log`, which the poll writes whenever a line changes
 * state or stop code. The two answer different questions and both stay.
 *
 * Planned or not is iTouching's decision, read from `intouch_stop_code_catalog.planned`
 * — the same flag the live board and the maintenance clock use. A code the catalogue
 * does not know ("Alarm", at the time of writing) counts as unplanned, as on the live
 * board: a stop nobody classified is not a stop anybody planned.
 *
 * The log is a list of changes, so a state holds until the next row for that line. A
 * line the log has not yet heard from in the period has no state at all: those minutes
 * are `noDataMin`, kept apart rather than guessed into run or stop.
 *
 * Measured against iTouching for Line 6, 16/11 06:00 → 20/11 06:00: Total 96h00 on
 * both; Run 65h00 here against 62h41; Planned 25h20 against 27h00; Unplanned 5h40
 * against 6h19. The poll reads every few minutes and a stop is coded after it starts,
 * so this sits a couple of percent on the running side of iTouching's own report.
 */

import { ITOUCH_STATUS_MEANING } from "@/lib/lineLiveStatus";
import { londonWallToUtc } from "@/lib/shifts";

/** The longest period the panel reads. 31 days of every line is ~27,000 log rows. */
export const MAX_MACHINE_TIME_DAYS = 31;

/**
 * How far back to look for the state each line was in when the period opened. The log
 * only writes changes, and a line can sit on "No Planned Shift" from Friday night to
 * Tuesday morning after a bank holiday.
 */
export const MACHINE_TIME_LOOKBACK_MS = 4 * 24 * 3_600_000;

export interface MachineLogRow {
  line: string | null;
  status: number | null;
  stop_label: string | null;
  changed_at: string;
}

export interface StopCodeRow {
  name: string;
  planned: boolean | null;
}

export interface TimeWindow {
  startMs: number;
  endMs: number;
}

export type MachineState = "run" | "planned" | "unplanned";

export interface StopMinutes {
  label: string;
  planned: boolean;
  minutes: number;
}

export interface LineMachineTime {
  line: string;
  totalMin: number;
  plannedMin: number;
  /** Total − Planned. */
  availableMin: number;
  runMin: number;
  unplannedMin: number;
  /** Minutes of the period before the log had a state for this line. */
  noDataMin: number;
  /** Run ÷ (Run + Unplanned), 0–100. Null when the line had no available time logged. */
  availabilityPct: number | null;
  /** Stopped minutes by code, biggest first. A stop with no code is "No reason given". */
  stops: StopMinutes[];
}

export const NO_REASON = "No reason given";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDate(iso: string): [number, number, number] | null {
  const m = ISO_DATE.exec(iso);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  return [y, mo, d];
}

/** Calendar days from `from` to `to`, both included. 0 when either is not a date or `to` is before `from`. */
export function periodDays(from: string, to: string): number {
  const a = parseDate(from);
  const b = parseDate(to);
  if (!a || !b) return 0;
  const days = Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86_400_000) + 1;
  return days > 0 ? days : 0;
}

/**
 * The stretches of clock a period and shift filter cover, as Production Control reads
 * them: a session dated D is DAY 06:00–18:00 on D and NIGHT 18:00 on D to 06:00 on D+1,
 * London wall clock (so a night across a clock change is 11 or 13 hours). "All shifts"
 * is 06:00 on D to 06:00 on D+1. Touching windows are joined.
 */
export function machineTimeWindows(from: string, to: string, shift: string): TimeWindow[] {
  const start = parseDate(from);
  const days = periodDays(from, to);
  if (!start || days === 0) return [];
  const out: TimeWindow[] = [];
  for (let n = 0; n < days; n++) {
    const day = new Date(Date.UTC(start[0], start[1] - 1, start[2] + n));
    const next = new Date(Date.UTC(start[0], start[1] - 1, start[2] + n + 1));
    const [y, mo, d] = [day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate()];
    const at6 = londonWallToUtc(y, mo, d, 6);
    const at18 = londonWallToUtc(y, mo, d, 18);
    const next6 = londonWallToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 6);
    const w = shift === "DAY" ? { startMs: at6, endMs: at18 }
      : shift === "NIGHT" ? { startMs: at18, endMs: next6 }
      : { startMs: at6, endMs: next6 };
    const last = out[out.length - 1];
    if (last && last.endMs === w.startMs) last.endMs = w.endMs;
    else out.push(w);
  }
  return out;
}

/** Stop code name → planned, matched as the live board matches it: trimmed, any case. */
export function plannedLookup(codes: readonly StopCodeRow[]): Map<string, boolean> {
  const m = new Map<string, boolean>();
  for (const c of codes) {
    const key = (c.name ?? "").trim().toLowerCase();
    if (key) m.set(key, c.planned === true);
  }
  return m;
}

/**
 * What one log row says the machine was doing.
 *
 * A code decides first: status 1 arrives WITH codes such as Breaks, Waiting and No
 * Planned Shift, so it is a stop whatever `ITOUCH_STATUS_MEANING` calls a bare 1.
 * Without a code, a running status (4, 6 and 8 in this installation) is running and
 * anything else (5, a 7 not yet coded) is a stop nobody has given a reason for.
 */
export function classifyMachineState(
  status: number | null,
  stopLabel: string | null,
  planned: ReadonlyMap<string, boolean>,
): MachineState {
  const label = (stopLabel ?? "").trim();
  if (label) return planned.get(label.toLowerCase()) === true ? "planned" : "unplanned";
  if (status != null && ITOUCH_STATUS_MEANING.get(status) === "RUNNING") return "run";
  return "unplanned";
}

function overlapMs(a0: number, a1: number, windows: readonly TimeWindow[]): number {
  let sum = 0;
  for (const w of windows) {
    const lo = Math.max(a0, w.startMs);
    const hi = Math.min(a1, w.endMs);
    if (hi > lo) sum += hi - lo;
  }
  return sum;
}

function emptyLine(line: string, totalMin: number): LineMachineTime {
  return { line, totalMin, plannedMin: 0, availableMin: totalMin, runMin: 0, unplannedMin: 0, noDataMin: totalMin, availabilityPct: null, stops: [] };
}

/**
 * Machine time per line over the windows, up to `nowMs`.
 *
 * `rows` must include, for each line, the last change before the first window opens
 * (see {@link MACHINE_TIME_LOOKBACK_MS}); rows from any line may be mixed. A line with
 * no state anywhere in the windows is left out.
 */
export function machineTimeByLine(
  rows: readonly MachineLogRow[],
  windows: readonly TimeWindow[],
  planned: ReadonlyMap<string, boolean>,
  nowMs: number,
): LineMachineTime[] {
  const clipped = windows
    .map((w) => ({ startMs: w.startMs, endMs: Math.min(w.endMs, nowMs) }))
    .filter((w) => w.endMs > w.startMs);
  if (!clipped.length) return [];
  const totalMs = clipped.reduce((s, w) => s + (w.endMs - w.startMs), 0);
  const lastEnd = clipped[clipped.length - 1].endMs;

  const byLine = new Map<string, { at: number; row: MachineLogRow; seq: number }[]>();
  rows.forEach((row, seq) => {
    const line = (row.line ?? "").trim();
    const at = Date.parse(row.changed_at);
    if (!line || Number.isNaN(at)) return;
    const list = byLine.get(line) ?? [];
    list.push({ at, row, seq });
    byLine.set(line, list);
  });

  const out: LineMachineTime[] = [];
  for (const [line, list] of byLine) {
    // Same instant: the order the database gave them, which is by id.
    list.sort((a, b) => a.at - b.at || a.seq - b.seq);
    const ms = { run: 0, planned: 0, unplanned: 0 };
    const stops = new Map<string, StopMinutes>();
    list.forEach(({ at, row }, i) => {
      const until = i + 1 < list.length ? list[i + 1].at : lastEnd;
      if (until <= at) return;
      const inside = overlapMs(at, until, clipped);
      if (inside <= 0) return;
      const state = classifyMachineState(row.status, row.stop_label, planned);
      ms[state] += inside;
      if (state === "run") return;
      const label = (row.stop_label ?? "").trim() || NO_REASON;
      const key = label.toLowerCase();
      const s = stops.get(key) ?? { label, planned: state === "planned", minutes: 0 };
      s.minutes += inside / 60_000;
      stops.set(key, s);
    });
    const known = ms.run + ms.planned + ms.unplanned;
    if (known <= 0) continue;
    const totalMin = totalMs / 60_000;
    const plannedMin = ms.planned / 60_000;
    const runMin = ms.run / 60_000;
    const unplannedMin = ms.unplanned / 60_000;
    out.push({
      line,
      totalMin,
      plannedMin,
      availableMin: totalMin - plannedMin,
      runMin,
      unplannedMin,
      noDataMin: Math.max(0, (totalMs - known) / 60_000),
      availabilityPct: runMin + unplannedMin > 0 ? (runMin / (runMin + unplannedMin)) * 100 : null,
      stops: [...stops.values()].sort((a, b) => b.minutes - a.minutes),
    });
  }
  return out;
}

/** The lines added up, as iTouching's Total row: hours summed across machines. */
export function machineTimeTotal(lines: readonly LineMachineTime[]): LineMachineTime {
  const t = emptyLine("Total", 0);
  t.noDataMin = 0;
  const stops = new Map<string, StopMinutes>();
  for (const l of lines) {
    t.totalMin += l.totalMin;
    t.plannedMin += l.plannedMin;
    t.availableMin += l.availableMin;
    t.runMin += l.runMin;
    t.unplannedMin += l.unplannedMin;
    t.noDataMin += l.noDataMin;
    for (const s of l.stops) {
      const key = s.label.toLowerCase();
      const acc = stops.get(key) ?? { label: s.label, planned: s.planned, minutes: 0 };
      acc.minutes += s.minutes;
      stops.set(key, acc);
    }
  }
  t.availabilityPct = t.runMin + t.unplannedMin > 0 ? (t.runMin / (t.runMin + t.unplannedMin)) * 100 : null;
  t.stops = [...stops.values()].sort((a, b) => b.minutes - a.minutes);
  return t;
}

/** Hours as the period report writes them: 96:00, 62:41, 0:05. */
export function formatHours(min: number | null | undefined): string {
  if (min == null || !Number.isFinite(min)) return "—";
  const whole = Math.round(Math.max(0, min));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
