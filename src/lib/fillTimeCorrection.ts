/** Performance above 100% means the standard fill time is slower than the line really fills.
 * The standard that would read exactly 100%: standard × 100 ÷ performance. Null when nothing needs correcting. */
export function correctedFillTime(standardSeconds: number, performancePct: number): number | null {
  if (!(standardSeconds > 0) || !(performancePct > 100)) return null;
  return Math.round(((standardSeconds * 100) / performancePct) * 100) / 100;
}
