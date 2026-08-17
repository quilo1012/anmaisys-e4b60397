import { describe, expect, it } from "vitest";
import { fetchAllRows, type PagedQuery } from "@/lib/fetchAllRows";

/**
 * The helper that decides whether every paged figure in this app is complete.
 *
 * PostgREST caps an unbounded select at 1000 rows and says nothing — no error, no
 * flag, just a shorter array. Every screen that pages through this helper is trusting
 * it to be the one place that knows that, and until now it had no test of its own.
 *
 * The real cost is on record: the overtime panel read 1000 of 1524 allocations and
 * reported one person three shifts above their rota and dropped another off the list
 * entirely. Nothing on screen suggested a number was missing.
 */

/** A fake table of `n` rows, answering `.range()` the way PostgREST does. */
function table(n: number): PagedQuery<number> & { calls: Array<[number, number]> } {
  const calls: Array<[number, number]> = [];
  return {
    calls,
    range: (from, to) => {
      calls.push([from, to]);
      const rows = Array.from({ length: n }, (_, i) => i).slice(from, to + 1);
      return Promise.resolve({ data: rows, error: null });
    },
  };
}

describe("fetchAllRows", () => {
  it("returns a short first page in one read", async () => {
    const t = table(42);
    expect(await fetchAllRows(t)).toHaveLength(42);
    expect(t.calls).toEqual([[0, 999]]);
  });

  it("keeps reading past the 1000-row cap, which is the whole point", async () => {
    const t = table(2500);
    const rows = await fetchAllRows(t);
    expect(rows).toHaveLength(2500);
    // No row read twice and none skipped: the pages have to tile exactly.
    expect(new Set(rows).size).toBe(2500);
    expect(t.calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("spends one extra read when the last page is exactly full", async () => {
    // 2000 rows means page two is full and looks like there may be more. One empty
    // read is the price of never dropping a row, and the doc comment says so.
    const t = table(2000);
    expect(await fetchAllRows(t)).toHaveLength(2000);
    expect(t.calls).toHaveLength(3);
  });

  it("treats an empty table as empty, not as a failure", async () => {
    expect(await fetchAllRows(table(0))).toEqual([]);
  });

  it("reads null data as no rows", async () => {
    const q: PagedQuery<number> = { range: () => Promise.resolve({ data: null, error: null }) };
    expect(await fetchAllRows(q)).toEqual([]);
  });

  it("throws the error instead of returning a short list", async () => {
    // The failure that matters: a rejected page must never look like the end of the
    // table. Returning what it had would be the silent truncation this exists to stop.
    const q: PagedQuery<number> = {
      range: () => Promise.resolve({ data: null, error: { message: "boom" } }),
    };
    await expect(fetchAllRows(q)).rejects.toEqual({ message: "boom" });
  });

  it("stops at maxRows so a runaway table cannot spin forever", async () => {
    const t = table(10_000);
    expect(await fetchAllRows(t, 2000)).toHaveLength(2000);
    expect(t.calls).toEqual([[0, 999], [1000, 1999]]);
  });
});
