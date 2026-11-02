import type { Role } from "@/lib/permissions";

/**
 * Who gets asked for browser notification permission the moment they sign in.
 *
 * The office does. The floor does not, and the difference is not tidiness — it is
 * whether the person can say yes for a reason they understand.
 *
 * A bare `Notification.requestPermission()` on page load is a grey browser bar with no
 * sentence attached. Someone who taps Block there has blocked the site, and the only
 * way back is the browser's own settings, several screens deep, on a phone, which on a
 * factory floor means never. `OvertimePushNudge` exists because of that: it waits
 * until the person is looking at overtime, says what the permission is for, and stays
 * on screen until the job is done rather than for fifteen seconds.
 *
 * `operator` was excluded when that card was written. `employee` was added to
 * `app_role` on 11/10 and inherited nothing — so the newest floor role got the oldest
 * mistake, and the card meant to protect it would open onto a permission already
 * denied.
 *
 * Declared, not inferred. A role is on the floor because it is listed here, not
 * because of what its name suggests — and a role added later gets the prompt unless
 * somebody decides otherwise, which is the direction that fails loudly rather than
 * silently.
 */
const FLOOR_ROLES: readonly Role[] = ["operator", "employee"];

export function asksForNotificationPermissionAtLogin(role: Role | null | undefined): boolean {
  if (!role) return false;
  return !FLOOR_ROLES.includes(role);
}

/** The list itself, so a test can hold it against the roles that exist. */
export const FLOOR_ROLES_NOT_PROMPTED = FLOOR_ROLES;

type PermissionAsker = Pick<typeof Notification, "permission" | "requestPermission">;

/**
 * The first-tap ask in `DashboardLayout` (27/07, so DM alerts reach the tablet), held to
 * the same list as the login ask. Before 02/11/2026 it asked every role, the floor
 * included: the employee's first tap anywhere in the Home Screen app opened the bare iOS
 * prompt, with no sentence. A no there is only undone in Settings; a yes there grants
 * permission and subscribes nothing — "permission granted, this phone absent" — so the
 * server still has no phone. The floor is asked by `OvertimePushNudge`, which subscribes.
 *
 * Returns whether it asked. Never throws.
 */
export function askOnFirstGesture(
  role: Role | null | undefined,
  N: PermissionAsker | undefined = typeof Notification !== "undefined" ? Notification : undefined,
): boolean {
  if (!N || N.permission !== "default" || !asksForNotificationPermissionAtLogin(role)) return false;
  try {
    const p = N.requestPermission();
    if (p && typeof (p as Promise<unknown>).then === "function") (p as Promise<unknown>).catch(() => {});
    return true;
  } catch {
    return false;
  }
}
