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

/** The slice of an employee record the link screen needs. */
export interface LinkableEmployee {
  id: string;
  full_name: string;
  employee_ref: string | null;
  email: string | null;
  department: string | null;
  user_id: string | null;
  active: boolean;
}

/**
 * The record this login most likely belongs to, or null when nothing says so.
 *
 * Only two facts count, and both are exact: the record's email is the login's email,
 * or the badge number the login was made from is the record's `employee_ref`. A name
 * that looks alike is never a suggestion — there are four Lucas and three Ezaquiel on
 * the payroll, and a wrong link gives one person another's overtime and attendance.
 * When both facts point at different records, or either points at a record somebody
 * else already holds, there is no suggestion: the office decides.
 */
export function suggestEmployeeFor(
  login: { email: string | null | undefined },
  employees: LinkableEmployee[],
): LinkableEmployee | null {
  const email = login.email?.trim().toLowerCase() || null;
  const ref = badgeRefFromEmail(login.email);
  const byEmail = email ? employees.filter((e) => e.active && e.email?.trim().toLowerCase() === email) : [];
  const byRef = ref ? employees.filter((e) => e.active && e.employee_ref?.trim().toUpperCase() === ref) : [];
  const hits = [...new Map([...byEmail, ...byRef].map((e) => [e.id, e])).values()];
  if (hits.length !== 1) return null;
  return hits[0].user_id ? null : hits[0];
}
