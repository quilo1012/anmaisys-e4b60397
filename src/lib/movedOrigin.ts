import { SUPERSEDED_HOSTS } from "./publicOrigin";

/**
 * Did this page load arrive through the redirect from the address the app used to have?
 *
 * The app moved from `anmaisys.lovable.app` to `anpmsystem.co.uk`, and the old address
 * answers 302. `localStorage` is per origin, so everything a device had kept — the
 * session, the shared-tablet credential, which line a tablet is — stayed behind on the
 * old origin. The person is not signed out: their sign-in is on an address this page
 * cannot read. Showing them the bare password form says nothing about that, and on a
 * line tablet it reads as the system logging them out again.
 *
 * `document.referrer` is what we have. Under this app's `Referrer-Policy`
 * (strict-origin-when-cross-origin) a cross-origin navigation still sends the origin,
 * so a redirect hop from the old host does show up here.
 *
 * **It does not catch every case.** A plain reload sends no referrer, and neither does
 * a Home Screen shortcut opening cold. So this is a message shown when we can prove the
 * arrival, never a guess: a first-time visitor on a new phone must not be told the
 * address changed. The reliable fix is re-making the shortcuts, not this notice.
 */
export function arrivedFromSupersededOrigin(
  referrer: string | undefined,
  currentHost: string | undefined,
): boolean {
  if (!referrer || !currentHost) return false;
  const here = currentHost.toLowerCase();
  // Already on the old host: the move has not happened for this page, so there is
  // nothing to explain.
  if (SUPERSEDED_HOSTS.includes(here)) return false;
  let from: string;
  try {
    from = new URL(referrer).hostname.toLowerCase();
  } catch {
    return false;
  }
  return SUPERSEDED_HOSTS.includes(from);
}

export const MOVED_ORIGIN_MESSAGE =
  "The system has a new address. Your sign-in was saved under the old one, so you need to sign in here once. If this screen is a tablet shortcut, ask for the shortcut to be re-made, or it will keep landing on the old address.";

/** The notice for this arrival at the login screen, or null when there is nothing to say. */
export function movedOriginNotice(
  referrer: string | undefined = typeof document !== "undefined" ? document.referrer : undefined,
  currentHost: string | undefined = typeof window !== "undefined" ? window.location.hostname : undefined,
): string | null {
  return arrivedFromSupersededOrigin(referrer, currentHost) ? MOVED_ORIGIN_MESSAGE : null;
}
