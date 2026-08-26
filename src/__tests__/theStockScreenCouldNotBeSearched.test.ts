import { describe, expect, it } from "vitest";
import { stockTotals, filterStock, type StockRow } from "@/lib/stockList";

/**
 * What this exists for.
 *
 * `/dashboard/stock` listed every part it had and offered no way through them. With
 * two demo products that is a table; with the 137 spare parts the warehouse actually
 * holds it is a wall — the same wall `anstockcontrol` answers with four counters, a
 * search box, a category filter and a low-stock switch.
 *
 * The counting and the filtering live here, out of the screen, because they are the
 * part that can be wrong quietly: a reorder banner that disagrees with the row badges
 * beside it is worse than no banner.
 */

const p = (over: Partial<StockRow> & { code: string }): StockRow => ({
  id: over.code, name: over.code, line: "", category: "OTHER",
  description: null, machine: null, location: null, photo_url: null,
  quantity: 10, min_stock: 3, price: 0, ...over,
});

describe("stockTotals", () => {
  it("counts the parts, the units, the low and the empty", () => {
    const t = stockTotals([
      p({ code: "6002", quantity: 4, min_stock: 3 }),
      p({ code: "6202", quantity: 0, min_stock: 3 }),
      p({ code: "6005", quantity: 44, min_stock: 3 }),
      p({ code: "BELT1", quantity: 3, min_stock: 3 }),
    ]);
    expect(t.parts).toBe(4);
    expect(t.inStock).toBe(51);
    // At the reorder point counts as reached — the same `<=` the row badge uses.
    expect(t.low).toBe(2);
    expect(t.out).toBe(1);
  });

  it("says nothing rather than dividing by an empty warehouse", () => {
    expect(stockTotals([])).toEqual({ parts: 0, inStock: 0, low: 0, out: 0 });
  });
});

describe("filterStock", () => {
  const rows = [
    p({ code: "6002", name: "6002", category: "BEARING", machine: "Blender 3", location: "A1", description: "Deep groove" }),
    p({ code: "BELT-88", name: "BELT-88", category: "BELT", line: "Line 6", description: null }),
    p({ code: "SEAL-2", name: "SEAL-2", category: "SEAL", quantity: 1, min_stock: 5 }),
  ];

  it("searches model, description, machine, line and location — the five the box promises", () => {
    expect(filterStock(rows, { query: "6002" }).map((r) => r.code)).toEqual(["6002"]);
    expect(filterStock(rows, { query: "deep groove" }).map((r) => r.code)).toEqual(["6002"]);
    expect(filterStock(rows, { query: "blender" }).map((r) => r.code)).toEqual(["6002"]);
    expect(filterStock(rows, { query: "line 6" }).map((r) => r.code)).toEqual(["BELT-88"]);
    expect(filterStock(rows, { query: "a1" }).map((r) => r.code)).toEqual(["6002"]);
  });

  it("ignores case and surrounding space, because a code is typed off a shelf label", () => {
    expect(filterStock(rows, { query: "  belt-88 " }).map((r) => r.code)).toEqual(["BELT-88"]);
  });

  it("narrows to one category without touching the search", () => {
    expect(filterStock(rows, { category: "BELT" }).map((r) => r.code)).toEqual(["BELT-88"]);
    expect(filterStock(rows, { category: "__all__" })).toHaveLength(3);
  });

  it("keeps only what reached the reorder point when asked", () => {
    expect(filterStock(rows, { lowOnly: true }).map((r) => r.code)).toEqual(["SEAL-2"]);
  });

  it("applies search, category and low together", () => {
    expect(filterStock(rows, { query: "seal", category: "SEAL", lowOnly: true })).toHaveLength(1);
    expect(filterStock(rows, { query: "seal", category: "BELT", lowOnly: true })).toHaveLength(0);
  });
});
