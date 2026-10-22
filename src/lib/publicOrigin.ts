/**
 * The address a phone can open, for links that leave this screen in a picture or on paper.
 *
 * A QR is drawn on one device and opened on another. `window.location.origin` is right
 * for the first and can be useless for the second: a QR drawn on the Lovable preview
 * (`id-preview--<uuid>.lovable.app`, `<uuid>.lovableproject.com`) opens a page that
 * asks the phone to sign in to Lovable, and one drawn on `localhost` or a LAN address
 * opens nothing at all. The worker sees a broken link and the sign-up sheet on the wall
 * is wrong until somebody reprints it.
 *
 * So preview, local and superseded hosts are swapped for the published site, and every
 * other host — the published one, or a custom domain added later — is kept as it is.
 * `VITE_PUBLIC_SITE_URL` overrides the published address when the app moves.
 */
export const PUBLISHED_ORIGIN = "https://anpmsystem.co.uk";

/**
 * Addresses the app used to live at, which now 302 to PUBLISHED_ORIGIN.
 *
 * A QR drawn on a page still being served from one of these would print the old
 * address, and every phone that scanned it would arrive through the redirect — onto an
 * origin that holds none of its `localStorage`, so it would ask for a login it has
 * already given. The redirect keeps old links working; it should not be minted into new
 * ones. See `claude/sessao-tablets-mudanca-de-origem-2026-10-22.md`.
 */
export const SUPERSEDED_HOSTS = ["anmaisys.lovable.app"];

const LOCAL_HOST = /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/;

function isPreviewOrLocal(host: string): boolean {
  const h = host.toLowerCase();
  if (SUPERSEDED_HOSTS.includes(h)) return true;
  if (LOCAL_HOST.test(h) || h.endsWith(".local")) return true;
  if (h.endsWith(".lovableproject.com") || h.endsWith(".lovableproject-dev.com")) return true;
  // `id-preview--…` and `preview--…` are the editor's previews; the published app is
  // a plain `<name>.lovable.app`.
  if (h.endsWith(".lovable.app") && /^(id-)?preview--/.test(h)) return true;
  return false;
}

export function publicOrigin(
  current: string = typeof window !== "undefined" ? window.location.origin : "",
  configured: string | undefined = import.meta.env.VITE_PUBLIC_SITE_URL as string | undefined,
): string {
  const fallback = (configured ?? "").trim().replace(/\/+$/, "") || PUBLISHED_ORIGIN;
  if (!current) return fallback;
  let host: string;
  try {
    host = new URL(current).hostname;
  } catch {
    return fallback;
  }
  return isPreviewOrLocal(host) ? fallback : current.replace(/\/+$/, "");
}
