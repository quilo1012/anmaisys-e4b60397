/**
 * Where Smart Target's rates come from: iTouch's standard cycle time per product
 * and machine, scaled by how each line actually performs against it.
 *
 * iTouch holds a "Standard Cycle Time" in seconds per container for each part on
 * each machine (the "Product Details" export). That is the IDEAL speed. A
 * forecast built on it alone is the theoretical maximum, which no shift reaches,
 * so it would be a target that is always missed.
 *
 * The performance factor turns the ideal into a forecast. For each past shift of
 * a line:
 *
 *     factor = (Σ containers made × ideal seconds per container) ÷ (net minutes − setup minutes)
 *
 * Read it as "of the time left for filling, how much would the ideal speed have
 * needed to make what was made". It uses only quantities. No start or finish time
 * typed in Production Control is read.
 *
 * The line's factor is the median over its usable shifts. With fewer shifts than
 * the minimum, the line has no factor and no rate. Every rate made here is
 * labelled provisional: it rests on operator-logged quantities and on cycle times
 * nobody has audited yet.
 */

import { normaliseSku, parseLineNo, type LineNo, type RateRecord } from "./engine.ts";
import { BASE_LINES, RATE_BASE_DATE, RATE_BASE_ROWS } from "./rateBase.ts";

export interface CycleRecord {
  line: unknown;
  sku: string;
  /** Seconds per cycle, as iTouch stores it. */
  cycleSeconds: number | null;
  /** Containers per cycle. iTouch has 1 for every filler line. */
  cavities: number | null;
  source: string;
}

export interface CycleLimits {
  /** Below this a filler cycle is not physically plausible (0.31 s would be 11 600/h). */
  minSeconds: number;
  /** Above this it is a data-entry error, not a slow product. */
  maxSeconds: number;
}

/** Decided 05/11/2026 (Q21). A cycle outside these is listed for Production, never used. */
export const DEFAULT_CYCLE_LIMITS: CycleLimits = { minSeconds: 1.5, maxSeconds: 20 };

export interface CleanCycle {
  line: LineNo;
  sku: string;
  idealPerHour: number;
  cycleSeconds: number;
  source: string;
}

export interface RejectedCycle {
  line: string;
  sku: string;
  cycleSeconds: number | null;
  reason: string;
}

/** Splits iTouch cycle records into usable ones and a list for Production to fix. */
export function cleanCycles(
  records: CycleRecord[],
  limits: CycleLimits = DEFAULT_CYCLE_LIMITS,
): { cycles: CleanCycle[]; rejected: RejectedCycle[] } {
  const cycles: CleanCycle[] = [];
  const rejected: RejectedCycle[] = [];
  for (const r of records) {
    const line = parseLineNo(r.line);
    const sku = normaliseSku(r.sku);
    const raw = r.cycleSeconds === null || r.cycleSeconds === undefined ? null : Number(r.cycleSeconds);
    const reject = (reason: string) => rejected.push({ line: String(r.line ?? ""), sku: String(r.sku ?? ""), cycleSeconds: raw, reason });
    // Tablet, capsules and gel are outside v1, so they are left out without being
    // reported as faults.
    if (line === null) continue;
    if (!sku) { reject("No part code."); continue; }
    if (raw === null || !Number.isFinite(raw) || raw <= 0) { reject("No standard cycle time in iTouch."); continue; }
    if (raw < limits.minSeconds) { reject(`Cycle of ${raw} s is below ${limits.minSeconds} s, which is not plausible.`); continue; }
    if (raw > limits.maxSeconds) { reject(`Cycle of ${raw} s is above ${limits.maxSeconds} s, which looks like a data-entry error.`); continue; }
    const cavities = r.cavities && Number.isFinite(Number(r.cavities)) && Number(r.cavities) > 0 ? Number(r.cavities) : 1;
    cycles.push({ line, sku, cycleSeconds: raw, idealPerHour: (3600 / raw) * cavities, source: r.source });
  }
  // One record per line and SKU. A repeat with a different cycle is a conflict, and
  // a conflict is not resolved by picking one.
  const byKey = new Map<string, CleanCycle[]>();
  for (const c of cycles) byKey.set(`${c.line}|${c.sku}`, [...(byKey.get(`${c.line}|${c.sku}`) ?? []), c]);
  const unique: CleanCycle[] = [];
  for (const group of byKey.values()) {
    if (new Set(group.map((g) => g.cycleSeconds)).size > 1) {
      rejected.push({
        line: `Line ${group[0].line}`,
        sku: group[0].sku,
        cycleSeconds: null,
        reason: `iTouch holds ${group.length} different cycle times for this product on this line.`,
      });
    } else {
      unique.push(group[0]);
    }
  }
  return { cycles: unique, rejected };
}

