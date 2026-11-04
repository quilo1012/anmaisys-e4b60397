/**
 * The one login that is told about Root Diagnostics.
 *
 * Every admin used to get the bell ("A screen crashed", "A request was refused") and
 * the crash badge on the sidebar. Those are for whoever fixes the system, not for every
 * admin running the factory, so from 04/11/2026 only this account receives them. The
 * page itself stays open to admins (`system.diagnostics`): this decides who is told,
 * not who may look.
 *
 * Matched on the login email, lower-cased. Changing who is root is changing this line.
 */
export const ROOT_EMAIL = "daniel.quilo@appliednutrition.uk";

export function isRootAccount(
  role: string | null | undefined,
  email: string | null | undefined,
): boolean {
  return role === "admin" && !!email && email.trim().toLowerCase() === ROOT_EMAIL;
}
