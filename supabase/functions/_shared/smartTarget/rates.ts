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

import { normaliseSku, parseLineNo, type JobForecast, type LineNo, type PlannedJob, type RateRecord } from "./engine.ts";

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

/**
 * The rule for what a shift will fill (decided 06/11, Q62a): what this line did on its last
 * 5 shifts of this product. Simple, and it knows what an average cannot: Essential Protein
 * 1.6 kg on Line 1 makes about 1,600 a shift because of the hours between runs, whatever the
 * line's speed on other products. It says what the line usually does, not what it could do.
 *
 * Scored fairly, knowing only the shift's main product, on 464 shifts since 15/09: a median
 * miss of 14.5%, against 17.1% for iTouch × factor alone; 12.1% where the line has history.
 */
export const LAST_SHIFTS = 5;
export const LAST_SHIFTS_MIN = 2;
export const FAMILY_SOURCE = "Recent shifts of this product";
/** No history of this product on the line: iTouch × factor. An estimate, left out of the main measurement. */
export const NO_HISTORY_SOURCE = "No history";
/** Nothing at all for this product: the line's usual rate. An estimate, left out too. */
export const ESTIMATED_SOURCE = "Estimated";
export const SAMPLE_SOURCE = "Sample batches";

/**
 * Sample bags are timed by the batch, not the unit (decided 06/11, Q63a): from the start of
 * one batch to the start of the next took a median 185 min on 12 measured gaps (164 to 202
 * for the middle half), changeover and mixing included, for about 46 bags.
 */
export const SAMPLE_BATCH_MINUTES = 185;
export const SAMPLE_BATCH_UNITS = 46;

/** Q64a: anything starting BLENDED, or with SAMPLE in its code or name. */
export function isSampleProduct(sku: string | null | undefined, name?: string | null): boolean {
  return /^BLENDED/i.test(String(sku ?? "").trim()) || /SAMPLE/i.test(`${sku ?? ""} ${name ?? ""}`);
}

/** Whether a rate is an estimate, so its forecast stays out of the main measurement. */
export function isEstimateRate(source: string | null | undefined): boolean {
  return !!source && (source.startsWith(NO_HISTORY_SOURCE) || source.startsWith(ESTIMATED_SOURCE));
}

/**
 * For forecasts built here. The engine's floor of 5 history shifts is for a rate it knows
 * nothing else about; each rate here has already met its own rule.
 */
export const LINE_RATES_CONFIG = { minHistoryShifts: 0 };

/**
 * A product family from a product name: everything up to and including the fill size, without
 * the market. "ESSENTIAL PROTEIN 1.6KG BANANA" and "...WHITE CHOCOLATE" are one family, on
 * the same blender, fill and tub. A name with no fill size has no family.
 */
