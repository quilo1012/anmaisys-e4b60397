/**
 * Checks iTouch's standard fill time (cycle) per product against what is plausible
 * and against the Fill speed matrix for the product's line and pack size.
 * Read-only: nothing is corrected, it only says what Production should fix in iTouch.
 */
import { cleanCycles, type CycleRecord } from "@/lib/smartTargetRates";
import { packSizeKg, timeMotionFor } from "@/lib/packSize";

/** iTouch further than this from the matrix (either way) is flagged. */
export const FAR_FROM_MATRIX = 0.3;

export interface ItouchFillTimeIssue {
  line: string;
  sku: string;
  itouchSeconds: number | null;
  matrixSeconds: number | null;
  reason: string;
}

export function checkItouchFillTimes(
  records: CycleRecord[],
  nameOf: (sku: string) => string | null | undefined,
): ItouchFillTimeIssue[] {
  const { cycles, rejected } = cleanCycles(records);
  const out: ItouchFillTimeIssue[] = rejected.map((r) => ({
    line: r.line, sku: r.sku, itouchSeconds: r.cycleSeconds, matrixSeconds: null, reason: r.reason,
  }));
  for (const c of cycles) {
    const tm = timeMotionFor(c.line, packSizeKg(nameOf(c.sku)));
    if (!tm) continue;
    const m = tm[2];
    const diff = (c.cycleSeconds - m) / m;
    if (Math.abs(diff) > FAR_FROM_MATRIX) {
      out.push({
        line: `Line ${c.line}`, sku: c.sku, itouchSeconds: c.cycleSeconds, matrixSeconds: m,
        reason: `iTouch ${c.cycleSeconds} s is ${Math.round(Math.abs(diff) * 100)}% ${diff < 0 ? "faster" : "slower"} than the matrix (${m} s).`,
      });
    }
  }
  return out.sort((a, b) => a.line.localeCompare(b.line) || a.sku.localeCompare(b.sku));
}
