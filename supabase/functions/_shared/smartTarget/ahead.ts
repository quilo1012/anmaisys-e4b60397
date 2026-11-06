/**
 * The shift's target, made before the shift starts (decided 05/11, Q32–Q40).
 *
 * The operator should find the target on the line tablet when the shift begins. The
 * plan Smart Target reads during a shift (production_items) only exists once the shift
 * is opened, so before the shift the plan comes from iTouch's queue instead: each
 * line's queued works orders, in iTouch's order, with what is left to make of each.
 *
 * The server run (smart-target-ahead) calls this twice before each shift, about 30 and
 * 10 minutes ahead (Q37). The first run saves the lines that have jobs. The last run also
 * saves "no jobs in iTouch" for each line that still has none, so a late import is
 * measured instead of guessed (Q36). The database keeps the first save per line, so the
 * second run never changes what the first one saved.
 *
 * The job filling when the queue is read is still filling until the shift starts. Its
 * quantity is reduced by the minutes left × the line's rate for it (Q38), and the job
 * says so. A job that would finish before the shift starts is dropped, and its SKU is
 * still what the line was last filling.
 */

import {
  ENGINE_VERSION,
  forecastShift,
  normaliseSku,
  parseLineNo,
  shiftWindow,
  type LineNo,
  type PlannedJob,
  type RateRecord,
  type ShiftForecast,
  type ShiftType,
} from "./engine.ts";
import { queuedProduct, type QueueRow } from "./queue.ts";
import { lineRates, LINE_RATES_CONFIG, withEstimates, type CleanCycle, type HistoryShift, type LineFactor } from "./rates.ts";

/** A run more than this before a shift starts does nothing. */
export const AHEAD_FIRST_TRY_MINUTES = 40;
/** A run this close to the start is the last one: lines still without jobs are saved as such. */
export const AHEAD_FINAL_MINUTES = 20;

/** Saved for a line whose iTouch queue was empty on the last run before the shift. */
export const NO_ITOUCH_JOBS = "no_itouch_jobs";

const LINES: LineNo[] = [1, 2, 3, 4, 5, 6];
const MS_PER_MIN = 60_000;

export interface AheadShift {
  date: string;
  shift: ShiftType;
  minutesToStart: number;
  final: boolean;
}

const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The shift starting within the next 40 minutes, or null when none does. */
export function aheadShift(now: Date): AheadShift | null {
  const t = now.getTime();
  // London's date is within a day of UTC's, so these two dates cover every next start.
  for (const date of [ymd(t - 86_400_000), ymd(t), ymd(t + 86_400_000)]) {
    for (const shift of ["DAY", "NIGHT"] as ShiftType[]) {
      const w = shiftWindow(date, shift);
      if (!w) continue;
      const minutesToStart = (w.startMs - t) / MS_PER_MIN;
      if (minutesToStart > 0 && minutesToStart <= AHEAD_FIRST_TRY_MINUTES) {
        return { date, shift, minutesToStart: Math.round(minutesToStart * 10) / 10, final: minutesToStart <= AHEAD_FINAL_MINUTES };
      }
    }
  }
  return null;
}

const ratePerMinute = (rates: RateRecord[], sku: string | null): number | null => {
  if (!sku) return null;
  const r = rates.find((x) => normaliseSku(x.sku) === sku);
  if (!r || !(r.value > 0)) return null;
  return r.unit === "containers/minute" ? r.value : r.unit === "containers/hour" ? r.value / 60 : null;
};

export interface QueuePlan {
  jobs: PlannedJob[];
  /** The SKU filling when the queue was read, or undefined when no job was running. */
  previousSku: string | undefined;
  notes: string[];
}

/**
 * One line's jobs from the queue: running job first, then iTouch's order. Each job's
 * order quantity is what was left (order − made). Consecutive rows of the same SKU are
 * one run, as in buildShiftInputs().
 */
export function planFromQueue(line: LineNo, queue: QueueRow[], minutesToStart: number, rates: RateRecord[]): QueuePlan {
  const rows = queue
    .filter((q) => parseLineNo(q.line) === line)
    .sort((a, b) => {
      const ra = a.status === "Running" ? 0 : 1;
      const rb = b.status === "Running" ? 0 : 1;
      return ra !== rb ? ra - rb : a.seq - b.seq;
    });
  const notes: string[] = [];
  const left = (q: QueueRow) =>
    q.order_qty === null || q.order_qty <= 0 ? null : q.order_qty - Math.max(0, q.done_qty ?? 0);

  let previousSku: string | undefined;
  const plan: { sku: string | null; qty: number | null; id: string }[] = [];
  rows.forEach((q, i) => {
    const sku = queuedProduct(q.sku);
    let qty = left(q);
    if (i === 0 && q.status === "Running") {
      previousSku = sku ?? undefined;
      const perMin = ratePerMinute(rates, sku);
      if (qty !== null && perMin !== null) {
        const still = Math.round(perMin * minutesToStart);
        qty -= still;
        notes.push(
          qty > 0
            ? `${q.sku} was filling when iTouch was read: about ${still} more are expected before the shift starts, so ${qty} are left for this shift (estimated left at the start).`
            : `${q.sku} was filling when iTouch was read and should finish before the shift starts.`,
        );
      } else if (qty !== null) {
        notes.push(`${q.sku} was filling when iTouch was read; with no rate for it, what it makes before the shift starts is not taken off.`);
      }
    }
    // An order already made gives this shift nothing to make.
    if (qty !== null && qty <= 0) return;
    plan.push({ sku, qty, id: `${line}-${q.seq}-${sku ?? "unknown"}` });
  });

  const jobs: PlannedJob[] = [];
  for (const p of plan) {
    const last = jobs[jobs.length - 1];
    if (last && p.sku !== null && last.sku === p.sku) {
      last.orderQty = last.orderQty !== null && last.orderQty !== undefined && p.qty !== null ? last.orderQty + p.qty : null;
      continue;
    }
    jobs.push({ jobId: p.id, sku: p.sku, sequence: jobs.length + 1, orderQty: p.qty });
  }
  return { jobs, previousSku, notes };
}

