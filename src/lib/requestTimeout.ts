/**
 * A deadline on every data request.
 *
 * The Supabase client is generated and carries no `global.fetch` of its own, and
 * neither of the two existing fetch wrappers imposed a deadline — so a request
 * that left the tablet and never came back waited for the TCP timeout. On a
 * factory access point that is the normal failure, not the exception: the tablet
 * stays associated, `navigator.onLine` stays true, and the request simply hangs.
 * The screen's Save button sat disabled for a minute and a half, which from the
 * line looks exactly like an app that has died.
 *
 * Failing in fifteen seconds is not a fix for a bad network. It is what lets the
 * screen SAY something — the mutation rejects, `queryErrors` files it, the toast
 * appears, the button comes back — instead of leaving the operator guessing.
 *
 * WHAT IS COVERED
 *   /rest/v1/…      PostgREST reads and writes, including /rest/v1/rpc/
 *   /functions/v1/… edge functions
 *
 * WHAT IS DELIBERATELY NOT
 *   /auth/v1/…    a token refresh that is aborted takes the session with it, and
 *                 the shared-tablet recovery in AuthContext already has its own
 *                 handling for a slow one.
 *   /storage/v1/… a WO photo from a phone is a real upload over a bad uplink;
 *                 fifteen seconds is not generous, it is wrong.
 *   realtime      a websocket, not fetch.
 *
 * INSTALL ORDER MATTERS. This must be installed FIRST, before `installStaleJwtRetry`
 * and `installApiErrorTelemetry`, so it ends up INNERMOST: each JWT retry attempt
 * then gets its own fifteen seconds rather than the pair of them sharing one.
 */

/** Long enough for a slow report query, short enough that a person is still waiting. */
export const REQUEST_TIMEOUT_MS = 15_000;

const TIMED_PATHS = /\/rest\/v1\/|\/functions\/v1\//;

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return (input as Request).url;
}

export function installRequestTimeout(): void {
  if (typeof window === "undefined" || typeof window.fetch !== "function") return;
  const w = window as unknown as { __requestTimeoutInstalled?: boolean };
  if (w.__requestTimeoutInstalled) return;
  w.__requestTimeoutInstalled = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let url = "";
    try {
      url = urlOf(input);
    } catch {
      return originalFetch(input, init);
    }
    if (!TIMED_PATHS.test(url)) return originalFetch(input, init);

    // A caller that brought its own signal keeps it: whichever fires first wins.
    // `AbortSignal.any` is not in every browser this runs on, so the two are
    // joined by hand through a controller.
    const controller = new AbortController();
    const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : null);

    const timer = setTimeout(() => {
      controller.abort(
        new DOMException(
          `The server did not answer within ${Math.round(REQUEST_TIMEOUT_MS / 1000)}s.`,
          "TimeoutError",
        ),
      );
    }, REQUEST_TIMEOUT_MS);

    const onCallerAbort = () => controller.abort(callerSignal?.reason);
    if (callerSignal) {
      if (callerSignal.aborted) controller.abort(callerSignal.reason);
      else callerSignal.addEventListener("abort", onCallerAbort, { once: true });
    }

    return originalFetch(input, { ...init, signal: controller.signal }).finally(() => {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", onCallerAbort);
    });
  };
}
