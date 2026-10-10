/**
 * The call never left the browser, so there is nothing to read and nothing to say.
 *
 * `supabase.functions.invoke` surfaces two very different failures the same way to a
 * careless caller. One is the function answering with a refusal — a body, a sentence,
 * something a person can act on. The other is the request never completing at all, and
 * that one arrives as `FunctionsFetchError` carrying "Failed to send a request to the
 * Edge Function", which is what the factory floor has been reading on the sign-up
 * screen.
 *
 * WHY IT CANNOT BE FIXED WHERE IT LOOKS LIKE IT SHOULD BE. `employee-signin` is not
 * deployed, and the Functions gateway answers the CORS **preflight** for an unknown
 * name with 404 and an incomplete header set — no `access-control-allow-methods`, and
 * no `content-type` in `access-control-allow-headers`, which supabase-js always sends.
 * A preflight needs a 2xx, so the browser abandons the request before the POST. Both
 * sides were measured:
 *
 *     OPTIONS tablet-signin    200, methods + content-type present   (deployed)
 *     OPTIONS employee-signin  404, neither                          (not deployed)
 *
 * curl sees a readable 404 body because curl does not preflight. The browser never
 * receives one byte, so no server-side message can reach it. The only place left to
 * say something useful is here.
 */
export function isFunctionUnreachable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { name?: unknown; message?: unknown };
  // The SDK's own name for it, when the SDK is what produced the error.
  if (e.name === "FunctionsFetchError") return true;
  // And the text, because `normalizeFunctionError` rebuilds the object with a spread
  // and a plain `{...error}` of a class instance does not keep its name.
  const message = typeof e.message === "string" ? e.message : "";
  return /failed to send a request|failed to fetch|network\s*error|load failed/i.test(message);
}
