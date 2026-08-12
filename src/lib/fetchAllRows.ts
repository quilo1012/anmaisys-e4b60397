/**
 * Every row, not the first thousand.
 *
 * PostgREST caps an unbounded select at 1000 rows and says nothing about it — no
 * error, no flag, just a shorter array. A screen that adds the rows up gets an answer
 * that looks like an answer.
 *
 * The headcount period holds 1524 allocations. The overtime panel read 1000 of them
 * and reported Felipe Pinelli three shifts above his rota when he is six, and dropped
 * Fabio Silva, also six, off the list entirely — the rows it needed were the ones past
 * the cut. Nothing on screen suggested a number was missing.
 *
 * Ordering matters as much as paging: without an ORDER BY, two pages of an unordered
 * result can repeat a row and skip another. The caller gives the column to order by.
 */
const PAGE = 1000;

export interface PagedQuery<T> {
  /**
   * Fetch rows [from, to] inclusive, as PostgREST's `.range()` takes them.
   *
   * `PromiseLike`, not `Promise`: a PostgrestFilterBuilder is a thenable and nothing
   * more — it has no `catch` or `finally` until it is awaited. Typed as `Promise` it
   * failed to assign, and the way out every caller reached for was `supabase as any`,
   * which throws away the column types of the very select being paged. `await` takes
   * a thenable natively, so the loop below is unchanged.
   */
  range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>;
}

/**
 * Reads pages until one comes back short.
 *
 * A short page is the end. A full page might be the end too — the next read then
 * returns nothing and the loop stops, which costs one extra round trip and never
 * costs a row.
 */
export async function fetchAllRows<T>(q: PagedQuery<T>, maxRows = 100_000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < maxRows; from += PAGE) {
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}
