import { lazy, type ComponentType } from "react";
import { chunkUrlFrom, isChunkLoadError, RELOAD_KEY } from "@/lib/chunkCrashEvidence";

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
 * WHY THE RETRY ASKS FOR A DIFFERENT ADDRESS, and not the same one again:
 *
 * Calling `factory()` twice does not fetch twice. The document's module map keys
 * on the URL and stores the *outcome* of the first fetch, failure included, so the
 * second `import()` of that specifier returns the same rejection immediately and
 * without a request. The two waits below were being spent on a result that was
 * already decided. What hid it was the test: it replaced `factory` with a function
 * free to fail once and succeed next; a real `import()` has no such freedom.
 *
 * 17/09 16:11 is what that costs. Three REACT_CRASH in fourteen seconds across two
 * chunks, every one of them with `chunkStatus: 200` and `entryIsStale: false` — the
 * file was being served and the tab was on the current build. Only that one fetch
 * had failed, and nothing afterwards could undo it while the address stayed the
 * same.
 *
 * So the retries re-import the chunk under a `?reload=` query. A different URL is a
 * different module-map entry and therefore a real request. The host serves the same
 * file (static hosts ignore the query), the chunk's own static imports carry no
 * query and stay shared, and the CSS `<link>`s Vite's preload helper injected on
 * the first attempt are already in the document. When the message carries no URL to
 * re-ask for, we fall back to calling `factory` again, which is no worse than before.
 *
 * `isChunkLoadError`, `chunkUrlFrom` and `RELOAD_KEY` live in `chunkCrashEvidence`,
 * which is where the ErrorBoundary asks what a failed chunk answers now — one
 * definition of what counts as a chunk failure, one way of reading its address, and
 * one key, so they cannot drift apart.
 */

/** Both waits together are under two seconds, which is inside a Suspense fallback. */
const RETRY_DELAYS_MS = [600, 1500];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The same chunk under an address the module map has not got yet. */
function bustedUrl(url: string, attempt: number): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}reload=${attempt}-${Date.now()}`;
}

export interface LazyWithReloadOptions {
  /** Seam for the tests: how a chunk is re-requested by address. */
  importUrl?: (url: string) => Promise<unknown>;
}

const importByUrl = (url: string): Promise<unknown> =>
  import(/* @vite-ignore */ url);

export function lazyWithReload<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
  options?: LazyWithReloadOptions,
) {
  const importUrl = options?.importUrl ?? importByUrl;

  return lazy(async () => {
    let lastErr: unknown;
    // The address the FIRST failure named. Later attempts carry a `?reload=` of
    // their own in the message, and re-asking for those would stack query strings.
    let chunkUrl: string | null = null;

    // The first attempt plus one per delay. A non-chunk error (a real crash inside
    // the module) breaks out immediately — retrying that only delays the truth.
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        // No address in the message: nothing to re-ask for, so ask the same way
        // again rather than not at all.
        if (attempt === 0 || !chunkUrl) return await factory();
        return (await importUrl(bustedUrl(chunkUrl, attempt))) as { default: T };
      } catch (err) {
        lastErr = err;
        if (!isChunkLoadError(err)) throw err;
        if (attempt === 0) chunkUrl = chunkUrlFrom(err);
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
