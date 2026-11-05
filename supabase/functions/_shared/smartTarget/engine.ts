/**
 * Smart AI Target, v1 calculation engine: how many containers a line can be
 * expected to fill in one shift, and how that compares with what it filled.
 *
 * This file is arithmetic only. It reads nothing and writes nothing: no Supabase,
 * no fetch, no clock (`Date.now`) and no randomness. Every input arrives as an
 * argument, so the same input always gives the same output. Reading iTouch, the
 * schedule and the rate history is the caller's job, and none of that exists yet.
 *
 * The rule it follows is the one the factory already uses for headcount and stop
 * reasons: blank is never zero. When the data cannot support a number, the result
 * says so (`null` plus a warning) instead of filling in a duration, a rate or a
 * count that nobody measured.
 *
 * How a shift is built:
 *
 * 1. Window. DAY is 06:00–18:00 and NIGHT is 18:00–06:00 the next morning, both
 *    Europe/London. The gross length is the real elapsed time, so the nights the
 *    clocks change are 780 or 660 minutes, not 720. That case raises a warning
 *    rather than being hidden.
 * 2. Blocked time: positioned breaks plus known downtime, merged into one set of
 *    intervals so an overlap is subtracted once. If the break times are not known,
 *    the 75-minute allowance is spread evenly across the shift instead, and any
 *    overlap with mixing cannot be credited.
 * 3. Jobs in iTouch sequence order. At each SKU change the job pays the
 *    changeover first (brush the blender, blow it with air, change the iTouch
 *    code) and then mixing. The two run one after the other because the blender
 *    cannot mix while it is being brushed. A repeated SKU pays neither.
 * 4. Each job's time comes from its planned window in the schedule, or else from
 *    order quantity ÷ rate. Order quantity is used only to size the slot. It is
 *    never treated as what was produced.
 * 5. Expected containers = rate × productive minutes, per job. The shift total
 *    exists only when every job has one.
 *
 * Filling events are counted only if the caller says their meaning has been
 * verified: one event = one completed container, with known accepted and rejected
 * statuses. Until then the engine reports how many candidate events there were and
 * leaves the actual count empty.
 */

import { londonWallToUtc } from "../production/shifts.ts";

export const ENGINE_VERSION = "smart-target-engine/1.0";

export type ShiftType = "DAY" | "NIGHT";
export type LineNo = 1 | 2 | 3 | 4 | 5 | 6;

const MS_PER_MIN = 60_000;
/** 12 hours. Only the nights the clocks change differ, and they are flagged. */
export const NOMINAL_SHIFT_MINUTES = 720;

export interface EngineConfig {
  /** Break allowance per shift. 75 gives 645 net minutes on a 720-minute shift. */
  breakMinutes: number;
  /** Per SKU change. An estimate (20–30 min reported), not a measured event. */
  changeoverMinutes: number;
  /** Provisional defaults: lines 1–4 30 min, lines 5–6 40 min. A job may override. */
  mixingMinutes: Record<LineNo, number>;
  /**
   * When the filler waits for the blender. "sku_start": the first job of each SKU
   * (including the first job of the shift when what ran before is not the same SKU).
   * "every_job": before every job. Not confirmed with Production.
   */
  mixingAt: "sku_start" | "every_job";
  /** Whether the blender can mix while the line is on break. */
  mixingMayOverlapBreak: boolean;
  /** Below this many history shifts, a rate is treated as too thin to use. */
  minHistoryShifts: number;
}

export const DEFAULT_CONFIG: EngineConfig = {
  breakMinutes: 75,
  changeoverMinutes: 25,
  mixingMinutes: { 1: 30, 2: 30, 3: 30, 4: 30, 5: 40, 6: 40 },
  mixingAt: "sku_start",
  mixingMayOverlapBreak: false,
  minHistoryShifts: 5,
};

// ── Inputs ────────────────────────────────────────────────────────────────

/** One job from the iTouch schedule, in the order iTouch will run it. */
export interface PlannedJob {
  jobId: string;
  sku: string | null | undefined;
  sequence: number;
  /** From the schedule. Both must be present for the window to be used. */
  plannedStart?: string | null;
  plannedEnd?: string | null;
  /** The planning reference only. Never treated as what was produced. */
  orderQty?: number | null;
  /** A SKU-specific value, where Production has given one. */
  mixingMinutes?: number | null;
  changeoverMinutes?: number | null;
}

export interface RateRecord {
  line: unknown;
  sku: string;
  value: number;
  /** Must be containers per hour or per minute; anything else is refused. */
  unit: string;
  status: "validated" | "provisional";
  sampleShifts: number;
  /** Where the number came from, carried into the output. */
  source: string;
}

export interface TimedWindow {
  start: string;
  end: string;
  reason?: string;
}

