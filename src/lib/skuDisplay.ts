// Some SKUs were imported with the batch baked into the code, e.g.
// "PERUCRE500 - B4". For display we show the base code and surface the batch
// separately (it also lives in production_items.blender_ref).

const BATCH_SUFFIX = /\s*-\s*(B\d+)\s*$/i;

/** SKU code without a trailing " - Bn" batch suffix. */
export function baseSkuCode(code: string | null | undefined): string {
  return (code ?? "").replace(BATCH_SUFFIX, "").trim();
}

/** The batch (e.g. "B4") encoded in a SKU code, if any. */
export function batchFromSkuCode(code: string | null | undefined): string {
  return (code ?? "").match(BATCH_SUFFIX)?.[1]?.toUpperCase() ?? "";
}
