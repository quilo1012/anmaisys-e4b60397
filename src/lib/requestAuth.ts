/**
 * Did this request go out without a signed-in user's token?
 *
 * supabase-js sends two headers on every data call: `apikey` (the project's anon key) and
 * `Authorization: Bearer …`. With a session the bearer is the user's access token; with
 * none at that instant — mid-refresh, waking from sleep, the AuthContext window where React
 * still holds a user the client no longer has (see `liveSession`) — the bearer falls back
 * to the anon key itself. PostgREST then runs the query as `anon`, which has no SELECT on
 * `profiles` or `headcount_area_hidden`, and answers 401 / 42501 "permission denied for
 * table …".
 *
 * That is what Root Diagnostics showed on 17/11/2026 (ProductionOffice, 16:11 and 16:26):
 * two RLS_ERROR rows for tables `authenticated` can read. Nothing was wrong with the
 * grants; the token was missing. This tells the two apart from the request itself.
 *
 * Unknown (no headers to read) answers false, so the request is still treated as a real
 * refusal — the direction that catches things.
 */
export function sentWithoutUserToken(init?: RequestInit | null): boolean {
  try {
    const headers = new Headers(init?.headers ?? undefined);
    const apikey = headers.get("apikey");
    const auth = headers.get("authorization");
    if (!auth) return !!apikey;
    const bearer = auth.replace(/^Bearer\s+/i, "").trim();
    if (!bearer) return !!apikey;
    if (apikey && bearer === apikey) return true;
    return jwtRole(bearer) === "anon";
  } catch {
    return false;
  }
}

/** The `role` claim of a JWT, or null when it is not one. Never verified: only read. */
function jwtRole(token: string): string | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "="));
    const role = (JSON.parse(json) as { role?: unknown }).role;
    return typeof role === "string" ? role : null;
  } catch {
    return null;
  }
}