/** One filler-scale event, as received. Nothing about it is trusted yet. */
export interface FillEvent {
  eventId?: string | null;
  line: unknown;
  timestamp?: string | null;
  status?: string | null;
  jobId?: string | null;
  sku?: string | null;
}

/**
 * What the events mean. Until someone has checked the iTouch API, `verified` is
 * false and no event counts as a container.
 */
export interface FillEventSemantics {
  verified: boolean;
  acceptedStatuses: string[];
  rejectedStatuses: string[];
  /** Who verified it, against what, and when. */
  note: string;
}

export interface ShiftForecastInput {
  date: string;
  shift: ShiftType;
  line: unknown;
  jobs: PlannedJob[];
  /**
   * The SKU on the line when the shift starts. A string means that SKU was running.
   * null means the line was empty. undefined means nobody knows, so no changeover
   * is charged and a warning says so.
   */
  previousSku?: string | null;
  /** Positioned breaks. null or absent: the allowance is spread across the shift. */
  breaks?: TimedWindow[] | null;
  downtime?: TimedWindow[] | null;
  rates: RateRecord[];
  events?: FillEvent[] | null;
  eventSemantics?: FillEventSemantics | null;
}

// ── Outputs ───────────────────────────────────────────────────────────────

export interface Interval {
  start: number;
  end: number;
}

export interface EngineWarning {
  code: string;
  message: string;
  jobId?: string;
}

/** `sku_unknown`: this job, or the one before it, has no SKU, so whether the product changed is not known. */
export type Transition = "first_unknown" | "first_empty" | "sku_change" | "same_sku" | "sku_unknown";
export type RateStatus = "validated" | "provisional" | "insufficient_history" | "missing" | "conflict";

export interface JobForecast {
  jobId: string;
  sequence: number;
  sku: string | null;
  transition: Transition;
  changeoverMinutes: number;
  mixingMinutes: number;
  /** Minutes from shift start. null when the job's time could not be worked out. */
  allocation: {
    start: number;
    end: number;
    setupEnd: number;
    productiveMinutes: number;
    basis: "planned_window" | "order_qty_at_rate" | "runs_to_shift_end";
    /**
     * Order-sized jobs only: at the line's rate the order finishes inside the slot.
     * The forecast is then the order, and the screen says so (decided 05/11, Q23).
     */
    completesOrder: boolean;
  } | null;
  rateStatus: RateStatus;
  rate: { perHour: number; sampleShifts: number; source: string } | null;
  expectedContainers: number | null;
  expectedPerHour: number | null;
  orderQty: number | null;
  actualContainers: number | null;
  candidateEvents: number;
  observedPerHour: number | null;
  difference: number | null;
  reasons: string[];
}

export interface EventSummary {
  received: number;
  valid: number;
  duplicate: number;
  rejected: number;
  ambiguous: number;
  incomplete: number;
  outsideShift: number;
  wrongLine: number;
  unassociated: number;
  semanticsVerified: boolean;
}

export interface ShiftForecast {
  engineVersion: string;
  status: "ok" | "partial" | "insufficient_data" | "invalid_input";
  date: string;
  shift: ShiftType;
  line: LineNo | null;
  window: { start: string; end: string; grossMinutes: number; netMinutes: number } | null;
  jobs: JobForecast[];
  expectedTotal: number | null;
  /** The sum of the jobs that have a forecast. Not a shift total unless coverage is full. */
  expectedKnownSubtotal: number;
  jobCoverage: { forecast: number; total: number };
  expectedPerHour: number | null;
  actualTotal: number | null;
  difference: number | null;
  events: EventSummary;
  assumptions: string[];
  warnings: EngineWarning[];
  confidence: "medium" | "low" | "none";
}

// ── Small pure helpers ────────────────────────────────────────────────────

/** "Line 3", "L3", "3", "Filler Line 3" or 3 → 3. Anything outside 1–6 → null. */
export function parseLineNo(raw: unknown): LineNo | null {
  if (typeof raw === "number") {
    return Number.isInteger(raw) && raw >= 1 && raw <= 6 ? (raw as LineNo) : null;
  }
  if (typeof raw !== "string") return null;
  const m = /^(?:filler\s*)?(?:line\s*|l\s*)?([1-6])$/i.exec(raw.trim());
  return m ? (Number(m[1]) as LineNo) : null;
}

/** The same cleaning the iTouch parsers use: no quotes, no "-B12" batch suffix, upper case. */
export function normaliseSku(raw: string | null | undefined): string | null {
  const code = String(raw ?? "").trim().replace(/^['"]+|['"]+$/g, "").replace(/-B\d+$/i, "").toUpperCase();
  return code ? code : null;
}

export function shiftWindow(
  date: string,
  shift: ShiftType,
): { startMs: number; endMs: number; grossMinutes: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? "");
  if (!m || (shift !== "DAY" && shift !== "NIGHT")) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;

  let startMs: number;
  let endMs: number;
  if (shift === "DAY") {
    startMs = londonWallToUtc(y, mo, d, 6);
    endMs = londonWallToUtc(y, mo, d, 18);
  } else {
    const next = new Date(Date.UTC(y, mo - 1, d + 1));
    startMs = londonWallToUtc(y, mo, d, 18);
    endMs = londonWallToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 6);
  }
  return { startMs, endMs, grossMinutes: (endMs - startMs) / MS_PER_MIN };
}

