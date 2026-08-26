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
 * At or below the minimum is "reached the reorder point".
 *
 * One rule, used by the counter, the banner and the row badge alike. A part sitting
 * exactly on its minimum is the last one before the line stops, which is precisely
 * when somebody should be ordering it.
 */
export const isLowStock = (r: Pick<StockRow, "quantity" | "min_stock">) => r.quantity <= r.min_stock;

export interface StockTotals { parts: number; inStock: number; low: number; out: number }

export function stockTotals(rows: StockRow[]): StockTotals {
  return {
    parts: rows.length,
    inStock: rows.reduce((a, r) => a + (r.quantity || 0), 0),
    low: rows.filter(isLowStock).length,
    // Out of stock is counted apart from low even though every empty part is also
    // low: "7 parts at zero" and "85 to reorder" are two different jobs.
    out: rows.filter((r) => (r.quantity || 0) === 0).length,
  };
}

export interface StockFilter { query?: string; category?: string; lowOnly?: boolean }

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
    if (!q) return true;
    return [r.name, r.code, r.description, r.machine, r.line, r.location]
      .some((v) => (v ?? "").toLowerCase().includes(q));
  });
}
