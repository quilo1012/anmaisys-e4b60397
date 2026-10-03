import { fetchAllRows } from "./fetchAllRows";

/**
 * Every row for a list of ids — not the first thousand, and not a request too long to send.
 *
 * Reading "the items belonging to these sessions" with one `.in("session_id", ids)` walks
 * into two walls at once, and the app had hit both:
 *
 * THE CAP. PostgREST answers an unbounded select with at most 1000 rows and says nothing
 * about it. SKU Efficiency at its 90-day setting asks for the items of 956 sessions, which
 * is 1367 rows; it got 1000. Rows arrive in the order they were made, so the thousand that
 * came back were the OLDEST — the whole of September and October fell off the end, 949,759
 * units, 28% of everything the factory has made. The ranking looked complete because every
 * SKU on it had a number next to it.
 *
 * THE URL. The id list travels in the query string. 956 UUIDs is roughly 35 kilobytes of
 * request line, and the proxies in front of a database cut that off with a 414 that reaches
 * the screen as a blank panel. `useAllocationMutations` already batched its deletes for
 * exactly this reason, with the reason written out; the read path never got the same.
 *
 * So: the ids go in chunks small enough to send, and each chunk is paged to the end.
 */

/**
 * Ids per request.
 *
 * Eighty UUIDs is about three kilobytes of query string, which leaves room for the select
 * list and the other filters beside it. The same figure the delete path settled on.
 */
export const ID_CHUNK = 80;

/** Splits a list into runs of at most `size`. */
export function chunksOf<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function fetchRowsByIds<T>(
  ids: readonly string[],
  /**
   * Build the read for one chunk of ids and one page of rows. The chunk goes in the
   * `.in(...)`, `from`/`to` go in `.range(...)`, and the chain needs an `.order(...)`
   * for the same reason every paged read does: two pages of an unordered result can
   * repeat a row and skip another.
   */
  range: (
    chunk: string[],
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: unknown }>,
  chunkSize = ID_CHUNK,
): Promise<T[]> {
  // Not a shortcut: `.in("session_id", [])` is a round trip that can only answer
  // "nothing", and the callers this replaces all guarded for it by hand.
  if (ids.length === 0) return [];

  // The same id twice would fetch its rows twice and double whatever is summed from
  // them. Callers build these lists from maps and arrays alike, so it is settled here
  // rather than trusted to each one.
  const unique = Array.from(new Set(ids));

  const out: T[] = [];
  for (const chunk of chunksOf(unique, chunkSize)) {
    out.push(...(await fetchAllRows<T>({ range: (from, to) => range(chunk, from, to) })));
  }
  return out;
}
