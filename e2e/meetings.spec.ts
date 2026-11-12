import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * Meetings, in a real browser: the next-meeting strip turning urgent, the line for now,
 * scheduling from the keyboard, and the phone's week strip. Same fixture as messages:
 * a fake admin session and every Supabase call answered here; nothing reaches the network.
 */

const PROJECT_REF = "apblxaaktftinstoidvp";
const ME = "00000000-0000-4000-8000-0000000000ad";
const FAKE_SESSION = {
  access_token: "fixture-access-token",
  refresh_token: "fixture-refresh-token",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: 4_102_444_800,
  user: {
    id: ME, aud: "authenticated", role: "authenticated", email: "fixture-admin@fixture.local",
    app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z",
  },
};

const inMins = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
const meeting = (id: string, title: string, from: number, to: number, over: Record<string, unknown> = {}) => ({
  id, series_id: id, title, description: null, starts_at: inMins(from), ends_at: inMins(to), location: "Meeting room 1",
  video_link: "https://teams.microsoft.com/l/fixture", recurrence: "none", recurrence_until: null, created_by: ME,
  cancelled_at: null, my_response: "accepted", ...over,
});
const MEETINGS = [
  meeting("10000000-0000-4000-8000-000000000001", "Daily line review", 10, 40),
  meeting("10000000-0000-4000-8000-000000000002", "Allergen changeover briefing", 26 * 60, 26 * 60 + 30, { my_response: "pending", video_link: null }),
  // Past this week, so every empty day of the week has a next meeting to point at.
  meeting("10000000-0000-4000-8000-000000000003", "Monthly quality review", 10 * 24 * 60, 10 * 24 * 60 + 60),
];

async function stub(page: Page) {
  await page.addInitScript(
    ([ref, session]) => window.localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(session)),
    [PROJECT_REF, FAKE_SESSION] as const,
  );
  await page.route(/supabase\.co/, async (route: Route) => {
    const url = route.request().url();
    const json = (data: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
    if (url.includes("/auth/v1/user")) return json(FAKE_SESSION.user);
    if (url.includes("/auth/v1/token")) return json(FAKE_SESSION);
    if (url.includes("/rpc/get_user_role")) return json("admin");
    if (url.includes("/rpc/has_role") || url.includes("/rpc/is_owner")) return json(false);
    if (url.includes("/rpc/my_meetings") || url.includes("/rpc/my_upcoming_meetings")) return json(MEETINGS);
    if (url.includes("/rpc/my_meeting")) return json([]);
    if (url.includes("/rpc/meeting_participant_list")) return json([]);
    if (url.includes("/rpc/meeting_invitable_people")) return json([]);
    if (url.includes("/profiles")) return json([{ id: ME, name: "Ada Admin", email: FAKE_SESSION.user.email, active: true, avatar_path: null }]);
    if (url.includes("/rpc/") && /single|maybe/.test(url)) return json(null);
    return json([]);
  });
}

async function overflowX(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

test.describe("on a desk", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("the next meeting turns urgent, now is drawn, and a slot opens from the keyboard", async ({ page }) => {
    await stub(page);
    await page.goto("/dashboard/communication/meetings");

    const next = page.getByRole("region", { name: "Your next meeting" });
    await expect(next).toContainText("Daily line review");
    await expect(next).toContainText(/Starts in (9|10) min/);
    await expect(next.getByRole("link", { name: "Join" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Waiting for your answer (1)" })).toBeVisible();
    await page.screenshot({ path: "e2e/.results/meetings-desk.png" });

    const slot = page.getByRole("button", { name: /^New meeting on / }).first();
    await slot.focus();
    await expect(slot).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(await overflowX(page)).toBeLessThanOrEqual(0);
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the week strip marks busy days and an empty day points at the next meeting", async ({ page }) => {
    await stub(page);
    await page.goto("/dashboard/communication/meetings");

    const strip = page.getByRole("group", { name: "Days of this week" });
    await expect(strip.getByRole("button", { pressed: true })).toHaveAccessibleName(/1 meeting$/);
    for (const b of await strip.getByRole("button").all()) {
      expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({ path: "e2e/.results/meetings-phone.png", fullPage: true });
    expect(await overflowX(page)).toBeLessThanOrEqual(0);

    await strip.getByRole("button", { name: /no meetings$/ }).first().click();
    await expect(page.getByText(/^No meetings on /)).toBeVisible();
    await expect(page.getByRole("button", { name: /^Next: / })).toBeVisible();
    await page.screenshot({ path: "e2e/.results/meetings-phone-empty-day.png", fullPage: true });
  });
});
