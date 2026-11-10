/**
 * Folds a burst of calls into one, fired `waitMs` after the last call of the burst —
 * and never later than `maxWaitMs` after the first, so a steady stream of calls cannot
 * hold the work off indefinitely.
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
export function coalesceCalls(
  fn: () => void,
  waitMs = 500,
  maxWaitMs = 2_000,
): { (): void; cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let firstAt: number | null = null;
  const fire = () => {
    timer = null;
    firstAt = null;
    fn();
  };
  const call = () => {
    const now = Date.now();
    if (firstAt === null) firstAt = now;
    if (timer !== null) clearTimeout(timer);
    const delay = Math.max(0, Math.min(waitMs, firstAt + maxWaitMs - now));
    timer = setTimeout(fire, delay);
  };
  call.cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    firstAt = null;
  };
  return call;
}
