import { logSystemError } from "@/lib/telemetry";
import { isUserCorrectable } from "@/lib/userCorrectable";

// Automatic backend-failure capture. supabase-js issues every PostgREST / RPC /
// edge-function call through the global fetch, so wrapping fetch once lets Root
// Diagnostics record any 4xx/5xx the backend returns to the client — RLS
// denials, constraint violations, edge-function errors — without instrumenting
// each screen. Pure server-side failures that never reach the client still live
// only in Supabase's own logs; this covers everything that surfaces here.

/**
 * Codes that are not faults.
 *
 * PGRST116 is PostgREST's "no rows" from .single().
 *
 * P0001 is a RAISE EXCEPTION from one of our own triggers — "Attach the evidence
 * before validating this action", "This action is closed. A manager must reopen it
 * before the verdict can change". Those are the rules working: the user asked for
 * something the system is meant to refuse, was told so in a toast, and moved on.
 * Filing them as system errors fills Root Diagnostics with the rules being enforced,
 * and a diagnostics page that cries wolf is a diagnostics page nobody reads.
 *
 * Constraint violations (23505, 23514, 23503, …) are NOT in here, and are not decided
 * by their code at all. Most mean a screen sent the database something it should never
 * have sent, which is a fault; a few are somebody typing a code that already exists,
 * which is not. Which is which is declared per constraint in `userCorrectable`, never
 * inferred — on 08/08 the same 23505 was both before lunch.
 */
const IGNORED_CODES = new Set(["PGRST116", "P0001"]);

/**
 * Schema-drift probes, not faults.
 *
 * Several hooks walk a ladder of `select()` variants, newest column first, so a
 * database that is a few migrations behind still answers correctly — see
 * `useQualityOptions` (`quality_options.is_gate`, `counts_against_leader`, `points`)
 * and `useScoringFreeze` (`public.scoring_version`). The refusal that walks the ladder
 * down one rung is the mechanism working; the screen never shows an error and nothing
 * needs a person. Filing "column quality_options.is_gate does not exist" as an
 * API_ERROR on every page load buries the faults that do.
 *
 * 42703 = undefined column, 42P01 = undefined table (Postgres, post-parse);
 * PGRST204/PGRST205 = the same two, answered from PostgREST's schema cache.
 */
const SCHEMA_PROBE_CODES = new Set(["42703", "42P01", "PGRST204", "PGRST205"]);

function resourceFromPath(path: string): string {
  if (path.includes("/rest/v1/rpc/")) return "rpc:" + path.split("/rest/v1/rpc/")[1];
  if (path.includes("/rest/v1/")) return path.split("/rest/v1/")[1] || "";
  if (path.includes("/functions/v1/")) return "fn:" + (path.split("/functions/v1/")[1] || "");
  return path;
}

export function installApiErrorTelemetry(): void {
  if (typeof window === "undefined" || typeof window.fetch !== "function") return;
  const w = window as unknown as { __apiErrorTelemetryInstalled?: boolean };
  if (w.__apiErrorTelemetryInstalled) return;
  w.__apiErrorTelemetryInstalled = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const res = await originalFetch(input, init);
    try {
      if (res.ok) return res;

      const url =
        typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
      // Only Supabase data / RPC / edge-function calls; never the auth, storage,
      // realtime channels, or the telemetry insert itself (would recurse).
      const isSupabaseData = /\/rest\/v1\/|\/functions\/v1\//.test(url);
      if (!isSupabaseData || url.includes("system_telemetry_logs")) return res;

      const { pathname } = new URL(url, window.location.origin);
      const resource = resourceFromPath(pathname);
      const method = (
        init?.method || (input instanceof Request ? input.method : "GET") || "GET"
      ).toUpperCase();

      // Read a copy so the caller still gets the untouched body.
      let body: { message?: string; code?: string; hint?: string; details?: string } | null = null;
      try {
        body = JSON.parse(await res.clone().text());
      } catch {
        /* non-JSON error body — fall back to status text */
      }

      if (body?.code && (IGNORED_CODES.has(body.code) || SCHEMA_PROBE_CODES.has(body.code))) return res;

      // 401/403 (and Postgres 42501) are almost always RLS; everything else API.
      const isRls = res.status === 401 || res.status === 403 || body?.code === "42501";
      const message =
        body?.message || `${method} ${resource} → ${res.status} ${res.statusText}`.trim();

      // A refusal the person who hit it can fix by typing something else, on a screen
      // that already says so, is recorded but not filed as a fault — see
      // `userCorrectable`, which is also where the reason it is not one is written
      // down. Everything unlisted stays a fault, which is the direction that catches
      // things. A denial is never somebody's typing, so RLS is decided first.
      const type = isRls
        ? "RLS_ERROR"
        : isUserCorrectable(message)
          ? "USER_ERROR"
          : "API_ERROR";

      logSystemError(type, message, {
        metadata: {
          status: res.status,
          method,
          resource,
          code: body?.code ?? null,
          hint: body?.hint ?? null,
          details: body?.details ?? null,
        },
      });
    } catch {
      /* never let telemetry break a real request */
    }
    return res;
  };
}
