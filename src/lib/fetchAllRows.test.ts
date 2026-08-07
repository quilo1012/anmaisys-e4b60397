import { describe, it, expect, vi } from "vitest";
import { fetchAllRows } from "@/lib/fetchAllRows";

/** A table of `n` rows served the way PostgREST serves them, 1000 at a time. */
const fake = (n: number) => {
  const all = Array.from({ length: n }, (_, i) => ({ i }));
  return {
    calls: [] as Array<[number, number]>,
    range(from: number, to: number) {
      this.calls.push([from, to]);
      return Promise.resolve({ data: all.slice(from, to + 1), error: null });
    },
  };
};

describe("fetchAllRows", () => {
  it("reads past the thousand-row cap", async () => {
    // The headcount period holds 1524 allocations. Reading 1000 of them reported
    // Felipe Pinelli three shifts above his rota when he is six, and dropped Fabio
    // Silva off the list entirely.
    const q = fake(1524);
    const rows = await fetchAllRows(q);
    expect(rows).toHaveLength(1524);
    expect(q.calls).toEqual([[0, 999], [1000, 1999]]);
  });

  it("stops on the first short page", async () => {
    const q = fake(250);
    expect(await fetchAllRows(q)).toHaveLength(250);
    expect(q.calls).toHaveLength(1);
  });

  it("costs one extra read when the total lands exactly on a page", async () => {
    // A full page might be the end. The next read returns nothing and the loop stops
    // — one round trip, never a lost row.
    const q = fake(2000);
    expect(await fetchAllRows(q)).toHaveLength(2000);
    expect(q.calls).toHaveLength(3);
  });

  it("is empty for an empty table, without looping", async () => {
    const q = fake(0);
    expect(await fetchAllRows(q)).toEqual([]);
    expect(q.calls).toHaveLength(1);
  });

  it("throws rather than returning a partial answer", async () => {
    // A half-read that looks like a whole one is the bug this exists to stop.
    const q = {
      range: vi.fn()
        .mockResolvedValueOnce({ data: Array.from({ length: 1000 }, (_, i) => ({ i })), error: null })
        .mockResolvedValueOnce({ data: null, error: new Error("network") }),
    };
    await expect(fetchAllRows(q as any)).rejects.toThrow("network");
  });

  it("stops at the ceiling instead of paging for ever", async () => {
    const q = fake(10_000);
    expect(await fetchAllRows(q, 3000)).toHaveLength(3000);
  });
});
