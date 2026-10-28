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

export function skuDeleteError(error: { code?: string; message: string }): string {
  return error.code === "23503" || /foreign key|production records|production targets/i.test(error.message)
    ? "This SKU has production targets or production history and cannot be deleted. Deactivate it instead; all records will be kept."
    : error.message;
}