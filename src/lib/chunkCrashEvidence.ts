/**
 * What actually stopped a lazy screen from downloading.
 *
 * `Failed to fetch dynamically imported module: …/MyProductionPage-DvfHMdmg.js` is
 * the same sentence for two unrelated situations, and on 10/09 the log could not tell
 * an operator's dead screen apart from a passing Wi-Fi drop:
 *
 *  - the tab is holding an index.html older than the last deploy. This host removes
 *    the previous build — the chunk from that crash and the entry bundle that named
 *    it both answer 404 today — so every screen that tab has not already loaded is
 *    permanently gone, and only a reload onto the new index.html brings it back;
 *  - the network faltered for a second. Nothing is missing and reloading throws away
 *    the operator's page for no reason.
 *
 * `lazyWithReload` retries twice and then reloads once, and the ErrorBoundary reloads
 * again if the served entry differs from the running one. On 10/09 the crash arrived
 * anyway, twice, six seconds apart and both times on the same entry bundle — so
 * whichever of those was true, neither reload took. Guessing a third time is how you
 * get a reload loop. These are the two questions whose answers separate the cases, so
 * the next occurrence explains itself instead of being re-derived from a message that
 * cannot carry it.
 */

/** A failed dynamic import, in each of the shapes the browsers word it. */
export function isChunkLoadError(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message || err || "");
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Loading chunk .* failed/i.test(
    msg,
  );
}

/** Where `lazyWithReload` records that it has already spent its one reload. */
export const RELOAD_KEY = "__lovable_chunk_reload_at";

export interface ChunkCrashEvidence {
  chunkUrl?: string | null;
  /** The HTTP status the chunk answers now, or "unreachable" when the request failed. */
  chunkStatus?: number | "unreachable" | null;
  runningEntry?: string | null;
  servedEntry?: string | null;
  /** True when index.html has moved on from the bundle this page is running. */
  entryIsStale?: boolean | null;
  online?: boolean;
  reloadedAlready?: boolean;
}

const PROBE_TIMEOUT_MS = 4000;

function urlFrom(err: unknown): string | null {
  const msg = String((err as { message?: string })?.message || err || "");
  return /(https?:\/\/[^\s"')]+)/.exec(msg)?.[1] ?? null;
}

function pathOf(src: string | null | undefined): string | null {
  if (!src) return null;
  try {
    return new URL(src, location.href).pathname;
  } catch {
    return src;
  }
}

/** The hashed entry bundle this page is running, from its own <script type="module">. */
function runningEntry(): string | null {
  const src = Array.from(document.querySelectorAll<HTMLScriptElement>('script[type="module"][src]'))
    .map((s) => s.src)
    .find((s) => /\/assets\/.*\.js/.test(s));
  return pathOf(src);
}

/** The entry bundle index.html names right now — asked past every cache. */
async function servedEntry(signal: AbortSignal): Promise<string | null> {
  const res = await fetch(`/index.html?_=${Date.now()}`, { cache: "no-store", signal });
  if (!res.ok) return null;
  const html = await res.text();
  const src = /<script[^>]+type="module"[^>]+src="([^"]*\/assets\/[^"]+\.js)"/i.exec(html)?.[1];
  return pathOf(src);
}

/**
 * Ask both questions, and never let asking them cost more than the answer is worth:
 * this runs inside a crash handler, so every probe is timed out and every failure is
 * an answer of its own rather than a second error on top of the first.
 */
export async function chunkCrashEvidence(err: unknown): Promise<ChunkCrashEvidence> {
  if (!isChunkLoadError(err)) return {};

  const evidence: ChunkCrashEvidence = {
    chunkUrl: urlFrom(err),
    chunkStatus: null,
    runningEntry: null,
    servedEntry: null,
    entryIsStale: null,
    online: typeof navigator !== "undefined" ? navigator.onLine !== false : true,
    reloadedAlready: false,
  };

  try {
    evidence.reloadedAlready = Number(sessionStorage.getItem(RELOAD_KEY) || "0") > 0;
  } catch { /* storage blocked — leave it false */ }

  try {
    evidence.runningEntry = runningEntry();
  } catch { /* no entry to find, e.g. the dev server */ }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), PROBE_TIMEOUT_MS);
  try {
    if (evidence.chunkUrl) {
      try {
        const res = await fetch(evidence.chunkUrl, { method: "HEAD", cache: "no-store", signal: ac.signal });
        evidence.chunkStatus = res.status;
      } catch {
        // A rejected fetch is the network answering, and it is the answer that says
        // "nothing is missing" — the one a 404 cannot mean.
        evidence.chunkStatus = "unreachable";
      }
    }
    try {
      evidence.servedEntry = await servedEntry(ac.signal);
    } catch {
      evidence.servedEntry = null;
    }
  } finally {
    clearTimeout(timer);
  }

  if (evidence.runningEntry && evidence.servedEntry) {
    evidence.entryIsStale = evidence.runningEntry !== evidence.servedEntry;
  }

  return evidence;
}
