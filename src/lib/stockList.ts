// The counting and the narrowing behind the Stock screen.
//
// Out of the component because these are the two things that can be wrong quietly:
// a reorder banner that disagrees with the row badges under it, or a search box that
// says it looks in five fields and looks in two.

export interface StockRow {
  id: string;
  name: string;
  code: string;
  line: string;
  category: string;
  description: string | null;
  machine: string | null;
  location: string | null;
  photo_url: string | null;
  quantity: number;
  min_stock: number;
  price: number;
}

/**
 * Empty is not low. It is worse, and it is counted apart.
 *
 * `LOW STOCK 85 · OUT OF STOCK 7` are two figures about two different sets of parts,
 * and the warehouse list this screen replaces has always read them that way — its
 * reorder export names the 85 and none of the 7. Counting an empty part in both gave
 * 93 here against 85 there, and 93 was not a number anybody could find on the shelf.
 *
 * Reconciled part by part on 26/08/2026 against that export: our 93 was their 85, plus
 * the 7 empty ones, plus the two BFM sleeves this app holds and theirs does not, minus
 * `17x32x7-33004`, which exists there in two cases and here as one merged row.
 *
 * A part sitting exactly ON its minimum IS low — the last one before the line stops is
 * precisely when somebody should be ordering it. Same source: `244L`, 3 of a minimum
 * of 3, is in their reorder list.
 */
export const isOutOfStock = (r: Pick<StockRow, "quantity">) => (r.quantity || 0) === 0;
export const isLowStock = (r: Pick<StockRow, "quantity" | "min_stock">) =>
  !isOutOfStock(r) && r.quantity <= r.min_stock;

/** What a row's badge says — the same two rules the counters use, and no third one. */
export type StockState = "out" | "low" | "ok";
export const stockState = (r: Pick<StockRow, "quantity" | "min_stock">): StockState =>
  isOutOfStock(r) ? "out" : isLowStock(r) ? "low" : "ok";

export interface StockTotals { parts: number; inStock: number; low: number; out: number }

export function stockTotals(rows: StockRow[]): StockTotals {
  return {
    parts: rows.length,
    inStock: rows.reduce((a, r) => a + (r.quantity || 0), 0),
    low: rows.filter(isLowStock).length,
    out: rows.filter(isOutOfStock).length,
  };
}

export interface StockFilter { query?: string; category?: string; lowOnly?: boolean; outOnly?: boolean }

/**
 * The five fields the search box names — model, description, machine, line and
 * location — and nothing else. A part is looked up by what is written on the shelf
 * label or by where it lives, never by its price or its quantity.
 */
// Generic in the row so a caller that holds richer rows — `Product`, with its
// timestamps — gets those same rows back and not a narrowed copy of them.
export function filterStock<T extends StockRow>(rows: T[], f: StockFilter): T[] {
  const q = (f.query ?? "").trim().toLowerCase();
  const cat = f.category ?? "__all__";
  return rows.filter((r) => {
    if (cat !== "__all__" && r.category !== cat) return false;
    if (f.lowOnly && !isLowStock(r)) return false;
    if (f.outOnly && !isOutOfStock(r)) return false;
    if (!q) return true;
    return [r.name, r.code, r.description, r.machine, r.line, r.location]
      .some((v) => (v ?? "").toLowerCase().includes(q));
  });
}
