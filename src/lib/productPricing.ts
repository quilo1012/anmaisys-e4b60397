/**
 * Whether a product write carries a price, and the reason it usually should not.
 *
 * `stock.pricing` is admin-only in the matrix, and from 20260831090000 a trigger on
 * `products` enforces it — but on the VALUE, refusing only a price that actually
 * moved. That works only if nothing sends a price it did not mean to change.
 *
 * `useUpdateProduct` used to send `price: price ?? 0` on every save. On a part with no
 * price that is NULL → 0, which is a change, and it would have refused an ordinary
 * edit by a manager who never touched the field. So the key is dropped rather than
 * zeroed: absent means "not my business", which is a different statement from £0.00.
 */
export type ProductColumns = {
  name: string;
  line?: string;
  code: string;
  quantity: number;
  min_stock: number;
  category: string;
};

export function productWritePayload(
  columns: ProductColumns,
  price: number | undefined,
  mayPrice: boolean,
): ProductColumns & { price?: number } {
  if (!mayPrice || price === undefined || !Number.isFinite(price)) return { ...columns };
  return { ...columns, price };
}
