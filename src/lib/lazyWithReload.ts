import { lazy, type ComponentType } from "react";

/**
 * Wraps React.lazy so that when a dynamic-import chunk fails to load
 * (typical after a new deploy invalidates the previous hashed chunk),
 * we automatically hard-reload the page ONCE to fetch the fresh chunks
 * instead of showing the ErrorBoundary fallback.
 */
const RELOAD_KEY = "__lovable_chunk_reload_at";

function isChunkLoadError(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message || err || "");
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Loading chunk .* failed/i.test(
    msg,
  );
}

export function lazyWithReload<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
) {
  return lazy(async () => {
    try {
      return await factory();
    } catch (err) {
      if (isChunkLoadError(err)) {
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
      }
      throw err;
    }
  });
}
