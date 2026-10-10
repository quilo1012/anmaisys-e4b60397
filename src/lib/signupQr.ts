/**
 * The address of the signup page, and at most the factory's own invite code with it.
 *
 * It is a pure function, in its own file, with a test naming the things it must not
 * contain — because the obvious next feature is "scan to answer today's ask", and
 * that would move authorisation into a picture that anybody in the factory can
 * photograph off a tablet. A QR carrying an ask id is a door into one specific
 * overtime; one carrying an employee id is somebody else's identity lying on a table.
 * Neither will ever be allowed here.
 *
 * The invite code is a different kind of thing and is allowed, under one condition.
 * It names nobody: it is one string for the whole factory, it grants nothing on its
 * own — the form still asks for the badge number and a password, and
 * `employee-signin` still rate-limits what is typed there — and the admin card
 * already prints it into a link that gets pasted into group chats. What it buys is
 * the field arriving filled, which is the difference between a worker finishing the
 * form and a worker standing in front of a box labelled "From your supervisor" with
 * no supervisor in sight.
 *
 * THE CONDITION, and it is the whole reason this is safe: a code may only be passed
 * in where the caller already had the right to read it. `signup_config` is
 * `REVOKE ALL ... FROM anon` with an admin-only policy, so the code is not available
 * on the login screen and the tablet's QR therefore carries none — it calls this with
 * one argument and gets the bare page, exactly as before. The coded QR belongs on the
 * admin's own card, which is already holding the code on screen, and on the sheet a
 * supervisor prints from it and pins to the wall.
 */
export function signupQrPayload(origin: string, inviteCode?: string | null): string {
  const trimmed = origin.trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("No origin to build the signup link from");
  const code = (inviteCode ?? "").trim();
  if (!code) return `${trimmed}/signup`;
  return `${trimmed}/signup?code=${encodeURIComponent(code)}`;
}

/**
 * Where the button goes. Relative, unlike the QR: it is followed on this device.
 *
 * `tablet=1` is what tells the form not to sign the tablet in as the person it has just
 * registered. The code rides along only when the caller was allowed to hold it — on the
 * public login screen there is none, and the person types it as before.
 */
export function tabletSignupPath(inviteCode?: string | null): string {
  const params = new URLSearchParams({ tablet: "1" });
  const code = (inviteCode ?? "").trim();
  if (code) params.set("code", code);
  return `/signup?${params.toString()}`;
}
