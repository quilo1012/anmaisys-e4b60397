import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * Quality's "Reports" and Production Performance's report, clicked in a real browser
 * while the read they are built from fails.
 *
 * Both screens keep their rows as `data = []` until the read succeeds, and both used
 * to build the PDF from that default — a well-formed report of an empty period. Here
 * the read is made to fail and the test asserts that nothing is downloaded and the
 * user is told why. Every Supabase call is answered in the spec; nothing reaches the
 * network.
 */

const PROJECT_REF = "ybtrzqzliepknpzqdajx";
const FAKE_SESSION = {
  access_token: "fixture-access-token",
  refresh_token: "fixture-refresh-token",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: 4_102_444_800,
  user: {
    id: "00000000-0000-4000-8000-0000000000ad",
    aud: "authenticated",
    role: "authenticated",
    email: "fixture-admin@fixture.local",
    app_metadata: {},
    user_metadata: {},
    created_at: "2026-01-01T00:00:00Z",
  },
};

/** `failing`: REST tables whose reads answer 503. */
async function stub(page: Page, failing: string[]) {
  await page.addInitScript(
    ([ref, session]) => window.localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(session)),
    [PROJECT_REF, FAKE_SESSION] as const,
  );
  await page.route(/supabase\.co/, async (route: Route) => {
    const url = route.request().url();
    const json = (data: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
    if (url.includes("/auth/v1/user")) return json(FAKE_SESSION.user);
    if (url.includes("/auth/v1/token")) return json(FAKE_SESSION);
    if (url.includes("/rpc/get_user_role")) return json("admin");
    if (url.includes("/rpc/has_role") || url.includes("/rpc/is_owner")) return json(true);
    if (url.includes("/rpc/") && /single|maybe/.test(url)) return json(null);
    if (url.includes("/profiles")) {
      return json([{ id: FAKE_SESSION.user.id, name: "Fixture Admin", email: FAKE_SESSION.user.email, active: true }]);
    }
    if (failing.some((t) => url.includes(`/rest/v1/${t}?`))) return json({ message: "upstream timeout" }, 503);
    return json([]);
  });
  let downloads = 0;
  page.on("download", () => { downloads++; });
  return () => downloads;
}

test.use({ viewport: { width: 1440, height: 900 } });

test("Quality: the PDF report is not downloaded when the actions cannot be read", async ({ page }) => {
  const downloads = await stub(page, ["quality_actions"]);
  await page.goto("/dashboard/quality");
  await page.getByRole("button", { name: /^Reports$/ }).click({ timeout: 20_000 });
  await page.getByRole("menuitem", { name: "Print report (PDF)" }).click();
  await expect(page.getByText(/Report not downloaded: the quality actions/).first()).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(500);
  expect(downloads()).toBe(0);
});

test("Quality: with every read answered, the same click does download", async ({ page }) => {
  const downloads = await stub(page, []);
  await page.goto("/dashboard/quality");
  // Wait for the reads to settle: the empty-state copy is drawn once they have.
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /^Reports$/ }).click({ timeout: 20_000 });
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 15_000 }),
    page.getByRole("menuitem", { name: "Print report (PDF)" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  expect(downloads()).toBe(1);
});

test("Production Performance: the report is not drawn when the production figures cannot be read", async ({ page }) => {
  const downloads = await stub(page, ["production_sessions"]);
  await page.goto("/dashboard/production-performance");
  await page.getByRole("button", { name: /^Print$/ }).first().click({ timeout: 20_000 });
  await expect(page.getByText(/Report not downloaded: the production figures/).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Report preview")).toHaveCount(0);
  expect(downloads()).toBe(0);
});
