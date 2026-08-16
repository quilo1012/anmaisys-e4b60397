/**
 * The standard rate of a SKU, and how to show it when there is none.
 *
 * `sku_products.target_per_hour` defaults to 0 (migration 20260724160000), and 208
 * active SKUs still carry that default — the remaining ones hold only five distinct
 * values between them, which are line-class rates rather than per-product standards.
 *
 * That default is the problem this file exists for. `?? 0` cannot separate "never
 * recorded" from "recorded as zero", because the value already IS zero by the time it
 * arrives. The SKU Efficiency table printed it raw, on screen and into the exported
 * workbook, so 208 products read as making nothing an hour — in a file that gets
 * forwarded, where nobody can ask what the zero meant.
 *
 * Zero is read here as the absence it is. A product that makes nothing an hour is not
 * a product, so no information is lost by refusing to show it as a measurement. This
 * is the same rule the factory already applies to headcount and to stop reasons:
 * blank is never zero.
 */
export function skuStandardRate(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/** For a cell: the rate, or an em dash. Never a zero standing in for "not recorded". */
export function formatStandardRate(rate: number | null): string {
  return rate === null ? "—" : rate.toLocaleString();
}
