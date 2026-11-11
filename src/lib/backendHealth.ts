/**
 * What the client does when the backend stalls (audit 2026-11-11, PERF-001 / API-017).
 *
 * Production runs on a 1 GB Micro instance that stalls for seconds at a time:
 * statement timeouts (57014), the schema cache dropping (PGRST002, a 503), gateway
 * 5xx, requests that never come back. Before this file every client made it worse:
 *
 *   - the QueryClient `retry` looked for `error.status`, which the error supabase-js
 *     hands to `if (error) throw error` does not have (it is `{ message, details,
 *     hint, code }`), so every failure — refusals included — was fetched three times;
 *   - polling kept its rhythm against a server that was not answering;
 *   - each failure inserted a telemetry row and rang the admin's "System error" bell.
 *
 * Three things live here:
 *
 *   1. `shouldRetry` / `retryDelay` — decided by the error's `code`, or the HTTP status
 *      when one travels (`status`, `statusCode`, or `context.status` on a
 *      FunctionsHttpError). Refusals and client errors are never retried; a stall is
 *      retried at most once, 1–3 s later with jitter.
 *
 *   2. Degraded mode — `noteBackendError` is fed by the QueryCache / MutationCache
 *      `onError`. DEGRADED_THRESHOLD stall-class errors within DEGRADED_WINDOW_MS put
 *      the client in degraded mode for DEGRADED_HOLD_MS. App.tsx answers that by
 *      telling React Query's focusManager the window is unfocused, which is the switch
 *      `refetchInterval` already obeys (queryObserver only fires an interval tick when
 *      `refetchIntervalInBackground || focusManager.isFocused()`).
 *
 *      Not onlineManager: offline would ALSO pause every mutation (a Save would hang
 *      until the window ends, mutation.js checks `canFetch` before it starts) and
 *      every brand-new query, and `refetchOnReconnect` would then fire them all at
 *      once. An unfocused focusManager only stops what fires on its own — intervals
 *      and retries; a screen the person opens still asks once, and a Save still saves.
 *      Nothing in src reads either manager, so the app's offline banner (which reads
 *      navigator.onLine through useOfflineDetection) is not affected.
 *
 *   3. `allowDegradedReport` — while degraded, at most one stall-class telemetry row
 *      and one stall-class toast per client per minute. The first one is kept;
 *      anything that is not the stall (a refusal, a constraint) is never dropped.
 */

export const DEGRADED_THRESHOLD = 3;
export const DEGRADED_WINDOW_MS = 30_000;
export const DEGRADED_HOLD_MS = 60_000;
export const DEGRADED_REPORT_EVERY_MS = 60_000;

type ErrorLike = {
  name?: unknown;
  message?: unknown;
  code?: unknown;
  hint?: unknown;
  status?: unknown;
  statusCode?: unknown;
  context?: { status?: unknown } | null;
} | null | undefined;

function httpStatus(error: unknown): number | undefined {
  const e = error as ErrorLike;
  const candidates = [e?.status, e?.statusCode, e?.context?.status];
  for (const c of candidates) if (typeof c === "number" && c > 0) return c;
  return undefined;
}

function codeOf(error: unknown): string {
  const c = (error as ErrorLike)?.code;
  return typeof c === "string" ? c : "";
}

/** Refusals, bad input, "no rows", and anything the server answered 4xx. Retrying changes nothing. */
const NEVER_RETRY_CODES = new Set(["42501", "PGRST301", "PGRST302", "PGRST303", "PGRST116", "P0001"]);

function isClientError(error: unknown): boolean {
  const code = codeOf(error);
  if (NEVER_RETRY_CODES.has(code)) return true;
  // 22xxx data exception, 23xxx integrity constraint violation.
  if (/^2[23]/.test(code)) return true;
  const status = httpStatus(error);
  return status !== undefined && status >= 400 && status < 500;
}

/** Messages a fetch that never got an answer arrives with, raw or wrapped by postgrest-js. */
const NETWORK_MESSAGE = /failed to fetch|networkerror|load failed|network request failed|fetcherror|timeouterror|aborterror/i;

