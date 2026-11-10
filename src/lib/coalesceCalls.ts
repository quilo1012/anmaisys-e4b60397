/**
 * Folds a burst of calls into one, fired `waitMs` after the last call of the burst.
 *
 * For realtime handlers. A `postgres_changes` subscription fires once per changed row,
 * so a bulk write — the iTouching poll closing orders, a board re-allocation — arrives
 * as a burst of events. Each event used to start a refetch, and React Query's
 * `invalidateQueries`/`refetch` cancel the request already in flight before starting
 * the next one: the browser drops the response, the database still runs every query.
 * One refetch after the burst reads the same final state.
 *
 * `cancel()` drops a pending call; use it in the effect's cleanup.
 */
export function coalesceCalls(fn: () => void, waitMs = 500): { (): void; cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const call = () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn();
    }, waitMs);
  };
  call.cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  return call;
}
