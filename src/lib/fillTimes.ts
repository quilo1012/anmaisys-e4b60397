/**
 * Fill time per product and line: real run minutes ÷ units made, per shift,
 * set beside iTouch's standard cycle time. Read-only check (stage 1); Smart Target
 * does not use these numbers.
 */
import { normaliseSku, parseLineNo, type LineNo } from "@/lib/smartTargetEngine";
import type { CleanCycle } from "@/lib/smartTargetRates";

export interface FillShift {
  line: unknown;
  sku: string | null | undefined;
  name?: string | null;
  quantity: number | null | undefined;
  runMinutes: number | null | undefined;
}

export interface FillTimeRow {
  line: LineNo;
  sku: string;
  name: string | null;
  shifts: number;
  units: number;
  /** Median seconds per unit across shifts. */
  medianSeconds: number;
  bestSeconds: number;
  worstSeconds: number;
  unitsPerHour: number;
  itouchSeconds: number | null;
  /** (real − iTouch) ÷ iTouch; positive means slower than the standard. */
  vsItouch: number | null;
  flag: "few_shifts" | "far_from_itouch" | "no_itouch" | null;
}

/** Below this a filler cycle is not physically plausible (same floor as the cycle import). */
const MIN_SECONDS = 0.31;
export const MIN_SHIFTS = 5;
export const FAR_FROM_ITOUCH = 0.5;

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function secondsPerUnit(runMinutes: number, quantity: number): number | null {
  if (!Number.isFinite(runMinutes) || !Number.isFinite(quantity) || runMinutes <= 0 || quantity <= 0) return null;
  const s = (runMinutes * 60) / quantity;
  return s >= MIN_SECONDS ? s : null;
}

export function fillTimes(shifts: FillShift[], cycles: CleanCycle[]): FillTimeRow[] {
  const groups = new Map<string, { line: LineNo; sku: string; name: string | null; secs: number[]; units: number }>();
  for (const r of shifts) {
    const line = parseLineNo(r.line);
    const sku = normaliseSku(r.sku);
    const s = secondsPerUnit(Number(r.runMinutes), Number(r.quantity));
    if (!line || !sku || s === null) continue;
    const key = `${line}|${sku}`;
    const g = groups.get(key) ?? { line, sku, name: r.name ?? null, secs: [], units: 0 };
    g.secs.push(s);
    g.units += Number(r.quantity);
    groups.set(key, g);
  }
  const cycleOf = new Map(cycles.map((c) => [`${c.line}|${c.sku}`, c.cycleSeconds]));
  return [...groups.values()]
    .map((g) => {
      const med = median(g.secs);
      const it = cycleOf.get(`${g.line}|${g.sku}`) ?? null;
      const vs = it ? (med - it) / it : null;
      const flag: FillTimeRow["flag"] =
        g.secs.length < MIN_SHIFTS ? "few_shifts" : it === null ? "no_itouch" : Math.abs(vs!) > FAR_FROM_ITOUCH ? "far_from_itouch" : null;
      return {
        line: g.line, sku: g.sku, name: g.name, shifts: g.secs.length, units: g.units,
        medianSeconds: med, bestSeconds: Math.min(...g.secs), worstSeconds: Math.max(...g.secs),
        unitsPerHour: 3600 / med, itouchSeconds: it, vsItouch: vs, flag,
      };
    })
    .sort((a, b) => a.line - b.line || a.sku.localeCompare(b.sku));
}
