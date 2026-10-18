/**
 * Where the login screen sends somebody back to, carried as `?next=`.
 *
 * Only a same-origin path is ever followed — a `//host` or an absolute URL in `next`
 * would make the login page an open redirect — and never the auth pages themselves,
 * which would just loop.
 */
const AUTH_PAGES = ["/login", "/signup", "/reset-password"];

export function safeNextPath(next: string | null | undefined): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return null;
  const path = next.split(/[?#]/)[0];
  if (path === "/" || AUTH_PAGES.includes(path)) return null;
  return next;
}

export function loginPathReturningTo(path: string): string {
  const next = safeNextPath(path);
  return next ? `/login?next=${encodeURIComponent(next)}` : "/login";
}