/** One completed shift of one line, as the factor needs it. */
export interface HistoryShift {
  key: string;
  line: LineNo;
  /** What was made, per SKU, as the operator logged it. */
  made: { sku: string | null; qty: number }[];
  /** What was logged as made under typed text that is not in the product list (Q44). */
  unidentified?: { text: string; qty: number }[];
  /** Net minutes of the shift (gross − breaks). */
  netMinutes: number;
  /** Changeover + mixing the engine models for that shift's sequence. */
  setupMinutes: number;
}

export interface LineFactor {
  line: LineNo;
  factor: number | null;
  shiftsUsed: number;
  excluded: { key: string; reason: string }[];
}

/** A ratio above this means the record is wrong, not that the line beat ideal speed. */
const MAX_PLAUSIBLE_RATIO = 1.1;

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function lineFactors(history: HistoryShift[], cycles: CleanCycle[], minShifts = 5): LineFactor[] {
  const cycleOf = new Map(cycles.map((c) => [`${c.line}|${c.sku}`, c.cycleSeconds]));
  const lines: LineNo[] = [1, 2, 3, 4, 5, 6];
  return lines.map((line) => {
    const ratios: number[] = [];
    const excluded: { key: string; reason: string }[] = [];
    for (const h of history.filter((x) => x.line === line)) {
      const made = h.made.filter((m) => m.qty > 0);
      if (!made.length) { excluded.push({ key: h.key, reason: "Nothing logged as made." }); continue; }
      const noCycle = made.filter((m) => {
        const sku = normaliseSku(m.sku);
        return !sku || !cycleOf.has(`${line}|${sku}`);
      });
      if (noCycle.length) {
        excluded.push({ key: h.key, reason: `No usable cycle time for ${noCycle.map((m) => m.sku ?? "an item without SKU").join(", ")}.` });
        continue;
      }
      const available = h.netMinutes - h.setupMinutes;
      if (available <= 0) { excluded.push({ key: h.key, reason: "Setup takes the whole shift." }); continue; }
      const idealMinutes = made.reduce((s, m) => s + (m.qty * cycleOf.get(`${line}|${normaliseSku(m.sku)}`)!) / 60, 0);
      const ratio = idealMinutes / available;
      if (ratio > MAX_PLAUSIBLE_RATIO) {
        excluded.push({ key: h.key, reason: `Would mean ${Math.round(ratio * 100)}% of ideal speed; the record is wrong.` });
        continue;
      }
      ratios.push(ratio);
    }
    return {
      line,
      factor: ratios.length >= minShifts ? Math.round(median(ratios) * 1000) / 1000 : null,
      shiftsUsed: ratios.length,
      excluded,
    };
  });
}

/** Engine rates for one line: ideal × the line's factor, all provisional. */
export function ratesForLine(line: LineNo, cycles: CleanCycle[], factor: LineFactor): RateRecord[] {
  if (factor.factor === null) return [];
  return cycles
    .filter((c) => c.line === line)
    .map((c) => ({
      line,
      sku: c.sku,
      value: Math.round(c.idealPerHour * factor.factor! * 10) / 10,
      unit: "containers/hour",
      status: "provisional" as const,
      sampleShifts: factor.shiftsUsed,
      source: `${c.source}: ${c.cycleSeconds} s ideal × Line ${line} performance ${Math.round(factor.factor! * 100)}% (${factor.shiftsUsed} shifts)`,
    }));
}

/** Fewest single-product shifts an observed rate rests on (Q43). */
export const OBSERVED_MIN_SHIFTS = 3;
export const OBSERVED_SOURCE = "Observed on this line";

/**
 * A rate for each product the line has filled on its own for a whole shift, at least
 * OBSERVED_MIN_SHIFTS times: the median of containers ÷ (net minutes − setup) over those
 * shifts (decided 05/11, Q43a). It is the second choice, used only where iTouch has no
 * usable cycle for the product on this line. It is measured, not made up, and it says
 * so: the source starts with OBSERVED_SOURCE.
 */
export function observedRates(line: LineNo, history: HistoryShift[], minShifts = OBSERVED_MIN_SHIFTS): RateRecord[] {
  const bySku = new Map<string, number[]>();
  for (const h of history) {
    if (h.line !== line) continue;
    const made = h.made.filter((m) => m.qty > 0);
    if (made.length !== 1) continue;
    const sku = normaliseSku(made[0].sku);
    const available = h.netMinutes - h.setupMinutes;
    if (!sku || available <= 0) continue;
    bySku.set(sku, [...(bySku.get(sku) ?? []), (made[0].qty / available) * 60]);
  }
  const out: RateRecord[] = [];
  for (const [sku, perHour] of bySku) {
    if (perHour.length < minShifts) continue;
    out.push({
      line,
      sku,
      value: Math.round(median(perHour) * 10) / 10,
      unit: "containers/hour",
      status: "provisional",
      sampleShifts: perHour.length,
      source: `${OBSERVED_SOURCE}: median of ${perHour.length} shifts that filled only ${sku}`,
    });
  }
  return out;
}

export { BASE_LINES };

