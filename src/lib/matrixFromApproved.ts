import type { SkuFillTime } from "@/hooks/useSkuFillTimes";
import { packSizeKg } from "@/lib/packSize";
import { lineFillTimeKey } from "@/lib/fillSpeedMatrixEditor";
import { machineKey } from "@/lib/approvedFillTimes";

export interface PackStandard { seconds: number; skus: number }

/**
 * Fill speed matrix cells derived from approved SKU fill times: per line and pack size,
 * the median seconds per tub of every approved SKU of that size. Per-cycle approvals are
 * divided by units per cycle so the cell stays "seconds per tub".
 */
export function packStandardsFromApproved(rows: SkuFillTime[] | null | undefined): Map<string, PackStandard> {
  const groups = new Map<string, number[]>();
  for (const r of rows ?? []) {
    const s = r.approved_seconds == null ? NaN : Number(r.approved_seconds);
    if (!Number.isFinite(s) || s <= 0) continue;
    const m = machineKey(r.machine_name).match(/^line (\d+)$/);
    const kg = packSizeKg(r.product_description) ?? packSizeKg(r.sku_code);
    if (!m || kg === null) continue;
    const units = r.time_basis === "per_cycle" && r.units_per_cycle && r.units_per_cycle > 0 ? Number(r.units_per_cycle) : 1;
    const key = lineFillTimeKey(Number(m[1]), kg);
    groups.set(key, [...(groups.get(key) ?? []), s / units]);
  }
  const out = new Map<string, PackStandard>();
  for (const [key, values] of groups) {
    const v = [...values].sort((a, b) => a - b);
    const mid = Math.floor(v.length / 2);
    const median = v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
    out.set(key, { seconds: Math.round(median * 100) / 100, skus: v.length });
  }
  return out;
}
