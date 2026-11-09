/**
 * What happened on one line in one shift, for the Smart Target report (decided 06/11, Q67a):
 * what was expected, what was made, where the twelve hours went, and why it missed.
 *
 * When the line ran comes from the machine, not from the times typed on a production row. On
 * 06/11 Line 1's first typed start was 08:48 while its machine first ran at 06:20, and Line 4
 * logged a whole shift's 7,811 against 15:35 to 17:30.
 */

import { ENGINE_VERSION } from "@/lib/smartTargetEngine";

/** iTouch's running states: the count moves with the pace (see the status legend). */
export const RUNNING_STATUSES = [4, 8];
/**
 * Silence this long means the log was off, not that the factory was quiet. Over the 21 days to
 * 06/11 the longest quiet stretches inside working shifts were about 40 minutes; every gap over
 * 60 was the log being off or the site being shut.
 */
const LOG_SILENT_MINUTES = 45;

export interface StatusRow {
  line: string | null;
  status: number | null;
  changed_at: string;
}

export interface DowntimeRow {
  line: string | null;
  shift: string | null;
  reason: string | null;
  category: string | null;
  duration_minutes: number | null;
}

export interface LogGap {
  from: string;
  to: string;
}

export interface MachineClock {
  firstRun: string | null;
  lastRun: string | null;
  runningMinutes: number;
  /** Minutes of the shift the log was alive for. */
  coveredMinutes: number;
  /** When the log was silent during the shift. What the machines did then is not known. */
  gaps: LogGap[];
}

/** A clock in the factory's time. */
export const londonTime = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" }) : "—";

/**
 * The stretches of [startMs, untilMs] the log was silent for. Rows from every line count as
 * proof of life, since one line can hold a state for an hour.
 */
function silences(rows: StatusRow[], startMs: number, untilMs: number, nowMs: number): [number, number][] {
  const heard = rows.map((r) => Date.parse(r.changed_at)).sort((a, b) => a - b);
  const out: [number, number][] = [];
  heard.forEach((at, i) => {
    const next = i + 1 < heard.length ? heard[i + 1] : nowMs;
    if (next - at <= LOG_SILENT_MINUTES * 60_000) return;
    const from = Math.max(at, startMs);
    const to = Math.min(next, untilMs);
    if (to > from) out.push([from, to]);
  });
  return out;
}

/** The running time of a line, from the log of status changes. Null with no change in the shift. */
export function machineClock(rows: StatusRow[], line: string, startMs: number, endMs: number, nowMs: number): MachineClock | null {
  const untilMs = Math.min(endMs, nowMs);
  const own = rows.filter((r) => r.line === line).sort((a, b) => Date.parse(a.changed_at) - Date.parse(b.changed_at));
  if (!own.some((r) => Date.parse(r.changed_at) >= startMs && Date.parse(r.changed_at) < endMs)) return null;
  const gaps = silences(rows, startMs, untilMs, nowMs);
  const silent = (from: number, to: number) =>
    gaps.reduce((sum, [a, b]) => sum + Math.max(0, Math.min(to, b) - Math.max(from, a)), 0);
  let running = 0;
  let first: number | null = null;
  let last: number | null = null;
  own.forEach((row, i) => {
    if (!RUNNING_STATUSES.includes(Number(row.status))) return;
    const from = Math.max(Date.parse(row.changed_at), startMs);
    const to = Math.min(i + 1 < own.length ? Date.parse(own[i + 1].changed_at) : untilMs, untilMs);
    if (to <= from) return;
    const alive = to - from - silent(from, to);
    if (alive <= 0) return;
    running += alive / 60_000;
    // A run the silence cuts short ends, or begins, where the log does.
    const cutStart = gaps.find(([a, b]) => a <= from && from < b)?.[1] ?? from;
    const cutEnd = gaps.find(([a, b]) => a < to && to <= b)?.[0] ?? to;
    first = first ?? cutStart;
    last = cutEnd;
  });
  return {
    firstRun: first === null ? null : new Date(first).toISOString(),
    lastRun: last === null ? null : new Date(last).toISOString(),
    runningMinutes: Math.round(running),
    coveredMinutes: Math.round((untilMs - startMs - silent(startMs, untilMs)) / 60_000),
    gaps: gaps.map(([from, to]) => ({ from: new Date(from).toISOString(), to: new Date(to).toISOString() })),
  };
}

/**
 * How often an open report reads again: every five minutes while the shift runs, and not at
 * all before or after it, when what it reads has no reason to move.
 */
