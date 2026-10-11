/**
 * Sign-up over a connection that drops.
 *
 * "AbortError: Fetch is aborted" is what the sign-up screen showed. It is not a message
 * from the server: postgrest-js catches a fetch that never completed and hands it back as
 * `{ message: "<name>: <message>" }`, and "Fetch is aborted" is WebKit's text for a fetch
 * whose signal fired — on an iPhone or iPad, the deadline in `requestTimeout.ts`. WebKit
 * drops the reason that deadline passes ("The server did not answer within 15s"), so the
 * person reads the browser's internals instead.
 *
 * Measured on 11/10/2026 against the live backend with the publishable key in `.env`:
 *
 *     POST /rest/v1/rpc/check_invite_code   200   0.10–0.19 s   (three runs)
 *     POST /rest/v1/rpc/self_signup_role    200   0.12 s
 *     GET  /auth/v1/health                  200   0.10 s
 *
 * The project is up and the URL and key are right. A request that takes 15 s on this
 * backend is a request that is not getting through, so the deadline stays: lengthening
 * it would only make the person wait longer for the same failure. What changes is that
 * a dropped connection is tried once more on its own, and if that fails too, the person
 * reads a sentence they can act on.
 */

export const CONNECTION_FAILED_MESSAGE =
  "Não foi possível ligar ao servidor. Verifique a ligação e tente novamente.";

/** How long to wait before the second attempt. Long enough for a Wi-Fi hand-over. */
export const RETRY_DELAY_MS = 1500;

/**
 * Whether an error means the request did not complete, as opposed to the server
 * answering with a refusal. Only the first kind is worth repeating: an invalid code or
 * a taken email will be just as invalid a second time.
 */
export function isConnectionFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { name?: unknown; message?: unknown; status?: unknown };
  const name = typeof e.name === "string" ? e.name : "";
  if (
    name === "AbortError" ||
    name === "TimeoutError" ||
    // auth-js: the fetch itself failed (status 0), as distinct from an HTTP refusal.
    name === "AuthRetryableFetchError" ||
    name === "FunctionsFetchError"
  ) {
    return true;
  }
  const message = typeof e.message === "string" ? e.message : "";
  return /aborterror|fetch is aborted|timeouterror|did not answer within|failed to fetch|failed to send a request|network\s*error|load failed|network request failed/i.test(
    message,
  );
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs `attempt`, and runs it once more if it failed to connect.
 *
 * Works for both shapes the Supabase SDK uses: a rejected promise, and a resolved
 * `{ error }`. Whatever the second attempt produces is returned as it is, so the caller
 * still sees a refusal for what it is.
 */
export async function withConnectionRetry<T extends { error?: unknown }>(
  attempt: () => Promise<T>,
  delayMs: number = RETRY_DELAY_MS,
): Promise<T> {
  try {
    const first = await attempt();
    if (!isConnectionFailure(first?.error)) return first;
  } catch (err) {
    if (!isConnectionFailure(err)) throw err;
  }
  await pause(delayMs);
  return attempt();
}

/** The sentence to show for a failed step: the connection one, or the server's own. */
export function signupErrorMessage(error: unknown, fallback: string): string {
  if (isConnectionFailure(error)) return CONNECTION_FAILED_MESSAGE;
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" && message.trim() ? message : fallback;
}