export function familyFromName(name: string | null | undefined): string | null {
  const clean = String(name ?? "").toUpperCase().replace(/\[.*$/, "").replace(/\b(PERU|KSA|NOT FOR EU)\b/g, " ").replace(/\s+/g, " ").trim();
  return /^(.*?\d+(?:\.\d+)?\s*(?:KG|G))\b/.exec(clean)?.[1] ?? null;
}

export interface PlanRateInputs {
  cycles: CleanCycle[];
  factor: LineFactor | null;
  /** Oldest first, as historyFromSessions() returns it. */
  history: HistoryShift[];
  /** A SKU's family; a SKU with none stands for itself. */
  familyOf: (sku: string) => string | null;
  isSample: (sku: string) => boolean;
}

const perHourOf = (h: HistoryShift) => {
  const available = h.netMinutes - h.setupMinutes;
  return available > 0 ? (h.made.reduce((sum, m) => sum + Math.max(0, m.qty), 0) / available) * 60 : null;
};

/** What the line reached on its last shifts of each family: those it mostly filled, no samples. */
export function lastShiftsRates(line: LineNo, inputs: Pick<PlanRateInputs, "history" | "familyOf" | "isSample">) {
  const seen = new Map<string, number[]>();
  for (const h of inputs.history) {
    if (h.line !== line) continue;
    const made = h.made.filter((m) => m.qty > 0 && m.sku);
    if (!made.length || made.some((m) => inputs.isSample(m.sku!))) continue;
    const byFamily = new Map<string, number>();
    for (const m of made) {
      const family = inputs.familyOf(m.sku!) ?? normaliseSku(m.sku)!;
      byFamily.set(family, (byFamily.get(family) ?? 0) + m.qty);
    }
    const [main] = [...byFamily.entries()].sort((a, b) => b[1] - a[1])[0];
    const rate = perHourOf(h);
    if (rate !== null) seen.set(main, [...(seen.get(main) ?? []), rate]);
  }
  const out = new Map<string, { perHour: number; shifts: number }>();
  for (const [family, rates] of seen) {
    if (rates.length >= LAST_SHIFTS_MIN) {
      const last = rates.slice(-LAST_SHIFTS);
      out.set(family, { perHour: median(last), shifts: last.length });
    }
  }
  return out;
}

/**
 * The rates for one line's plan, one per product, best evidence first: sample batches by
 * time; the line's last shifts of the product; iTouch × factor, marked as having no history;
 * the line's usual rate, marked as an estimate. Sample jobs carry no separate changeover or
 * mixing, because the batch time already holds them.
 */
export function planRates(line: LineNo, jobs: PlannedJob[], inputs: PlanRateInputs): { jobs: PlannedJob[]; rates: RateRecord[] } {
  const families = lastShiftsRates(line, inputs);
  const fromItouch = new Map((inputs.factor ? ratesForLine(line, inputs.cycles, inputs.factor) : []).map((r) => [normaliseSku(r.sku), r]));
  const usual = inputs.history.filter((h) => h.line === line).slice(-10).map(perHourOf).filter((r): r is number => r !== null);
  const rates = new Map<string, RateRecord>();
  const record = (sku: string, value: number, sampleShifts: number, source: string): RateRecord =>
    ({ line, sku, value: Math.round(value * 10) / 10, unit: "containers/hour", status: "provisional", sampleShifts, source });
  const planned = jobs.map((job) => {
    const sku = normaliseSku(job.sku);
    if (!sku) return job;
    if (inputs.isSample(sku)) {
      const batches = job.batches ?? 1;
      const orderQty = job.orderQty && job.orderQty > 0 ? job.orderQty : batches * SAMPLE_BATCH_UNITS;
      if (!rates.has(sku)) {
        rates.set(sku, record(sku, orderQty / ((batches * SAMPLE_BATCH_MINUTES) / 60), 0, `${SAMPLE_SOURCE}: about ${Math.round(SAMPLE_BATCH_MINUTES / 60)} h a batch, ${batches} batch${batches === 1 ? "" : "es"}`));
      }
      return { ...job, orderQty, changeoverMinutes: 0, mixingMinutes: 0 };
    }
    if (rates.has(sku)) return job;
    const family = inputs.familyOf(sku) ?? sku;
    const seen = families.get(family);
    const itouch = fromItouch.get(sku);
    if (seen) rates.set(sku, record(sku, seen.perHour, seen.shifts, `${FAMILY_SOURCE}: median of the last ${seen.shifts} shifts of ${family} on Line ${line}`));
    else if (itouch) rates.set(sku, { ...itouch, source: `${NO_HISTORY_SOURCE}: ${itouch.source}` });
    else if (usual.length) rates.set(sku, record(sku, median(usual), 0, `${ESTIMATED_SOURCE}: no rate for ${sku}, so the line's usual rate`));
    return job;
  });
  return { jobs: planned, rates: [...rates.values()] };
}

export interface CycleToFix {
  line: LineNo;
  sku: string;
  /** What iTouch holds, when it holds something unusable. */
  itouchSeconds: number | null;
  problem: string;
  madeQty: number;
  shifts: number;
  /** True when the line's own recent shifts give it a rate in the meantime. */
  coveredMeanwhile: boolean;
}

/**
 * The short list for iTouch (Q44a): products the line actually filled in the window
 * that have no usable iTouch cycle, biggest first. The full rejected list is far longer
 * and mostly products nobody makes.
 */
export function cyclesToFix(
  history: HistoryShift[],
  cycles: CleanCycle[],
  rejected: RejectedCycle[],
  families: Pick<PlanRateInputs, "familyOf" | "isSample"> = { familyOf: () => null, isSample: () => false },
): CycleToFix[] {
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
  const known = new Map<LineNo, Map<string, unknown>>();
  const out: CycleToFix[] = [];
  for (const [k, m] of made) {
    if (usable.has(k)) continue;
    if (!known.has(m.line)) known.set(m.line, lastShiftsRates(m.line, { history, ...families }));
    const bad = rejected.find((r) => parseLineNo(r.line) === m.line && normaliseSku(r.sku) === m.sku);
    out.push({
      line: m.line,
      sku: m.sku,
      itouchSeconds: bad?.cycleSeconds ?? null,
      problem: bad ? bad.reason : "No cycle time for this product on this line in iTouch.",
      madeQty: m.qty,
      shifts: m.shifts,
      coveredMeanwhile: known.get(m.line)!.has(families.familyOf(m.sku) ?? m.sku),
    });
  }
  return out.sort((a, b) => b.madeQty - a.madeQty || a.line - b.line);
}

export interface FixSuggestion {
  /** The target the line should use for this product, or null with no evidence. */
  perHour: number | null;
  /** The ideal cycle to enter in iTouch: that target ÷ the line's performance. */
  cycleSeconds: number | null;
  why: string;
}

/**
 * What to do about a product on the Fix in iTouch list, and why. The cycle iTouch should
 * hold is the one that, at the line's performance, gives the rate the line reaches: for
 * Line 4's CRE500, 5.1 s real at 62% is about 3.1 s, not the 0.31 s it held.
 */
export function fixSuggestion(sku: string, rates: RateRecord[], factor: number | null): FixSuggestion {
  const rate = rates.find((r) => normaliseSku(r.sku) === normaliseSku(sku));
  if (!rate) return { perHour: null, cycleSeconds: null, why: "No shifts of it on this line yet: time a run and enter the cycle." };
  const cycle = factor ? Math.round((3600 / rate.value) * factor * 10) / 10 : null;
  const usable = cycle !== null && cycle >= DEFAULT_CYCLE_LIMITS.minSeconds && cycle <= DEFAULT_CYCLE_LIMITS.maxSeconds;
  const from = rate.source.startsWith(FAMILY_SOURCE)
    ? `What the line reached on its last ${rate.sampleShifts} shifts of this product`
    : rate.source.startsWith(ESTIMATED_SOURCE)
      ? "An estimate: the line's usual rate"
      : `iTouch's other cycles at this line's performance`;
  return {
    perHour: Math.round(rate.value),
    cycleSeconds: usable ? cycle : null,
    why: factor && usable ? `${from}. ${Math.round(rate.value)}/h at the line's ${Math.round(factor * 100)}% performance is a ${cycle} s cycle.` : `${from}.`,
  };
}

/** One sentence per job: how its part of the target was reached. */
export function explainTarget(jobs: JobForecast[]): string[] {
  return jobs.flatMap((j) => {
    if (j.expectedContainers === null || !j.rate) return [];
    const perHour = Math.round(j.rate.perHour);
    const from = j.rate.source.startsWith(FAMILY_SOURCE)
      ? `the line's last ${j.rate.sampleShifts} shifts of this product`
      : j.rate.source.startsWith(SAMPLE_SOURCE)
        ? `sample batches, about ${Math.round(SAMPLE_BATCH_MINUTES / 60)} h each`
        : j.rate.source.startsWith(NO_HISTORY_SOURCE)
          ? "no history here: iTouch's cycle × the line's performance, an estimate"
          : "an estimate: the line's usual rate";
    const qty = j.expectedContainers.toLocaleString();
    return [
      j.allocation?.basis === "order_qty_at_rate" && j.allocation.completesOrder
        ? `${j.sku}: ${qty}, the whole order, about ${Math.round((j.expectedContainers / j.rate.perHour) * 60)} min at ${perHour}/h (${from}).`
        : `${j.sku}: ${qty} = ${perHour}/h × ${Math.round(j.allocation?.productiveMinutes ?? 0)} min left in the shift (${from}).`,
    ];
  });
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

