/**
 * The invite code a person arrived with, and where it is kept until they finish.
 *
 * The QR and the admin's link both put it in `?code=` (see `signupQrPayload`). The URL
 * survives a refresh on its own; what it does not survive is the person tapping "Sign
 * in", reading the login screen, and coming back to /signup by the button there — or
 * a phone browser reopening the tab from its home page. So the code is also kept in
 * `sessionStorage`, which lives exactly as long as that tab, and read back when the
 * address no longer carries it.
 *
 * Nothing here decides whether the code is good. That is `check_invite_code`, and the
 * form asks it again on submit whatever this file says.
 */
const KEY = "an_signup_invite_code";

/** `code` is what we print. The other two are what a hand-made link tends to use. */
const PARAMS = ["code", "invite", "invite_code"] as const;

function storage(): Storage | null {
  try { return window.sessionStorage; } catch { return null; }
}

export function readInviteCode(search: string): { code: string; fromLink: boolean } {
  let fromUrl = "";
  try {
    const params = new URLSearchParams(search);
    for (const p of PARAMS) {
      const v = params.get(p)?.trim();
      if (v) { fromUrl = v; break; }
    }
  } catch { /* no code in the address */ }

  const s = storage();
  if (fromUrl) {
    try { s?.setItem(KEY, fromUrl); } catch { /* private mode: the URL still has it */ }
    return { code: fromUrl, fromLink: true };
  }
  let kept = "";
  try { kept = s?.getItem(KEY)?.trim() ?? ""; } catch { /* nothing kept */ }
  return { code: kept, fromLink: !!kept };
}

/** Once the account exists the code has done its job; the next person on this phone starts clean. */
export function forgetInviteCode() {
  try { storage()?.removeItem(KEY); } catch { /* nothing to forget */ }
}

/** One sentence for a refused code, said the same way on arrival and on submit. */
export const INVALID_INVITE_MESSAGE =
  "That invite code isn't valid any more — it may have expired, or sign-up is closed. Ask your supervisor for a new one.";
