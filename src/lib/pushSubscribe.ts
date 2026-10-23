/**
 * The two things that go wrong between tapping "Turn on" and a phone being on the list.
 *
 * **A key that does not match the one already stored.** A push subscription is minted
 * against one `applicationServerKey`, and the browser keeps it for the origin. Ask it to
 * subscribe again with a different key and it refuses — it does not replace the old one.
 * This app changed key: it used to read `VITE_VAPID_PUBLIC_KEY` from the build and now
 * falls back to a constant in `src/lib/vapid.ts`, so any phone that said yes under the
 * old value is holding a subscription this code cannot reuse. The cure is to drop the
 * stale one and mint a new one, which is safe: a subscription nothing can send to is
 * worth nothing.
 *
 * **A message nobody can act on.** The old handler put `e.message` straight into a
 * toast, so an operator read "Registration failed - A subscription with a different
 * applicationServerKey already exists". These map the handful of real causes onto
 * something a person on the floor can do something about.
 */

/** Byte-compare two application server keys; absent on either side means "cannot tell". */
export function sameApplicationServerKey(
  existing: ArrayBuffer | null | undefined,
  wanted: Uint8Array,
): boolean {
  if (!existing) return false;
  const a = new Uint8Array(existing);
  if (a.length !== wanted.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== wanted[i]) return false;
  return true;
}

/**
 * Whether this is the browser refusing a second key for the same origin — the one error
 * worth retrying, because dropping the stale subscription makes the retry succeed.
 * Chrome, Firefox and Safari word it differently; all three raise InvalidStateError.
 */
export function isDifferentKeyError(e: unknown): boolean {
  const err = e as { name?: string; message?: string } | null;
  if (!err) return false;
  if (err.name === "InvalidStateError") return true;
  return /different\s+application\s*server\s*key|different\s+gcm_sender_id|already\s+exists/i
    .test(err.message ?? "");
}

/** What to tell the person, in words they can act on. */
export function describeSubscribeError(e: unknown): string {
  const err = e as { name?: string; message?: string } | null;
  const message = err?.message ?? "";

  if (isDifferentKeyError(e)) {
    return "This phone is still holding an older notification setup that cannot be reused. Close the app completely, open it again and tap Turn on once more.";
  }
  if (err?.name === "NotAllowedError" || /denied|permission/i.test(message)) {
    return "Notifications are blocked for this site. Allow them in your browser settings, then tap Turn on again.";
  }
  // The SPA host answering /sw.js with index.html is the classic shape of this.
  if (/unsupported MIME type|failed to register a serviceworker|script fetch/i.test(message)) {
    return "The app could not load its notification worker. Reload the page and try again; if it keeps failing, report it — this one is a server problem, not your phone.";
  }
  if (/timed out|timeout/i.test(message)) {
    return "Setting up notifications took too long. Check your connection, reload the page and try again.";
  }
  if (/push service|AbortError|registration failed/i.test(message)) {
    return "The phone's push service refused the request. Check you are online, then try again.";
  }
  return message || "Could not turn on notifications.";
}

/**
 * `navigator.serviceWorker.ready` never rejects: with no worker ever reaching active it
 * simply does not settle, and the button spins for ever with nothing said. A bounded
 * wait turns that into an error somebody can read.
 */
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms),
    ),
  ]);
}
