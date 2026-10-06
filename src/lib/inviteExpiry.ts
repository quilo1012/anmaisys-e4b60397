/**
 * How long an invite code should live, and how to say so.
 *
 * Kept apart from the settings card so the arithmetic is testable without a browser,
 * and so "expired" means the same thing in the card as it does in check_invite_code:
 * now() >= invite_expires_at. Null is "never", which is today's behaviour, kept on
 * purpose for the admin who wants it.
 */

export type ExpiryChoice = "1d" | "7d" | "30d" | "never";

export const EXPIRY_CHOICES: { value: ExpiryChoice; label: string }[] = [
  { value: "1d", label: "24 hours" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "never", label: "Never" },
];

/** The default a freshly generated code gets. A week is long enough to send and short enough to forget. */
export const DEFAULT_EXPIRY: ExpiryChoice = "7d";

export function expiryFromChoice(choice: ExpiryChoice, now: Date = new Date()): string | null {
  const days = choice === "1d" ? 1 : choice === "7d" ? 7 : choice === "30d" ? 30 : null;
  if (days === null) return null;
  return new Date(now.getTime() + days * 86_400_000).toISOString();
}

export function isExpired(expiresAt: string | null, now: Date = new Date()): boolean {
  return expiresAt !== null && now.getTime() >= Date.parse(expiresAt);
}

/** "expires in 6 days", "expires in 3 hours", "expired 2 days ago", or "never expires". */
export function expiryLabel(expiresAt: string | null, now: Date = new Date()): string {
  if (expiresAt === null) return "never expires";
  const diffMs = Date.parse(expiresAt) - now.getTime();
  const abs = Math.abs(diffMs);
  const unit =
    abs >= 2 * 86_400_000 ? `${Math.round(abs / 86_400_000)} days`
    : abs >= 86_400_000 ? "1 day"
    : abs >= 2 * 3_600_000 ? `${Math.round(abs / 3_600_000)} hours`
    : abs >= 3_600_000 ? "1 hour"
    : `${Math.max(1, Math.round(abs / 60_000))} min`;
  return diffMs > 0 ? `expires in ${unit}` : `expired ${unit} ago`;
}
