/**
 * Performance per line and shift: the time the standard allows for what was made
 * (approved fill time per SKU, else iTouch) ÷ the run time recorded. Not capped.
 */
import type { CycleRecord } from "@/lib/smartTargetRates";
import { fillKey, standardSecondsPerUnit, type ApprovedStandard } from "@/lib/approvedFillTimes";

export interface ShiftRun { date: string; shift: string; line: string; sku: string; name: string | null; quantity: number; runMinutes: number }
export interface ShiftPoint { key: string; label: string; date: string; shift: string; performance: number | null; units: number; runMinutes: number }
export interface SkuStandard { sku: string; name: string | null; approvedSeconds: number | null; unitsPerCycle: number | null; itouchSeconds: number | null; realSeconds: number | null; performance: number | null }
export interface LinePerformance { line: string; shifts: ShiftPoint[]; skus: SkuStandard[]; performance: number | null; uncovered: number }

const pct = (std: number, real: number) => (std > 0 && real > 0 ? Math.round((std / real) * 1000) / 10 : null);

export function lineShiftPerformance(runs: ShiftRun[], cycles: CycleRecord[], approved: Map<string, ApprovedStandard>): LinePerformance[] {
  const itouch = new Map<string, CycleRecord>();
  for (const c of cycles) itouch.set(fillKey(c.line, c.sku), c);
  const lines = new Map<string, { shifts: Map<string, ShiftPoint & { std: number; covered: number }>; skus: Map<string, { name: string | null; std: number; real: number }>; uncovered: number }>();
  for (const r of runs) {
    if (!r.line || !r.sku || !(r.quantity > 0) || !(r.runMinutes > 0)) continue;
    const l = lines.get(r.line) ?? { shifts: new Map(), skus: new Map(), uncovered: 0 };
    lines.set(r.line, l);
    const std = standardSecondsPerUnit(r.line, r.sku, approved, itouch);
    const k = `${r.date}|${r.shift}`;
    const p = l.shifts.get(k) ?? { key: k, label: `${r.date.slice(8, 10)}/${r.date.slice(5, 7)} ${/night/i.test(r.shift) ? "N" : "D"}`, date: r.date, shift: r.shift, performance: null, units: 0, runMinutes: 0, std: 0, covered: 0 };
    p.units += r.quantity;
    if (std) { p.std += std.seconds * r.quantity; p.covered += r.runMinutes * 60; } else l.uncovered += 1;
    p.runMinutes += r.runMinutes;
    l.shifts.set(k, p);
    const s = l.skus.get(r.sku) ?? { name: r.name, std: 0, real: 0 };
    s.real += r.runMinutes * 60; s.std += r.quantity; // std holds units until the end
    l.skus.set(r.sku, s);
  }
  return [...lines.entries()].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })).map(([line, l]) => {
    const shifts = [...l.shifts.values()].sort((a, b) => a.key.localeCompare(b.key)).map(({ std, covered, ...p }) => ({ ...p, performance: pct(std, covered) }));
    let tStd = 0, tReal = 0;
    for (const p of l.shifts.values()) { tStd += p.std; tReal += p.covered; }
    const skus = [...l.skus.entries()].map(([sku, s]) => {
      const a = approved.get(fillKey(line, sku));
      const c = itouch.get(fillKey(line, sku));
      const real = s.std > 0 ? s.real / s.std : null;
      const std = standardSecondsPerUnit(line, sku, approved, itouch);
      return { sku, name: s.name, approvedSeconds: a?.seconds ?? null, unitsPerCycle: a?.unitsPerCycle ?? null, itouchSeconds: c?.cycleSeconds ?? null, realSeconds: real, performance: std && real ? pct(std.seconds, real) : null };
    }).sort((a, b) => a.sku.localeCompare(b.sku));
    return { line, shifts, skus, performance: pct(tStd, tReal), uncovered: l.uncovered };
  });
}
