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

import { normaliseSku, parseLineNo, type LineNo, type RateRecord } from "./smartTargetEngine";

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

/** Provisional, awaiting Production (Q21). */
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
