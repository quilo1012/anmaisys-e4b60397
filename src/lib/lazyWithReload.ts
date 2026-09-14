import { lazy, type ComponentType } from "react";
import { isChunkLoadError, RELOAD_KEY } from "@/lib/chunkCrashEvidence";

/**
 * Wraps React.lazy so that when a dynamic-import chunk fails to load
 * (typical after a new deploy invalidates the previous hashed chunk),
 * we retry, and then hard-reload the page ONCE to fetch the fresh chunks
 * instead of showing the ErrorBoundary fallback.
 *
 * WHY THE RETRY EXISTS, and not just the reload it used to be:
 *
 * The reload alone assumes the new build is finished and waiting. On the preview
 * host it usually is not — index.html is regenerated the moment an edit lands,
 * while the chunk it names is still going up. A reload that arrives inside that
 * window fails on the same import a second time, the once-a-minute throttle below
 * refuses to reload again, and the error reaches the ErrorBoundary as a REACT_CRASH
 * — which is what 06/09 19:50 and 07/09 16:30 are. The screen was never broken;
 * the page was standing in the gap between two builds.
 *
 * Two short retries cover that gap without throwing away the user's page at all,
 * and the reload stays as the answer to the case the retries cannot fix: an
 * index.html in this tab so old that the chunk it asks for is genuinely gone.
 *
 * `isChunkLoadError` and `RELOAD_KEY` live in `chunkCrashEvidence`, which is where the
 * ErrorBoundary asks what a failed chunk answers now — one definition of what counts
 * as a chunk failure, and one key, so the two cannot drift apart.
 */

/** Both waits together are under two seconds, which is inside a Suspense fallback. */
const RETRY_DELAYS_MS = [600, 1500];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function lazyWithReload<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
) {
  return lazy(async () => {
    let lastErr: unknown;

    // The first attempt plus one per delay. A non-chunk error (a real crash inside
    // the module) breaks out immediately — retrying that only delays the truth.
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        return await factory();
      } catch (err) {
        lastErr = err;
        if (!isChunkLoadError(err)) throw err;
        if (attempt < RETRY_DELAYS_MS.length) await sleep(RETRY_DELAYS_MS[attempt]);
      }
    }

    try {
      const last = Number(sessionStorage.getItem(RELOAD_KEY) || "0");
      // Only auto-reload once per minute to avoid infinite loops.
      if (Date.now() - last > 60_000) {
        sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
        window.location.reload();
        // Return a never-resolving promise so React keeps the Suspense
        // fallback visible while the page reloads.
        return await new Promise<{ default: T }>(() => {});
      }
    } catch {
      /* sessionStorage unavailable — fall through and rethrow */
    }

    throw lastErr;
  });
}
