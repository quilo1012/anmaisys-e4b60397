/**
 * Whether the session holding this browser is a shared line tablet rather than a person.
 *
 * `tablet-signin` takes an `account_id`, not a name: a tablet is a place, and a whole
 * shift signs in as the same auth user. Everything in overtime asks who you are
 * through `my_overtime_identity()`, which reads `employees.user_id = auth.uid()` — so
 * the moment anybody links themselves on a tablet, that shared user *is* them, for
 * everyone, permanently. It happened on Line 1: the screen offered "Pick your name
 * once", the first person obliged, and from then on the day crew's tablet reported
 * "Signed in as Eduardo Luz, Night crew" and showed his answer already accepted. The
 * second person to try got "This login is already linked to an employee" — which is
 * how one employee came to be the only one who could confirm anything.
 *
 * The database is where that has to be refused, in `link_me_to_employee`, and this is
 * not that. This is the screen declining to ask the question in the first place, so
 * the mistake is not offered to the next person who picks the tablet up.
 *
 * `an_tablet_cred` is the signal because it already means exactly this and nothing
 * else: `Login` writes it only after a tablet sign-in, deletes it on a staff sign-in
 * ("Staff login should never leave tablet credentials behind"), and `AuthContext`
 * clears it on sign-out. Reading it costs no round trip, which matters on a screen
 * that decides what to render before anything has loaded.
 */
export const TABLET_CRED_KEY = "an_tablet_cred";

/**
 * `storage` is injectable so this can be tested and so a caller in a context without
 * one is not a special case. A throw — private mode, blocked site data — answers
 * false: a personal screen on a tablet is a bug, and a tablet screen on a phone is an
 * inconvenience, so the uncertain case takes the inconvenience.
 */
export function isSharedTabletSession(storage?: Pick<Storage, "getItem"> | null): boolean {
  const store = storage ?? (typeof localStorage !== "undefined" ? localStorage : null);
  if (!store) return false;
  try {
    const raw = store.getItem(TABLET_CRED_KEY);
    if (!raw) return false;
    // Present but unreadable still means a tablet signed in here: the key is written
    // by one place and read by two, and a half-written value is not a staff login.
    return true;
  } catch {
    return false;
  }
}
