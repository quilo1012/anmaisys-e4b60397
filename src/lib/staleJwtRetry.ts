import { supabase } from "@/integrations/supabase/client";

/**
 * One retry for the request that went out a second too late.
 *
 * supabase-js refreshes the access token on a timer and again when the tab becomes
 * visible. A tablet that has been asleep on a dashboard all night does both at once
 * on waking: the browser un-throttles the timers, react-query refetches everything on
 * focus, and the refresh is a round trip behind. Whichever query wins that race goes
 * out carrying the token that expired in the night, and PostgREST answers
 *
 *     401  {"code":"PGRST303","message":"JWT expired"}
 *
 * which is what /dashboard/shift-history logged at 05:58 on 14/09 — filed as an
 * RLS_ERROR, on a GET of `lines` that nobody was ever denied.
 *
 * The client can settle this by itself, and there is no safer refusal to retry:
 * PostgREST validates the JWT before it reaches the database, so a PGRST303 request
 * had no effect at all and re-issuing it cannot repeat one. That is why the retry is
 * not limited to reads — the write that lost the same race deserves it more.
 *
 * What it deliberately does NOT do:
 *
 *  - Retry any other 401. A real denial (42501, a revoked role, a missing policy) is a
 *    fault and has to reach `apiErrorTelemetry` intact. Only PGRST303 is a clock.
 *  - Retry twice. If the fresh token is refused as well, the session is genuinely gone
 *    and the 401 goes through to the screen and the log, as it should.
 *  - Log the recovery. A refresh that fails still surfaces the original 401, so the
 *    case worth seeing is still recorded; a race the client won is not an event.
 *
 * INSTALL ORDER MATTERS. This wraps fetch first and `installApiErrorTelemetry` wraps
 * it second, so telemetry sees the outcome rather than the attempt. Swap them and
 * every recovered request is still filed as a fault, which is the bug this fixes.
 */

const STALE_JWT = "PGRST303";

/** One refresh for a whole burst: fifteen queries wake together and share the wait. */
let refreshing: Promise<string | null> | null = null;

function refreshOnce(): Promise<string | null> {
  if (!refreshing) {
    refreshing = supabase.auth
      .refreshSession()
      .then((r) => r?.data?.session?.access_token ?? null)
      .catch(() => null)
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

async function isStaleJwt(res: Response): Promise<boolean> {
  if (res.status !== 401) return false;
  try {
    // A clone, so the caller still gets an unread body if we hand this response back.
    const body = JSON.parse(await res.clone().text()) as { code?: string };
    return body?.code === STALE_JWT;
  } catch {
    return false;
  }
}

export function installStaleJwtRetry(): void {
  if (typeof window === "undefined" || typeof window.fetch !== "function") return;
  const w = window as unknown as { __staleJwtRetryInstalled?: boolean };
  if (w.__staleJwtRetryInstalled) return;
  w.__staleJwtRetryInstalled = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const res = await originalFetch(input, init);
    try {
      if (res.status !== 401) return res;

      const url =
        typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
      // Data and edge-function calls only. The auth endpoint is how the refresh itself
      // travels, and a 401 from it is the answer, not a race.
      if (!/\/rest\/v1\/|\/functions\/v1\//.test(url)) return res;

      // A Request object may already have had its body read by the time we get here;
      // supabase-js always calls fetch(url, init), so this costs nothing real.
      if (typeof input !== "string" && !(input instanceof URL)) return res;

      if (!(await isStaleJwt(res))) return res;

      const token = await refreshOnce();
      if (!token) return res;

      const headers = new Headers(init?.headers);
      headers.set("Authorization", `Bearer ${token}`);
      return await originalFetch(input, { ...init, headers });
    } catch {
      /* never let the retry break a request that already has an answer */
      return res;
    }
  };
}