/** Sorted, non-overlapping. Touching intervals join, so nothing is counted twice. */
export function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = list
    .filter((i) => Number.isFinite(i.start) && Number.isFinite(i.end) && i.end > i.start)
    .map((i) => ({ start: i.start, end: i.end }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push(i);
  }
  return out;
}

export function totalMinutes(list: Interval[]): number {
  return mergeIntervals(list).reduce((sum, i) => sum + (i.end - i.start), 0);
}

/** The minutes of [from, to] not covered by `blocks`. */
export function freeMinutes(from: number, to: number, blocks: Interval[]): number {
  if (to <= from) return 0;
  const covered = mergeIntervals(blocks)
    .map((b) => ({ start: Math.max(b.start, from), end: Math.min(b.end, to) }))
    .filter((b) => b.end > b.start);
  return to - from - totalMinutes(covered);
}

/**
 * Walk forward from `from`, taking `minutes` of time that is not in `avoid`, and
 * never past `limit`. This is how a setup or a run is placed around a break: it
 * waits for the break instead of overlapping it.
 */
export function consumeFreeTime(
  from: number,
  minutes: number,
  avoid: Interval[],
  limit: number,
): { taken: Interval[]; end: number; shortfall: number } {
  const blocks = mergeIntervals(avoid);
  const taken: Interval[] = [];
  let cursor = from;
  let need = minutes;
  while (need > 1e-9 && cursor < limit) {
    const inside = blocks.find((b) => b.start <= cursor && cursor < b.end);
    if (inside) {
      cursor = inside.end;
      continue;
    }
    const next = blocks.find((b) => b.start > cursor);
    const freeEnd = Math.min(limit, next ? next.start : limit);
    const take = Math.min(need, freeEnd - cursor);
    taken.push({ start: cursor, end: cursor + take });
    cursor += take;
    need -= take;
  }
  return { taken, end: Math.min(cursor, limit), shortfall: Math.max(0, need) };
}

