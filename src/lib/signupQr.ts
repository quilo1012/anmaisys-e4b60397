/**
 * The one thing the registration QR code carries: the address of the signup page.
 *
 * It is a pure function, in its own file, with a test naming the things it must not
 * contain — because the obvious next feature is "scan to answer today's ask", and
 * that would move authorisation into a picture that anybody in the factory can
 * photograph off a tablet. A QR carrying an ask id is a door into one specific
 * overtime; one carrying an employee id is somebody else's identity lying on a table.
 *
 * Scanning this grants nothing. It walks you to a form that still asks for the badge
 * number, the password and the invite code, and `employee-signin` still rate-limits
 * what you type there. Eligibility is decided afterwards and elsewhere — in
 * `answer_overtime`, against the employee the login is linked to.
 */
export function signupQrPayload(origin: string): string {
  const trimmed = origin.trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("No origin to build the signup link from");
  return `${trimmed}/signup`;
}
