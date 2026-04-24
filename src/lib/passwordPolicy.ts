/**
 * Lightweight client-side password sanity check.
 * The backend enforces leaked-password protection (HIBP) — this only catches
 * obvious weak picks before we round-trip, so admins get instant feedback.
 */
const OBVIOUS_WEAK = new Set([
  "password", "password1", "password123",
  "123456", "1234567", "12345678", "123456789", "1234567890",
  "qwerty", "qwerty123", "abc123", "111111", "000000",
  "letmein", "welcome", "admin", "admin123", "operator", "operator123",
  "iloveyou", "monkey", "dragon",
]);

export interface PasswordCheckResult {
  ok: boolean;
  reason?: string;
}

export function checkPasswordStrength(pwd: string): PasswordCheckResult {
  if (!pwd || pwd.length < 8) {
    return { ok: false, reason: "Password must be at least 8 characters." };
  }
  if (OBVIOUS_WEAK.has(pwd.toLowerCase())) {
    return { ok: false, reason: "This password is too common. Pick something unique." };
  }
  if (/^(.)\1+$/.test(pwd)) {
    return { ok: false, reason: "Password cannot be a single repeated character." };
  }
  if (/^(?:0123456789|1234567890|abcdefgh|qwertyui)/i.test(pwd)) {
    return { ok: false, reason: "Avoid simple keyboard or number sequences." };
  }
  return { ok: true };
}

/**
 * Convert backend auth/password errors into a clear message for the admin UI.
 */
export function describePasswordError(message: string | undefined | null): string {
  if (!message) return "Password change failed.";
  const lower = message.toLowerCase();
  if (lower.includes("pwned") || lower.includes("breach") || lower.includes("compromis")) {
    return "This password has appeared in a known data breach. Please choose a different password.";
  }
  if (lower.includes("weak_password") || lower.includes("password should")) {
    return "Password is too weak. Use at least 8 characters and avoid common words.";
  }
  return message;
}