function perHourFromUnit(value: number, unit: string): number | null {
  const u = unit.trim().toLowerCase().replace(/\s+/g, "").replace(/_per_|per/g, "/");
  if (["containers/hour", "containers/hr", "containers/h", "cph"].includes(u)) return value;
  if (["containers/minute", "containers/min", "cpm"].includes(u)) return value * 60;
  return null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

// ── Rates ─────────────────────────────────────────────────────────────────

interface CleanRate {
  line: LineNo;
  sku: string;
  perHour: number;
  status: "validated" | "provisional";
  sampleShifts: number;
  source: string;
}

function cleanRates(rates: RateRecord[], warnings: EngineWarning[]): CleanRate[] {
  const out: CleanRate[] = [];
  for (const r of rates ?? []) {
    const line = parseLineNo(r.line);
    const sku = normaliseSku(r.sku);
    const where = `${String(r.line)} / ${String(r.sku)} (${r.source})`;
    if (line === null) {
      warnings.push({ code: "RATE_BAD_LINE", message: `Rate ignored: line "${String(r.line)}" is not Line 1–6 — ${where}` });
      continue;
    }
    if (!sku) {
      warnings.push({ code: "RATE_BAD_SKU", message: `Rate ignored: no SKU — ${where}` });
      continue;
    }
    if (!Number.isFinite(r.value) || r.value <= 0) {
      warnings.push({ code: "RATE_BAD_VALUE", message: `Rate ignored: ${String(r.value)} is not a positive rate — ${where}` });
      continue;
    }
    const perHour = perHourFromUnit(r.value, String(r.unit ?? ""));
    if (perHour === null) {
      warnings.push({ code: "RATE_BAD_UNIT", message: `Rate ignored: unit "${String(r.unit)}" is not containers per hour or minute — ${where}` });
      continue;
    }
    out.push({ line, sku, perHour, status: r.status, sampleShifts: Math.max(0, Math.floor(r.sampleShifts ?? 0)), source: r.source });
  }
  return out;
}

function resolveRate(
  rates: CleanRate[],
  line: LineNo,
  sku: string,
  cfg: EngineConfig,
): { status: RateStatus; rate: CleanRate | null } {
  const matches = rates.filter((r) => r.line === line && r.sku === sku);
  if (!matches.length) return { status: "missing", rate: null };
  const enough = (r: CleanRate) => r.sampleShifts >= cfg.minHistoryShifts;
  for (const status of ["validated", "provisional"] as const) {
    const group = matches.filter((r) => r.status === status && enough(r));
    if (!group.length) continue;
    const values = new Set(group.map((r) => r.perHour));
    if (values.size > 1) return { status: "conflict", rate: null };
    return { status, rate: group[0] };
  }
  return { status: "insufficient_history", rate: null };
}

// ── The forecast ──────────────────────────────────────────────────────────

const emptyEvents = (verified: boolean): EventSummary => ({
  received: 0, valid: 0, duplicate: 0, rejected: 0, ambiguous: 0,
  incomplete: 0, outsideShift: 0, wrongLine: 0, unassociated: 0, semanticsVerified: verified,
});

export function forecastShift(input: ShiftForecastInput, config: Partial<EngineConfig> = {}): ShiftForecast {
  const cfg: EngineConfig = { ...DEFAULT_CONFIG, ...config, mixingMinutes: { ...DEFAULT_CONFIG.mixingMinutes, ...config.mixingMinutes } };
  const warnings: EngineWarning[] = [];
  const assumptions: string[] = [];
  const line = parseLineNo(input.line);
  const win = shiftWindow(input.date, input.shift);
  const verified = input.eventSemantics?.verified === true;

  const base: ShiftForecast = {
    engineVersion: ENGINE_VERSION,
    status: "invalid_input",
    date: input.date,
    shift: input.shift,
    line,
    window: null,
    jobs: [],
    expectedTotal: null,
    expectedKnownSubtotal: 0,
    jobCoverage: { forecast: 0, total: input.jobs?.length ?? 0 },
    expectedPerHour: null,
    actualTotal: null,
    difference: null,
    events: emptyEvents(verified),
    assumptions,
    warnings,
    confidence: "none",
  };

  if (line === null) warnings.push({ code: "BAD_LINE", message: `Line "${String(input.line)}" is not Line 1–6.` });
  if (!win) warnings.push({ code: "BAD_SHIFT", message: `"${input.date}" ${input.shift} is not a valid shift date and type.` });
  if (line === null || !win) return base;

  const G = win.grossMinutes;
  const toMin = (iso: string | null | undefined): number | null => {
    const t = Date.parse(iso ?? "");
    return Number.isFinite(t) ? (t - win.startMs) / MS_PER_MIN : null;
  };
  const clipToShift = (w: TimedWindow, kind: string): Interval | null => {
    const s = toMin(w.start);
    const e = toMin(w.end);
    if (s === null || e === null || e <= s) {
      warnings.push({ code: `${kind}_BAD_TIME`, message: `${kind.toLowerCase()} window ignored: start/end missing or reversed (${w.start} → ${w.end}).` });
      return null;
    }
    const c = { start: Math.max(0, s), end: Math.min(G, e) };
    return c.end > c.start ? c : null;
  };

  if (G !== NOMINAL_SHIFT_MINUTES) {
    warnings.push({
      code: "GROSS_NOT_720",
      message: `This shift is ${G} minutes long, not 720 (the clocks change during it). Times use the real elapsed minutes.`,
    });
  }

  // Blocked time. Positioned breaks and downtime are merged, so a stop during a break is subtracted once.
  const positioned = Array.isArray(input.breaks);
  const breakIntervals = positioned
    ? mergeIntervals((input.breaks ?? []).map((b) => clipToShift(b, "BREAK")).filter((i): i is Interval => i !== null))
    : [];
  const downtimeIntervals = mergeIntervals(
    (input.downtime ?? []).map((d) => clipToShift(d, "DOWNTIME")).filter((i): i is Interval => i !== null),
  );
  const blocked = mergeIntervals([...breakIntervals, ...downtimeIntervals]);
  const breakTotal = positioned ? totalMinutes(breakIntervals) : cfg.breakMinutes;
  if (positioned && breakTotal !== cfg.breakMinutes) {
    warnings.push({
      code: "BREAK_TOTAL_MISMATCH",
      message: `The positioned breaks add up to ${breakTotal} min, not the ${cfg.breakMinutes} min allowance. The positioned times are used.`,
    });
  }
  const netMinutes = G - breakTotal;
  // Without break times, each job carries its share of the allowance by the length of
  // its slot, taken from its productive time. The share is never set against setup or
  // downtime, because an overlap that cannot be placed cannot be credited.
  const lumpShare = (start: number, end: number) => (positioned ? 0 : (cfg.breakMinutes * (end - start)) / G);
  const productiveOf = (start: number, setupEnd: number, end: number) =>
    Math.max(0, freeMinutes(setupEnd, end, blocked) - lumpShare(start, end));

  assumptions.push(
    positioned
      ? `Breaks: ${breakTotal} min at the times given.`
      : `Breaks: ${cfg.breakMinutes} min allowance, times unknown — spread evenly across the shift; overlap with mixing or changeover cannot be credited.`,
    `Mixing: ${cfg.mixingMinutes[line]} min on Line ${line} (provisional default), charged ${cfg.mixingAt === "sku_start" ? "at the first job of each SKU" : "before every job"}; ${cfg.mixingMayOverlapBreak ? "may" : "may not"} overlap a break.`,
    `Changeover: ${cfg.changeoverMinutes} min per SKU change (estimate, not measured), followed by mixing, not overlapping it.`,
    `Rates with fewer than ${cfg.minHistoryShifts} history shifts are not used.`,
  );

  base.window = { start: new Date(win.startMs).toISOString(), end: new Date(win.endMs).toISOString(), grossMinutes: G, netMinutes };
  const rates = cleanRates(input.rates, warnings);

  // Jobs in iTouch order. Ties are broken by id, compared by code point rather than by
  // locale, so the order never depends on input order or on the machine running it.
  // A sequence that is not a number goes last instead of poisoning the sort.
  const seqKey = (j: PlannedJob) => (Number.isFinite(j.sequence) ? j.sequence : Number.POSITIVE_INFINITY);
  const jobs = [...(input.jobs ?? [])].sort((a, b) => {
    const sa = seqKey(a);
    const sb = seqKey(b);
    if (sa !== sb) return sa < sb ? -1 : 1;
    return a.jobId < b.jobId ? -1 : a.jobId > b.jobId ? 1 : 0;
  });
  if (jobs.some((j) => !Number.isFinite(j.sequence))) {
    warnings.push({ code: "BAD_SEQUENCE", message: "A job has no usable sequence number; it is placed last." });
  }
  for (let i = 1; i < jobs.length; i++) {
    if (jobs[i].sequence === jobs[i - 1].sequence) {
      warnings.push({ code: "DUPLICATE_SEQUENCE", message: `Jobs ${jobs[i - 1].jobId} and ${jobs[i].jobId} share sequence ${jobs[i].sequence}; ordered by job id.` });
    }
  }
  if (!jobs.length) {
    warnings.push({ code: "NO_JOBS", message: "No planned jobs for this line and shift." });
    base.status = "insufficient_data";
    return finishEvents(base, input, line, win, [], blocked, verified, warnings);
  }

  const out: JobForecast[] = [];
  let cursor: number | null = 0;
  let prevSku: string | null | undefined = input.previousSku === undefined ? undefined : normaliseSku(input.previousSku);
  const setupAvoidChangeover = blocked;
  const setupAvoidMixing = cfg.mixingMayOverlapBreak ? downtimeIntervals : blocked;

  const windowOf = (job: PlannedJob) => {
    const ws = toMin(job.plannedStart);
    const we = toMin(job.plannedEnd);
    return ws !== null && we !== null && we > ws ? { start: ws, end: we } : null;
  };

  for (const [index, job] of jobs.entries()) {
    const sku = normaliseSku(job.sku);
    const reasons: string[] = [];
    const first = out.length === 0;
    const transition: Transition =
      sku === null ? "sku_unknown"
        : first && prevSku === undefined ? "first_unknown"
          : first && prevSku === null ? "first_empty"
            : prevSku === undefined || prevSku === null ? "sku_unknown"
              : sku === prevSku ? "same_sku" : "sku_change";
    if (transition === "first_unknown") {
      warnings.push({ code: "PREVIOUS_SKU_UNKNOWN", jobId: job.jobId, message: "What ran before the shift is unknown, so no changeover is charged before the first job." });
    }
    if (transition === "sku_unknown") {
      warnings.push({ code: "TRANSITION_UNKNOWN", jobId: job.jobId, message: "This job or the one before it has no SKU, so no changeover or mixing is charged here." });
    }

    const changeover = transition === "sku_change" ? job.changeoverMinutes ?? cfg.changeoverMinutes : 0;
    const mixing =
      transition === "sku_unknown" ? 0
        : cfg.mixingAt === "every_job" || transition !== "same_sku" ? job.mixingMinutes ?? cfg.mixingMinutes[line] : 0;
    const resolved = sku ? resolveRate(rates, line, sku, cfg) : { status: "missing" as RateStatus, rate: null };
    if (!sku) reasons.push("The job has no SKU.");
    else if (resolved.status === "missing") reasons.push(`No rate for ${sku} on Line ${line}.`);
    else if (resolved.status === "insufficient_history") reasons.push(`Fewer than ${cfg.minHistoryShifts} history shifts for ${sku} on Line ${line}.`);
    else if (resolved.status === "conflict") reasons.push(`Rate records for ${sku} on Line ${line} disagree.`);

    // Where the job sits in the shift.
    const window = windowOf(job);
    if (!window && (job.plannedStart || job.plannedEnd)) {
      warnings.push({ code: "WINDOW_IGNORED", jobId: job.jobId, message: "The planned window is incomplete, unreadable or reversed, so it was not used." });
    }
    let allocation: JobForecast["allocation"] = null;
    let productive = 0;
    let completesOrder = false;

    const placeSetup = (from: number, limit: number) => {
      const co = consumeFreeTime(from, changeover, setupAvoidChangeover, limit);
      const mx = consumeFreeTime(co.end, mixing, setupAvoidMixing, limit);
      return { end: mx.end, intervals: [...co.taken, ...mx.taken], short: co.shortfall + mx.shortfall };
    };

    if (window) {
      let start = Math.max(0, window.start);
      const end = Math.min(G, window.end);
      if (cursor !== null && start < cursor) {
        warnings.push({ code: "WINDOW_OVERLAP", jobId: job.jobId, message: `Planned window starts before the previous job ends; moved to minute ${round1(cursor)}.` });
        start = cursor;
      }
      if (end <= start) {
        reasons.push("The planned window falls outside the shift.");
      } else {
        const setup = placeSetup(start, end);
        if (setup.short > 0) warnings.push({ code: "SETUP_EXCEEDS_WINDOW", jobId: job.jobId, message: "Changeover and mixing do not fit in the planned window." });
        productive = productiveOf(start, setup.end, end);
        allocation = { start, end, setupEnd: setup.end, productiveMinutes: round1(productive), basis: "planned_window", completesOrder: false };
      }
      cursor = allocation ? allocation.end : cursor;
    } else if (cursor !== null && resolved.rate && job.orderQty && job.orderQty > 0) {
      // The slot is sized from the order, so it may not run into the next job that
      // has a planned start.
      const nextWindow = jobs.slice(index + 1).map(windowOf).find((w) => w !== null);
      const limit = Math.min(G, nextWindow ? Math.max(cursor, nextWindow.start) : G);
      const setup = placeSetup(cursor, limit);
      const neededProductive = (job.orderQty / resolved.rate.perHour) * 60;
      // Wall time whose productive part, after its share of an unplaced break, is the
      // order. With positioned breaks the share is 0 and this is the order itself.
      const share = positioned ? 0 : cfg.breakMinutes / G;
      const neededWall = (neededProductive + share * (setup.end - cursor)) / (1 - share);
      const run = consumeFreeTime(setup.end, neededWall, blocked, limit);
      completesOrder = run.shortfall <= 1e-6;
      if (!completesOrder) {
        warnings.push(
          limit < G
            ? { code: "ORDER_RUNS_INTO_NEXT_JOB", jobId: job.jobId, message: "At this rate the order does not finish before the next job's planned start; the job is cut there." }
            : { code: "ORDER_RUNS_PAST_SHIFT", jobId: job.jobId, message: "At this rate the order does not finish in this shift; the job is cut at shift end." },
        );
      }
      productive = productiveOf(cursor, setup.end, run.end);
      allocation = { start: cursor, end: run.end, setupEnd: setup.end, productiveMinutes: round1(productive), basis: "order_qty_at_rate", completesOrder };
      warnings.push({ code: "DURATION_FROM_ORDER_QTY", jobId: job.jobId, message: "No planned window: the slot is sized from order quantity ÷ rate (provisional)." });
      if (completesOrder) {
        warnings.push({ code: "ORDER_COMPLETES", jobId: job.jobId, message: "At the line's rate the order completes in its slot, so the forecast for this job is the order." });
      }
      cursor = run.end;
    } else if (cursor !== null && resolved.rate && !(job.orderQty && job.orderQty > 0) && index === jobs.length - 1) {
      // The last job with no order quantity runs until the shift ends (decided 05/11,
      // Q26). Its forecast is the line's capacity for that product in the time left,
      // and it says so. Only the LAST job: an earlier job with no quantity has no end,
      // so everything after it stays unknown rather than guessed.
      const nextWindow = jobs.slice(index + 1).map(windowOf).find((w) => w !== null);
      const end = Math.min(G, nextWindow ? Math.max(cursor, nextWindow.start) : G);
      const setup = placeSetup(cursor, end);
      productive = productiveOf(cursor, setup.end, end);
      allocation = { start: cursor, end, setupEnd: setup.end, productiveMinutes: round1(productive), basis: "runs_to_shift_end", completesOrder: false };
      warnings.push({ code: "RUNS_TO_SHIFT_END", jobId: job.jobId, message: "No order quantity: the last job is taken to run until the shift ends, so its forecast is the line's capacity for it." });
      cursor = end;
    } else {
      reasons.push(
        cursor === null
          ? "An earlier job's time is unknown, so this job's start is unknown."
          : "No planned window, and no order quantity with a usable rate, so the job's time cannot be worked out.",
      );
      cursor = null;
    }

    // A job sized from its order that finishes it forecasts the order. That is not the
    // order standing in for a number: the line's rate is what decided the order fits,
    // and the planner's question is what this plan delivers in the time there is
    // (Q23, 05/11). A job the shift or the next planned start cuts short forecasts
    // rate × the time it actually has.
    const expected =
      allocation && resolved.rate
        ? completesOrder ? job.orderQty ?? null : Math.round((resolved.rate.perHour * productive) / 60)
        : null;
    out.push({
      jobId: job.jobId,
      sequence: job.sequence,
      sku,
      transition,
      changeoverMinutes: changeover,
      mixingMinutes: mixing,
      allocation,
      rateStatus: resolved.status,
      rate: resolved.rate ? { perHour: resolved.rate.perHour, sampleShifts: resolved.rate.sampleShifts, source: resolved.rate.source } : null,
      expectedContainers: expected,
      expectedPerHour: expected !== null ? resolved.rate!.perHour : null,
      orderQty: job.orderQty ?? null,
      actualContainers: null,
      candidateEvents: 0,
      observedPerHour: null,
      difference: null,
      reasons,
    });
    prevSku = sku === null ? undefined : sku;
  }

  const lastEnd = Math.max(0, ...out.map((j) => j.allocation?.end ?? 0));
  if (out.every((j) => j.allocation) && G - lastEnd > 1) {
    warnings.push({ code: "UNPLANNED_TIME", message: `${round1(G - lastEnd)} min at the end of the shift have no planned job and are not forecast.` });
  }

  const known = out.filter((j) => j.expectedContainers !== null);
  base.jobs = out;
  base.expectedKnownSubtotal = known.reduce((s, j) => s + (j.expectedContainers ?? 0), 0);
  base.jobCoverage = { forecast: known.length, total: out.length };
  base.expectedTotal = known.length === out.length ? base.expectedKnownSubtotal : null;
  base.expectedPerHour = base.expectedTotal !== null && netMinutes > 0 ? round1(base.expectedTotal / (netMinutes / 60)) : null;
  base.status = base.expectedTotal !== null ? "ok" : known.length ? "partial" : "insufficient_data";

  const lowSignals =
    !positioned ||
    out.some((j) => j.rateStatus === "provisional" || j.transition === "first_unknown" || j.transition === "sku_unknown" || j.allocation?.basis === "order_qty_at_rate" || j.allocation?.basis === "runs_to_shift_end");
  base.confidence = base.expectedTotal === null ? "none" : lowSignals ? "low" : "medium";

  return finishEvents(base, input, line, win, out, blocked, verified, warnings);
}

// ── Filling events ────────────────────────────────────────────────────────

function finishEvents(
  result: ShiftForecast,
  input: ShiftForecastInput,
  line: LineNo,
  win: { startMs: number; endMs: number },
  jobs: JobForecast[],
  blocked: Interval[],
  verified: boolean,
  warnings: EngineWarning[],
): ShiftForecast {
  const events = input.events ?? [];
  const summary = emptyEvents(verified);
  summary.received = events.length;
  if (!events.length) {
    result.events = summary;
    return result;
  }
  const sem = input.eventSemantics;
  const accepted = new Set((sem?.acceptedStatuses ?? []).map((s) => s.trim().toLowerCase()));
  const rejected = new Set((sem?.rejectedStatuses ?? []).map((s) => s.trim().toLowerCase()));

  // Sorted by time then id, so which copy of a duplicate wins never depends on input order.
  const ordered = events
    .map((e, i) => ({ e, i, ts: Date.parse(e.timestamp ?? "") }))
    .sort((a, b) => {
      const ta = Number.isFinite(a.ts) ? a.ts : Infinity;
      const tb = Number.isFinite(b.ts) ? b.ts : Infinity;
      const ia = String(a.e.eventId ?? "");
      const ib = String(b.e.eventId ?? "");
      return ta - tb || (ia < ib ? -1 : ia > ib ? 1 : 0) || a.i - b.i;
    });

  const seen = new Set<string>();
  const perJob = new Map<number, number[]>();
  let shiftCount = 0;
  for (const { e, ts } of ordered) {
    if (!e.timestamp || !Number.isFinite(ts)) { summary.incomplete++; continue; }
    if (parseLineNo(e.line) !== line) { summary.wrongLine++; continue; }
    if (ts < win.startMs || ts >= win.endMs) { summary.outsideShift++; continue; }
    // Without an id a repeat cannot be told from a new container.
    if (!e.eventId) { summary.ambiguous++; continue; }
    if (seen.has(e.eventId)) { summary.duplicate++; continue; }
    seen.add(e.eventId);
    if (verified) {
      const st = String(e.status ?? "").trim().toLowerCase();
      if (rejected.has(st)) { summary.rejected++; continue; }
      if (!accepted.has(st)) { summary.ambiguous++; continue; }
    }

    const minute = (ts - win.startMs) / MS_PER_MIN;
    let idx = -1;
    if (e.jobId) idx = jobs.findIndex((j) => j.jobId === e.jobId);
    else idx = jobs.findIndex((j) => j.allocation !== null && minute >= j.allocation.start && minute < j.allocation.end);
    if (idx >= 0 && e.sku && jobs[idx].sku && normaliseSku(e.sku) !== jobs[idx].sku) { summary.ambiguous++; continue; }

    shiftCount++;
    if (idx < 0) { summary.unassociated++; continue; }
    const list = perJob.get(idx) ?? [];
    list.push(minute);
    perJob.set(idx, list);
  }
  summary.valid = verified ? shiftCount : 0;
  result.events = summary;

  if (!verified) {
    warnings.push({
      code: "EVENT_SEMANTICS_UNVERIFIED",
      message: `${shiftCount} candidate filling events were not counted: it has not been verified that one event is one completed container.`,
    });
  }
  if (summary.unassociated) {
    warnings.push({ code: "EVENTS_UNASSOCIATED", message: `${summary.unassociated} events could not be tied to a planned job; they count only in the shift total.` });
  }

  jobs.forEach((job, idx) => {
    const minutes = perJob.get(idx) ?? [];
    job.candidateEvents = minutes.length;
    if (!verified) return;
    job.actualContainers = minutes.length;
    if (job.expectedContainers !== null) job.difference = job.actualContainers - job.expectedContainers;
    // Speed between the first and last completed container, minus breaks and
    // downtime inside that span. n containers span n − 1 gaps.
    if (minutes.length >= 2) {
      const first = minutes[0];
      const last = minutes[minutes.length - 1];
      const span = freeMinutes(first, last, blocked);
      if (span > 0) job.observedPerHour = round1(((minutes.length - 1) / span) * 60);
    }
  });

  if (verified) {
    result.actualTotal = shiftCount;
    if (result.expectedTotal !== null) result.difference = shiftCount - result.expectedTotal;
  }
  return result;
}

// ── Backtest ──────────────────────────────────────────────────────────────

export interface BacktestRow {
  key: string;
  forecast: number | null;
  actual: number | null;
  historySufficient: boolean;
  /** A data-quality reason to leave this shift out, decided before scoring. */
  excludeReason?: string | null;
}

export interface BacktestStats {
  shifts: number;
  scored: number;
  coverage: number | null;
  meanAbsError: number | null;
  medianAbsError: number | null;
  /** Only over shifts with actual > 0; a percentage of zero is undefined. */
  medianAbsPctError: number | null;
  pctScored: number;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function stats(rows: BacktestRow[]): BacktestStats {
  const scored = rows.filter((r) => !r.excludeReason && r.forecast !== null && r.actual !== null);
  const abs = scored.map((r) => Math.abs(r.forecast! - r.actual!));
  const pct = scored.filter((r) => r.actual! > 0).map((r) => (Math.abs(r.forecast! - r.actual!) / r.actual!) * 100);
  return {
    shifts: rows.length,
    scored: scored.length,
    coverage: rows.length ? round1((scored.length / rows.length) * 100) : null,
    meanAbsError: abs.length ? round1(abs.reduce((a, b) => a + b, 0) / abs.length) : null,
    medianAbsError: median(abs),
    medianAbsPctError: pct.length ? round1(median(pct)!) : null,
    pctScored: pct.length,
  };
}

/**
 * Error by completed shift, with SKUs that have enough history kept apart from
 * those that do not. Outliers are flagged with Tukey fences on the signed
 * percentage error; they are reported, not removed. There is no pass mark here:
 * an acceptable error is for Production to set.
 */
export function backtest(rows: BacktestRow[]) {
  const excluded = rows
    .map((r) => ({
      key: r.key,
      reason: r.excludeReason || (r.forecast === null ? "no forecast" : r.actual === null ? "no actual" : null),
    }))
    .filter((x): x is { key: string; reason: string } => x.reason !== null);

  const signed = rows
    .filter((r) => !r.excludeReason && r.forecast !== null && r.actual !== null && r.actual > 0)
    .map((r) => ({ key: r.key, pctError: round1(((r.forecast! - r.actual!) / r.actual!) * 100) }));
  let outliers: { key: string; pctError: number }[] = [];
  if (signed.length >= 4) {
    const s = signed.map((x) => x.pctError).sort((a, b) => a - b);
    const q = (p: number) => {
      const pos = (s.length - 1) * p;
      const lo = Math.floor(pos);
      return s[lo] + (s[Math.ceil(pos)] - s[lo]) * (pos - lo);
    };
    const q1 = q(0.25);
    const q3 = q(0.75);
    const iqr = q3 - q1;
    outliers = signed.filter((x) => x.pctError < q1 - 1.5 * iqr || x.pctError > q3 + 1.5 * iqr);
  }

  return {
    sufficient: stats(rows.filter((r) => r.historySufficient)),
    insufficient: stats(rows.filter((r) => !r.historySufficient)),
    excluded,
    outliers,
  };
}
