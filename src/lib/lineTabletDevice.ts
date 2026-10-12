/**
 * Is this browser a line tablet?
 *
 * The operator screens and the login were sized for a desk, and on the line tablets
 * they came out too big to work with — a form that needs scrolling to reach its own
 * submit button. The tablets get a denser type scale (see `[data-device="line-tablet"]`
 * in index.css), and this module is what decides who is one.
 *
 * Two answers, either is enough:
 *   - the session belongs to an `operator` — only the shared line accounts have it;
 *   - this browser once signed in as a line tablet. That is remembered on the device,
 *     not on the session, so the login screen is already the tablet's size *before*
 *     anyone signs in, and stays so after a sign-out. A staff login on the same
 *     browser forgets it.
 */
const DEVICE_KEY = "an_line_tablet_device";

export function rememberLineTablet(isTablet: boolean) {
  try {
    if (isTablet) localStorage.setItem(DEVICE_KEY, "1");
    else localStorage.removeItem(DEVICE_KEY);
  } catch {
    // localStorage unavailable: the role alone still decides after sign-in.
  }
}

export function wasLineTablet(): boolean {
  try {
    return localStorage.getItem(DEVICE_KEY) === "1";
  } catch {
    return false;
  }
}

export function applyLineTabletDensity(on: boolean) {
  const root = document.documentElement;
  if (on) root.dataset.device = "line-tablet";
  else delete root.dataset.device;
}
