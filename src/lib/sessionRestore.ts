import { isAuthRetryableFetchError, type AuthError, type Session } from "@supabase/supabase-js";

/**
 * What the boot read of the stored session means.
 *
 * An employee opens the app hours after their last visit, so the access token has
 * always expired and the first `getSession()` has to refresh it over the network.
 * On the factory wifi that refresh can fail or stall. The old boot read every one
 * of those as "signed out" and showed the password form, while the session was
 * still sitting in storage, valid. Only the server saying no means signed out.
 *
 * - `signed-in`    — a session came back.
 * - `reconnecting` — a session is stored but the refresh could not reach the
 *                    server (a retryable error, or the read never finished:
 *                    with nothing stored `getSession()` answers at once, so a
 *                    stall means a refresh is under way). Keep it and retry.
 * - `ended`        — the server refused the refresh: expired, revoked, or signed
 *                    out on another device. The person has to sign in again.
 * - `signed-out`   — nothing was stored.
 */
export type BootSession =
  | { kind: "signed-in"; session: Session }
  | { kind: "reconnecting" }
  | { kind: "ended" }
  | { kind: "signed-out" };

export function classifyBootSession(
  result: { data: { session: Session | null }; error: AuthError | null } | null,
): BootSession {
  if (!result) return { kind: "reconnecting" };
  const { data, error } = result;
  if (data.session?.user) return { kind: "signed-in", session: data.session };
  if (error && isAuthRetryableFetchError(error)) return { kind: "reconnecting" };
  if (error) return { kind: "ended" };
  return { kind: "signed-out" };
}

/**
 * Why the last session ended, carried across the redirect to /login so the login
 * screen can say it instead of just asking for the password again. Only the reason
 * is kept, never anything about the account.
 */
const NOTICE_KEY = "an_session_ended";

export type SessionEndReason = "expired";

export const SESSION_END_MESSAGES: Record<SessionEndReason, string> = {
  expired:
    "Your sign-in ended. It expired, or it was signed out from another device or by an administrator. Sign in again to continue.",
};

export function noteSessionEnded(reason: SessionEndReason) {
  try { sessionStorage.setItem(NOTICE_KEY, reason); } catch { /* storage unavailable */ }
}

export function clearSessionEndNotice() {
  try { sessionStorage.removeItem(NOTICE_KEY); } catch { /* storage unavailable */ }
}

/** Reads the reason once; the notice is shown a single time. */
export function takeSessionEndNotice(): string | null {
  try {
    const reason = sessionStorage.getItem(NOTICE_KEY) as SessionEndReason | null;
    sessionStorage.removeItem(NOTICE_KEY);
    return reason && reason in SESSION_END_MESSAGES ? SESSION_END_MESSAGES[reason] : null;
  } catch {
    return null;
  }
}

