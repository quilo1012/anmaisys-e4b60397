/**
 * Why an edge function refused, when it refused with an HTTP 200.
 *
 * `supabase.functions.invoke` sets `error` only for status 400 and up. A function
 * that answers 200 with `{success: false}` reaches the client as a success: the
 * mutation resolves, `onSuccess` runs, and whatever green toast is there fires.
 *
 * `intouch-sync-production` answers exactly that when `intouch_sync_enabled` is off,
 * and it has been off since 29/07, when that write path overwrote production an
 * operator had keyed in. The "Sync SKUs" button in the operator's screen therefore
 * announced a sync that had not happened, every time, to anyone who pressed it.
 *
 * An unrecognised reason is still reported rather than swallowed. The failure worth
 * designing against is not the reason we know about — it is the one added
 * server-side next year, with the client still showing green because it only knew
 * the old one.
 */
const KNOWN_REASONS: Record<string, string> = {
  intouch_current_shift_sync_disabled:
    "iTouching sync is turned off for the current shift. Nothing was changed.",
};

export function refusalMessage(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const body = data as { success?: unknown; reason?: unknown };
  // Absence of the convention is not a refusal: most functions return their payload
  // and signal failure with a status code.
  if (body.success !== false) return null;

  const reason = typeof body.reason === "string" ? body.reason : "";
  if (reason && KNOWN_REASONS[reason]) return KNOWN_REASONS[reason];
  if (reason) return `The server declined this: ${reason}`;
  return "The server declined this and gave no reason. Nothing was changed.";
}