function isNetworkError(error: unknown): boolean {
  const e = error as ErrorLike;
  const name = typeof e?.name === "string" ? e.name : "";
  if (name === "FunctionsFetchError" || name === "FunctionsRelayError") return true;
  if (name === "TimeoutError") return true;
  const message = typeof e?.message === "string" ? e.message : "";
  if (NETWORK_MESSAGE.test(message)) return true;
  // postgrest-js turns an aborted/timed-out fetch into code "" with this hint.
  const hint = typeof e?.hint === "string" ? e.hint : "";
  return /request was aborted/i.test(hint);
}

/** The backend is struggling, rather than the request being wrong. */
export function isDegradedError(error: unknown): boolean {
  if (!error) return false;
  const code = codeOf(error);
  if (code === "57014" || code === "PGRST002") return true;
  // 53xxx insufficient resources, 08xxx connection exception.
  if (/^(53|08)/.test(code)) return true;
  const status = httpStatus(error);
  if (status !== undefined && status >= 500) return true;
  if (isClientError(error)) return false;
  return isNetworkError(error);
}

/**
 * React Query `retry`. Pure: the same error always gives the same answer.
 * A refusal or client error: never. Anything else: once.
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (isClientError(error)) return false;
  return failureCount < 1;
}

/** 1–3 s, jittered, so a room of tablets that failed together do not retry together. */
export function retryDelay(_attempt: number): number {
  return 1000 + Math.floor(Math.random() * 2001);
}

// ── Degraded mode ────────────────────────────────────────────────────────────

let recentStalls: number[] = [];
let degraded = false;
let exitTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<(degraded: boolean) => void>();
const lastReport: Record<"telemetry" | "toast", number | undefined> = { telemetry: undefined, toast: undefined };

function setDegraded(next: boolean) {
  if (degraded === next) return;
  degraded = next;
  for (const l of listeners) {
    try { l(next); } catch { /* a listener must not break the error path */ }
  }
}

/** Feed every query / mutation error here. Only stall-class errors count. */
export function noteBackendError(error: unknown, now: number = Date.now()): void {
  if (!isDegradedError(error)) return;
  recentStalls = recentStalls.filter((t) => now - t < DEGRADED_WINDOW_MS);
  recentStalls.push(now);
  if (degraded || recentStalls.length < DEGRADED_THRESHOLD) return;
  setDegraded(true);
  exitTimer = setTimeout(() => {
    exitTimer = null;
    setDegraded(false);
  }, DEGRADED_HOLD_MS);
}

export function isBackendDegraded(): boolean {
  return degraded;
}

/** Called with `true` on entering degraded mode and `false` on leaving it. Returns an unsubscribe. */
export function onDegradedChange(listener: (degraded: boolean) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * May a stall-class error be reported (telemetry row / toast) now?
 * Healthy: always — and the time is remembered, so the report made just before the
 * client tipped into degraded mode counts as the minute's first. Degraded: one per
 * channel per DEGRADED_REPORT_EVERY_MS. Callers only ask for stall-class errors.
 */
export function allowDegradedReport(channel: "telemetry" | "toast", now: number = Date.now()): boolean {
  const last = lastReport[channel];
  if (degraded && last !== undefined && now - last < DEGRADED_REPORT_EVERY_MS) return false;
  lastReport[channel] = now;
  return true;
}

/** How often a screen that polls even when unfocused polls while degraded. */
export const DEGRADED_POLL_MS = 120_000;

/**
 * `refetchInterval` for a query with `refetchIntervalInBackground: true` (the 24/7 line
 * walls), which the focusManager switch cannot reach. React Query recomputes a function
 * interval after every fetch, so the wall slows to DEGRADED_POLL_MS on its next result
 * and returns to `ms` on the first result after the window ends.
 */
export function pollEvery(ms: number): () => number {
  return () => (degraded ? Math.max(ms, DEGRADED_POLL_MS) : ms);
}

/** Test seam: all of the above is module state. */
export function resetBackendHealth(): void {
  if (exitTimer) clearTimeout(exitTimer);
  exitTimer = null;
  recentStalls = [];
  lastReport.telemetry = undefined;
  lastReport.toast = undefined;
  setDegraded(false);
}
