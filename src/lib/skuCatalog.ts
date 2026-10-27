export interface SkuFields {
  id?: string;
  code?: string;
  name?: string;
  category?: string | null;
  target_per_hour?: number | null;
  weight?: number | null;
  active?: boolean;
}

/** Editable attributes only; the primary key is used in the filter, never in the payload. */
export function skuUpdatePayload(sku: SkuFields) {
  return {
    code: (sku.code ?? "").trim(), name: sku.name ?? "", category: sku.category ?? null,
    target_per_hour: sku.target_per_hour ?? 0, weight: sku.weight ?? null, active: sku.active ?? true,
  };
}

export const SKU_IN_USE_MESSAGE =
  "This SKU has production targets or production history and cannot be deleted. Deactivate it instead; all records will be kept.";

/** True when the database refused a delete because production still points at the SKU. */
export function isSkuInUse(error: { code?: string; message: string }): boolean {
  return error.code === "23503" || /foreign key|production records|production targets/i.test(error.message);
}

export function skuDeleteError(error: { code?: string; message: string }): string {
  return isSkuInUse(error) ? SKU_IN_USE_MESSAGE : error.message;
}

/**
 * A write PostgREST accepted but that touched no row.
 *
 * RLS does not raise on UPDATE/DELETE: a role without write rights, or a row
 * removed meanwhile, comes back as `200 []` with no error — and the page used
 * to say "Saved" / "Deleted" for a change that never happened. Every SKU write
 * therefore asks for the affected ids back and treats an empty list as failure.
 */
export class SkuNotChangedError extends Error {
  constructor(action: "save" | "delete") {
    super(
      action === "save"
        ? "Nothing was saved. You may not have permission to edit SKUs, or the SKU no longer exists — refresh and try again."
        : "Nothing was deleted. You may not have permission to delete SKUs, or the SKU no longer exists — refresh and try again.",
    );
    this.name = "SkuNotChangedError";
  }
}

export function assertSkuRowsChanged(rows: unknown[] | null | undefined, action: "save" | "delete"): void {
  if (!rows || rows.length === 0) throw new SkuNotChangedError(action);
}