/** One row for save: the same fields the page saves, plus where it came from. */
export interface AheadRow {
  line: LineNo;
  shown: boolean;
  expected_total: number | null;
  expected_per_hour: number | null;
  status: string;
  confidence: string;
  factor: number | null;
  factor_shifts: number | null;
  jobs: { sku: string | null | undefined; order: number | null | undefined; expected: number | null; basis: string | null }[];
  engine_version: string;
  notes: string[];
}

export interface AheadInput {
  date: string;
  shift: ShiftType;
  minutesToStart: number;
  final: boolean;
  queue: QueueRow[];
  /** Cleaned iTouch cycles; empty means no rates at all. */
  cycles: CleanCycle[];
  factors: LineFactor[];
  /** The eight weeks the factor read, for the rates observed on each line (Q43a). */
  history: HistoryShift[];
  /** The last product logged on the shift before, per line, for a queue with nothing running. */
  previousSkus?: Partial<Record<LineNo, string | undefined>>;
  /** Lines whose number reaches the tablet. */
  shownLines: readonly LineNo[];
}

/**
 * Every line's forecast from the queue. Lines with no queued jobs are left out, except
 * on the last run, where they are saved as NO_ITOUCH_JOBS. Lines not shown are forecast
 * too, with `shown` false, as the page does (Q27).
 */
export function forecastAhead(input: AheadInput): { rows: AheadRow[]; forecasts: Map<LineNo, ShiftForecast> } {
  const rows: AheadRow[] = [];
  const forecasts = new Map<LineNo, ShiftForecast>();
  for (const line of LINES) {
    const factor = input.factors.find((f) => f.line === line) ?? null;
    const rates = lineRates(line, input.cycles, factor, input.history);
    const plan = planFromQueue(line, input.queue, input.minutesToStart, rates);
    const shown = input.shownLines.includes(line);
    if (!plan.jobs.length) {
      if (input.final) {
        rows.push({
          line, shown, expected_total: null, expected_per_hour: null, status: NO_ITOUCH_JOBS, confidence: "none",
          factor: factor?.factor ?? null, factor_shifts: factor?.shiftsUsed ?? null,
          jobs: [], engine_version: ENGINE_VERSION,
          notes: [`No jobs in iTouch's queue for Line ${line} ${Math.round(input.minutesToStart)} minutes before the shift.`],
        });
      }
      continue;
    }
    const result = forecastShift({
      date: input.date,
      shift: input.shift,
      line,
      jobs: plan.jobs,
      previousSku: plan.previousSku ?? input.previousSkus?.[line],
      breaks: null,
      downtime: [],
      rates: withEstimates(line, plan.jobs.map((j) => j.sku), rates),
      events: [],
      eventSemantics: null,
    }, LINE_RATES_CONFIG);
    forecasts.set(line, result);
    rows.push({
      line,
      shown,
      expected_total: result.expectedTotal,
      expected_per_hour: result.expectedPerHour,
      status: result.status,
      confidence: result.confidence,
      factor: factor?.factor ?? null,
      factor_shifts: factor?.shiftsUsed ?? null,
      jobs: result.jobs.map((j) => ({ sku: j.sku, order: j.orderQty, expected: j.expectedContainers, basis: j.allocation?.basis ?? null })),
      engine_version: ENGINE_VERSION,
      notes: plan.notes,
    });
  }
  return { rows, forecasts };
}

/** Logged products the frozen plan did not have, in the order they were logged. */
export function productsOffPlan(target: { jobs: { sku: string | null | undefined }[] }, loggedCodes: string[]): string[] {
  const planned = new Set(target.jobs.map((j) => normaliseSku(j.sku)).filter(Boolean));
  const out: string[] = [];
  for (const code of loggedCodes) {
    const key = normaliseSku(code);
    if (key && !planned.has(key) && !out.includes(code)) out.push(code);
  }
  return out;
}
