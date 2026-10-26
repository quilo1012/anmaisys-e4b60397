/**
 * Plain-English messages for auth failures on the password-recovery screens.
 *
 * Supabase errors used to reach the toast verbatim ("For security purposes, you can
 * only request this after 53 seconds", "Auth session missing!"). These say what the
 * person can do next, and never whether an account exists.
 */

/** Badge (employee-ID) accounts are created with an address nobody can receive mail at. */
export const BADGE_EMAIL_DOMAIN = "employee.pmsystem.local";

export const BADGE_RESET_MESSAGE = "Badge accounts can't reset by email — ask your supervisor.";

export function isBadgeEmail(value: string): boolean {
  return value.trim().toLowerCase().endsWith(`@${BADGE_EMAIL_DOMAIN}`);
}

interface AuthLikeError {
  message?: string;
  status?: number;
  code?: string;
  name?: string;
}

function asAuthError(error: unknown): AuthLikeError {
  if (error && typeof error === "object") return error as AuthLikeError;
  return { message: typeof error === "string" ? error : "" };
}

function isNetworkError(e: AuthLikeError): boolean {
  const m = (e.message ?? "").toLowerCase();
  return (
    e.name === "AuthRetryableFetchError" ||
    m.includes("failed to fetch") ||
    m.includes("network") ||
    m.includes("load failed")
  );
}

function isRateLimited(e: AuthLikeError): boolean {
  const m = (e.message ?? "").toLowerCase();
  return (
    e.status === 429 ||
    (e.code ?? "").includes("rate_limit") ||
    m.includes("rate limit") ||
    m.includes("for security purposes")
  );
}

/** Whether the recovery session is gone (link expired, used, or opened in another browser). */
export function isRecoverySessionMissing(error: unknown): boolean {
  const e = asAuthError(error);
  const m = (e.message ?? "").toLowerCase();
  return (
    e.name === "AuthSessionMissingError" ||
    e.code === "session_not_found" ||
    e.code === "session_expired" ||
    m.includes("session missing") ||
    m.includes("session_not_found")
  );
}

export function friendlySendLinkError(error: unknown): string {
  const e = asAuthError(error);
  if (isNetworkError(e)) return "Can't reach the server. Check your connection and try again.";
  if (isRateLimited(e)) return "Too many requests. Wait a minute, then try again.";
  return "We couldn't send the link right now. Try again in a few minutes.";
}

export function friendlyUpdatePasswordError(error: unknown): string {
  const e = asAuthError(error);
  const m = (e.message ?? "").toLowerCase();
  if (isNetworkError(e)) return "Can't reach the server. Check your connection and try again.";
  if (isRateLimited(e)) return "Too many attempts. Wait a minute, then try again.";
  if (e.code === "same_password" || m.includes("different from the old"))
    return "Choose a password you haven't used before.";
  if (e.code === "weak_password" || m.includes("weak"))
    return "That password is too easy to guess. Try a longer one.";
  if (isRecoverySessionMissing(e))
    return "This reset link has expired or was already used. Request a new one.";
  return "We couldn't update your password. Try again in a few minutes.";
}

/**
 * Supabase sends a broken recovery link back with the reason in the address —
 * `?error=access_denied&error_code=otp_expired` (PKCE) or the same in the hash
 * (implicit flow). Returns true when either carries an error.
 */
export function recoveryLinkHasError(search: string, hash: string): boolean {
  const q = new URLSearchParams(search);
  const h = new URLSearchParams(hash.replace(/^#/, ""));
  return Boolean(q.get("error") || q.get("error_code") || h.get("error") || h.get("error_code"));
}
