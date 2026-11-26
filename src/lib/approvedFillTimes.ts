/**
 * The standard fill time: the approved per-SKU value from `sku_fill_times` when one
 * exists, otherwise iTouch's real seconds from `itouch_cycle_times`. Never the fixed
 * matrix. Approved rows only replace a value; iTouch's record is left as it is.
 */
import type { CycleRecord } from "@/lib/smartTargetRates";
import type { SkuFillTime } from "@/hooks/useSkuFillTimes";

const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9.]+/g, " ").trim();
export const fillKey = (machine: unknown, sku: unknown) => `${norm(machine)}|${norm(sku)}`;

export interface ApprovedStandard { seconds: number; unitsPerCycle: number }

export function approvedLookup(rows: SkuFillTime[] | null | undefined): Map<string, ApprovedStandard> {
  const m = new Map<string, ApprovedStandard>();
  for (const r of rows ?? []) {
    const s = r.approved_seconds == null ? NaN : Number(r.approved_seconds);
    if (!Number.isFinite(s) || s <= 0) continue;
    const units = r.time_basis === "per_cycle" && r.units_per_cycle && r.units_per_cycle > 0 ? Number(r.units_per_cycle) : 1;
    m.set(fillKey(r.machine_name, r.sku_code), { seconds: s, unitsPerCycle: units });
  }
  return m;
}

/** iTouch records with approved values put in their place; approved SKUs iTouch lacks are added. */
export function withApprovedFillTimes(records: CycleRecord[], approved: Map<string, ApprovedStandard>, rows: SkuFillTime[] | null | undefined = []): CycleRecord[] {
  if (!approved.size) return records;
  const seen = new Set<string>();
  const out = records.map((r) => {
    const k = fillKey(r.line, r.sku);
    const a = approved.get(k);
    if (!a) return r;
    seen.add(k);
    return { ...r, cycleSeconds: a.seconds, cavities: a.unitsPerCycle, source: "approved" };
  });
  for (const r of rows ?? []) {
    const k = fillKey(r.machine_name, r.sku_code);
    const a = approved.get(k);
    if (a && !seen.has(k)) { seen.add(k); out.push({ line: r.machine_name, sku: r.sku_code, cycleSeconds: a.seconds, cavities: a.unitsPerCycle, source: "approved" }); }
  }
  return out;
}

/** Standard seconds per unit: approved first, then iTouch's cycle ÷ units per cycle. */
export function standardSecondsPerUnit(machine: unknown, sku: unknown, approved: Map<string, ApprovedStandard>, itouch: Map<string, CycleRecord>): { seconds: number; from: "approved" | "itouch" } | null {
  const k = fillKey(machine, sku);
  const a = approved.get(k);
  if (a) return { seconds: a.seconds / a.unitsPerCycle, from: "approved" };
  const c = itouch.get(k);
  const s = c?.cycleSeconds == null ? NaN : Number(c.cycleSeconds);
  if (!Number.isFinite(s) || s <= 0) return null;
  const cav = c?.cavities && c.cavities > 0 ? c.cavities : 1;
  return { seconds: s / cav, from: "itouch" };
}

/** Performance %: standard ÷ real. Not capped at 100 — above 100 means the standard is too slow. */
export function performancePct(standardSecs: number, realSecs: number): number | null {
  if (!(standardSecs > 0) || !(realSecs > 0)) return null;
  return Math.round((standardSecs / realSecs) * 1000) / 10;
}
