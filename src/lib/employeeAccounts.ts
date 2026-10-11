/**
 * Which logins belong on the Employees tab of User Management.
 *
 * Two kinds, and both are the floor's rather than the office's:
 *   - an account whose role is `employee` — overtime and nothing else;
 *   - an account made through the badge (`employee-signin`), whatever role it holds.
 *     Before `employee` existed the badge made `operator`, and those accounts are the
 *     ones an admin is most likely to want to move across, so they are shown here with
 *     their role on the badge rather than buried among the office logins.
 *
 * The badge door never gives the person an email: it invents one from the badge
 * number (`emailFor` in supabase/functions/employee-signin). That address is not
 * something anybody types, so the screen shows the badge number instead.
 */
export const BADGE_EMAIL_DOMAIN = "@employee.pmsystem.local";

export function badgeRefFromEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const lower = email.trim().toLowerCase();
  if (!lower.endsWith(BADGE_EMAIL_DOMAIN)) return null;
  const local = lower.slice(0, -BADGE_EMAIL_DOMAIN.length);
  return local ? local.toUpperCase() : null;
}

export function isEmployeeAccount(user: { role?: string | null; email?: string | null }): boolean {
  return user.role === "employee" || badgeRefFromEmail(user.email) !== null;
}