/**
 * For forecasts that use lineRates(). The engine's own floor of 5 history shifts is for a
 * rate it knows nothing else about. Every rate here has already met its own rule: a factor
 * rests on 5+ shifts, an observed rate on 3+, and a base row was tested as a whole, thin
 * rows included. With the floor on, a base row with 1 shift hid the iTouch × factor rate
 * behind it and the product read "no rate" (Line 6, CWBAG450V, 06/11).
 */
export const LINE_RATES_CONFIG = { minHistoryShifts: 0 };
export const BASE_SOURCE = "Line base";

const baseRows = RATE_BASE_ROWS.trim().split("\n").map((row) => {
  const [line, sku, perHour, shifts] = row.split("|");
  return { line: Number(line) as LineNo, sku: normaliseSku(sku)!, perHour: Number(perHour), shifts: Number(shifts) };
});

/** The base's rates for a line. Empty for a line the base did not improve (rateBase.ts). */
export function baseRates(line: LineNo): RateRecord[] {
  if (!BASE_LINES.includes(line)) return [];
  return baseRows
    .filter((r) => r.line === line)
    .map((r) => ({
      line,
      sku: r.sku,
      value: r.perHour,
      unit: "containers/hour",
      status: "provisional" as const,
      sampleShifts: r.shifts,
      source: `${BASE_SOURCE} of ${RATE_BASE_DATE}: ${r.shifts} shifts on this line, reports and iTouch`,
    }));
}

/**
 * Every rate the line has, best first: the line's base, then iTouch's ideal × the line's
 * factor, then the rate observed on the line for products neither of those covers.
 */
export function lineRates(line: LineNo, cycles: CleanCycle[], factor: LineFactor | null, history: HistoryShift[]): RateRecord[] {
  const out: RateRecord[] = [];
  const covered = new Set<string | null>();
  for (const r of [...baseRates(line), ...(factor ? ratesForLine(line, cycles, factor) : []), ...observedRates(line, history)]) {
    const key = normaliseSku(r.sku);
    if (covered.has(key)) continue;
    covered.add(key);
    out.push(r);
  }
  return out;
}

export interface CycleToFix {
  line: LineNo;
  sku: string;
  /** What iTouch holds, when it holds something unusable. */
  itouchSeconds: number | null;
  problem: string;
  madeQty: number;
  shifts: number;
  /** True when the line has a rate for it in the meantime, from its base or its history. */
  coveredMeanwhile: boolean;
}

/**
 * The short list for iTouch (Q44a): products the line actually filled in the window
 * that have no usable iTouch cycle, biggest first. The full rejected list is far longer
 * and mostly products nobody makes.
 */
export function cyclesToFix(history: HistoryShift[], cycles: CleanCycle[], rejected: RejectedCycle[]): CycleToFix[] {
  const usable = new Set(cycles.map((c) => `${c.line}|${c.sku}`));
  const made = new Map<string, { line: LineNo; sku: string; qty: number; shifts: number }>();
  for (const h of history) {
    for (const m of h.made) {
      const sku = normaliseSku(m.sku);
      if (!sku || m.qty <= 0) continue;
      const k = `${h.line}|${sku}`;
      const cur = made.get(k) ?? { line: h.line, sku, qty: 0, shifts: 0 };
      cur.qty += m.qty;
      cur.shifts += 1;
      made.set(k, cur);
    }
  }
  const observed = new Map<LineNo, Set<string>>();
  const out: CycleToFix[] = [];
  for (const [k, m] of made) {
    if (usable.has(k)) continue;
    if (!observed.has(m.line)) observed.set(m.line, new Set([...baseRates(m.line), ...observedRates(m.line, history)].map((r) => normaliseSku(r.sku)!)));
    const bad = rejected.find((r) => parseLineNo(r.line) === m.line && normaliseSku(r.sku) === m.sku);
    out.push({
      line: m.line,
      sku: m.sku,
      itouchSeconds: bad?.cycleSeconds ?? null,
      problem: bad ? bad.reason : "No cycle time for this product on this line in iTouch.",
      madeQty: m.qty,
      shifts: m.shifts,
      coveredMeanwhile: observed.get(m.line)!.has(m.sku),
    });
  }
  return out.sort((a, b) => b.madeQty - a.madeQty || a.line - b.line);
}

/** Typed products that are not in the product list, per line, biggest first (Q44a). */
export function productsWithoutCode(history: HistoryShift[]): { line: LineNo; text: string; qty: number }[] {
  const by = new Map<string, { line: LineNo; text: string; qty: number }>();
  for (const h of history) {
    for (const u of h.unidentified ?? []) {
      const k = `${h.line}|${u.text}`;
      const cur = by.get(k) ?? { line: h.line, text: u.text, qty: 0 };
      cur.qty += u.qty;
      by.set(k, cur);
    }
  }
  return [...by.values()].sort((a, b) => b.qty - a.qty);
}