export function reportRefreshMs(window: { startMs: number; endMs: number } | null, nowMs: number): number | false {
  return window && nowMs >= window.startMs && nowMs < window.endMs ? 5 * 60_000 : false;
}

/** Stops logged on a line and shift, biggest first, one row per reason. */
export function stopsByReason(rows: DowntimeRow[], line: string, shift: string): { reason: string; minutes: number }[] {
  const by = new Map<string, number>();
  for (const r of rows) {
    if (r.line !== line || String(r.shift).toUpperCase() !== shift) continue;
    const reason = (r.reason || r.category || "No reason given").trim();
    by.set(reason, (by.get(reason) ?? 0) + Math.max(0, Number(r.duration_minutes) || 0));
  }
  return [...by.entries()].map(([reason, minutes]) => ({ reason, minutes })).filter((s) => s.minutes > 0).sort((a, b) => b.minutes - a.minutes);
}

/**
 * The products the target is made of, with what each one adds to it. A job the shift does not
 * reach (queued in iTouch after the order that fills the shift, or left with no time) adds
 * nothing, so it is not part of what was expected. The same SKU twice is one product.
 * Forecasts saved before each job kept its number have no `expected` at all; those are listed
 * as they were saved, without quantities.
 */
export function plannedProducts(jobs: { sku?: string | null; expected?: number | null }[]): { sku: string; expected: number | null }[] {
  const withNumber = jobs.some((j) => typeof j.expected === "number");
  const out: { sku: string; expected: number | null }[] = [];
  for (const job of jobs) {
    const sku = job.sku ?? "—";
    if (!withNumber) {
      if (!out.some((p) => p.sku === sku)) out.push({ sku, expected: null });
      continue;
    }
    const qty = Number(job.expected) || 0;
    if (qty <= 0) continue;
    const seen = out.find((p) => p.sku === sku);
    if (seen) seen.expected = (seen.expected ?? 0) + qty;
    else out.push({ sku, expected: qty });
  }
  return out;
}

/**
 * The jobs the target is made of: the ones the shift reaches and that add containers to it.
 * Everything else iTouch has queued for the line after them is not part of the plan for this
 * shift. A reached job with no rate (no number yet) still counts, since it takes shift time.
 * When none qualifies (no target could be worked out), every job is returned so the line is not blank.
 */
export function jobsInTarget<J extends { expectedContainers: number | null; allocation: { setupEnd: number; end: number } | null }>(jobs: J[]): J[] {
  const kept = jobs.filter((j) =>
    j.expectedContainers !== null ? j.expectedContainers > 0 : !!j.allocation && j.allocation.end > j.allocation.setupEnd,
  );
  return kept.length ? kept : jobs;
}

export interface LineReportInput {
  line: number;
  target: number | null;
  targetSetAt: string | null;
  targetVersion: string | null;
  ragPlan: number | null;
  logged: number;
  miss: number | null;
  planned: { sku: string; expected: number | null }[];
  made: { sku: string; qty: number }[];
  offPlan: string[];
  stops: { reason: string; minutes: number }[];
  clock: MachineClock | null;
  grossMinutes: number;
  leader: string | null;
  comment: string | null;
}

export interface LineReport extends LineReportInput {
  stopMinutes: number;
  why: string[];
}

export function lineReport(input: LineReportInput): LineReport {
  const why: string[] = [];
  if (input.logged <= 0) why.push("Nothing logged.");
  else if (input.target !== null && input.miss !== null) {
    const gap = Math.abs(input.logged - input.target).toLocaleString();
    why.push(input.logged < input.target ? `Logged ${gap} under the target.` : input.logged > input.target ? `Logged ${gap} over the target.` : "Logged exactly the target.");
  }
  if (input.targetVersion && input.targetVersion !== ENGINE_VERSION) why.push("This target came from an older method, so it does not count in the measurement.");
  if (input.offPlan.length) why.push(`Ran products not in the plan: ${input.offPlan.join(", ")}.`);
  // Breaks are planned, so the stop worth naming is the biggest of the others.
  const biggest = input.stops.find((s) => !/^breaks?$/i.test(s.reason));
  if (biggest) why.push(`Biggest stop: ${biggest.reason}, ${biggest.minutes} min.`);
  if (input.clock) why.push(`The machine ran ${input.clock.runningMinutes} of the ${input.clock.coveredMinutes} minutes iTouch logged.`);
  return { ...input, stopMinutes: input.stops.reduce((sum, s) => sum + s.minutes, 0), why };
}
