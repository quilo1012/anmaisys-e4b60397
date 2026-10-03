import { describe, expect, it } from "vitest";
import { chunksOf, fetchRowsByIds, ID_CHUNK } from "./fetchRowsByIds";

/**
 * A fake PostgREST: holds rows against ids, answers only what the chunk asked for, and
 * honours `.range()` the way the server does — at most 1000 rows, however many match.
 */
function server(rowsById: Record<string, number>) {
  const asked: Array<{ chunk: string[]; from: number; to: number }> = [];
  const all = Object.entries(rowsById).flatMap(([id, n]) =>
    Array.from({ length: n }, (_, i) => ({ id, seq: i })),
  );
  const range = (chunk: string[], from: number, to: number) => {
    asked.push({ chunk, from, to });
    const mine = all.filter((r) => chunk.includes(r.id));
    // The cap applies to what the server sends, not to what the caller wrote.
    const page = mine.slice(from, Math.min(to + 1, from + 1000));
    return Promise.resolve({ data: page, error: null });
  };
  return { range, asked, total: all.length };
}

describe("fetchRowsByIds", () => {
  /**
   * The failure this exists for. SKU Efficiency asked for the items of 956 sessions,
   * 1367 rows, and the server sent 1000 — oldest first, so September and October were
   * the part that went missing, on the page people read production off.
   */
  it("returns every row when there are more than a thousand", async () => {
    const ids = Array.from({ length: 956 }, (_, i) => `s${i}`);
    const rows: Record<string, number> = {};
    for (const id of ids) rows[id] = 1;
    // 411 of the sessions made a second item, which is what carries it over the cap.
    for (let i = 0; i < 411; i++) rows[`s${i}`] = 2;
    const s = server(rows);
    expect(s.total).toBe(1367);

    const out = await fetchRowsByIds(ids, s.range);
    expect(out).toHaveLength(1367);
  });

  it("never puts more than a chunk of ids in one request", async () => {
    const ids = Array.from({ length: 956 }, (_, i) => `s${i}`);
    const s = server(Object.fromEntries(ids.map((i) => [i, 1])));
    await fetchRowsByIds(ids, s.range);
    // 956 UUIDs in one query string is ~35kB of request line and a 414 from the proxy.
    for (const a of s.asked) expect(a.chunk.length).toBeLessThanOrEqual(ID_CHUNK);
    expect(s.asked.length).toBeGreaterThan(1);
  });

  it("covers every id exactly once across the requests", async () => {
    // A chunk boundary that drops or repeats an id is the error this helper would
    // otherwise introduce: a missing session is silent, a repeated one doubles a total.
    const ids = Array.from({ length: 243 }, (_, i) => `s${i}`);
    const s = server(Object.fromEntries(ids.map((i) => [i, 1])));
    await fetchRowsByIds(ids, s.range);
    const sent = s.asked.flatMap((a) => a.chunk);
    expect(sent.slice().sort()).toEqual(ids.slice().sort());
  });

  it("asks for a page at a time, from the start", async () => {
    const s = server({ a: 1 });
    await fetchRowsByIds(["a"], s.range);
    expect(s.asked[0].from).toBe(0);
    expect(s.asked[0].to).toBe(999);
  });

  it("counts an id written twice once", async () => {
    // `ids` comes from a map's keys in some callers and a plain array in others. A
    // duplicate would fetch its rows a second time and double whatever is summed.
    const s = server({ a: 3 });
    const out = await fetchRowsByIds(["a", "a", "a"], s.range);
    expect(out).toHaveLength(3);
  });

  it("sends nothing at all for an empty list", async () => {
    const s = server({ a: 1 });
    expect(await fetchRowsByIds([], s.range)).toEqual([]);
    expect(s.asked).toHaveLength(0);
  });

  it("throws what the server said rather than reporting no rows", async () => {
    // An error read as an empty answer is the shape of every wrong zero in this app.
    await expect(
      fetchRowsByIds(["a"], () => Promise.resolve({ data: null, error: { message: "boom" } })),
    ).rejects.toEqual({ message: "boom" });
  });

  it("takes a smaller chunk when a caller asks for one", async () => {
    const ids = Array.from({ length: 10 }, (_, i) => `s${i}`);
    const s = server(Object.fromEntries(ids.map((i) => [i, 1])));
    await fetchRowsByIds(ids, s.range, 3);
    expect(s.asked.map((a) => a.chunk.length)).toEqual([3, 3, 3, 1]);
  });
});

describe("chunksOf", () => {
  it("keeps the order and loses nothing", () => {
    expect(chunksOf([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("has nothing to split in an empty list", () => {
    expect(chunksOf([], 10)).toEqual([]);
  });

  it("gives one chunk when everything fits", () => {
    expect(chunksOf([1, 2], 10)).toEqual([[1, 2]]);
  });
});
