import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * My Attendance's calendar, in a real browser, on a phone and at a desk.
 *
 * jsdom can say a day is labelled "Rest day"; it cannot say the rest days stop looking
 * like the rota days, or that seven columns fit a 390px phone with the month named where
 * it turns. Every request to Supabase is answered here — nothing reaches production.
 */

const REF = "ybtrzqzliepknpzqdajx";
const SESSION = {
  access_token: "t", refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: 4_102_444_800,
  user: { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "a@f.local", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" },
};
const PROFILE = { id: SESSION.user.id, name: "Ana Silva", email: SESSION.user.email, active: true };

const day = (n: number) => {
  const d = new Date(Date.now() + n * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// A Tuesday-to-Thursday rota over four weeks around today, two of them clocked.
const ROTA = [2, 3, 4];
const past = Array.from({ length: 14 }, (_, i) => day(-14 + i))
  .filter((d) => ROTA.includes(new Date(`${d}T00:00:00Z`).getUTCDay()));
const DATA = {
  me: { id: "e-1", full_name: "Ana Silva", employee_ref: "E045", department: "Production", position: null, shift_group: "Day", started_on: null },
  pattern: { name: "Tue–Thu days", days: ROTA, starts_at: "06:00", ends_at: "18:00", break_minutes: 60, annual_leave_days: 22.5 },
  clocks: past.slice(0, 4).map((on_date, i) => ({
    on_date, start_time: "06:00", end_time: i === 0 ? "19:30" : "18:00",
    worked_minutes: i === 0 ? 750 : 660, balance_minutes: i === 0 ? 90 : 0, scheduled_minutes: 660,
    overtime_adj_minutes: 0, absence_name: null,
  })),
  clocked_to: past[3] ?? day(-1), clocks_imported_at: new Date().toISOString(),
  marks: [], holiday_marks: [], board: [], requests: [], payroll: [],
  periods: [
    { id: "prev", name: "Last period", start_date: day(-42), end_date: day(-15) },
    { id: "p", name: "This period", start_date: day(-14), end_date: day(20) },
    { id: "next", name: "Next period", start_date: day(21), end_date: day(48) },
  ],
};

const asked: { from: string; to: string }[] = [];

async function open(page: Page, width: number, height = 1600) {
  await page.addInitScript(([ref, s]) => {
    window.localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(s));
  }, [REF, SESSION] as const);
  await page.route(/supabase\.co/, async (route: Route) => {
    const url = route.request().url();
    const json = (d: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(d) });
    if (url.includes("/auth/v1/user")) return json(SESSION.user);
    if (url.includes("/auth/v1/token")) return json(SESSION);
    if (url.includes("/rpc/get_user_role")) return json("admin");
    if (url.includes("/rpc/my_attendance")) {
      const body = route.request().postDataJSON() as { p_from?: string; p_to?: string } | null;
      if (body?.p_from && body?.p_to) asked.push({ from: body.p_from, to: body.p_to });
      return json(DATA);
    }
    if (url.includes("/rest/v1/profiles")) return json(PROFILE);
    return json([]);
  });
  await page.setViewportSize({ width, height });
  await page.goto("/dashboard/my-attendance");
  await expect(page.getByTestId("pay-period-title")).toBeVisible({ timeout: 20000 });
}

for (const [label, width] of [["desktop", 1440], ["phone", 390]] as const) {
  test(`the calendar fits the ${label} and tells a rest day from a rota day (${width}px)`, async ({ page }) => {
    await open(page, width);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, "page scrolls sideways").toBeLessThanOrEqual(0);

    const rest = page.getByRole("button", { name: /: Rest day/ }).first();
    const rota = page.getByRole("button", { name: /: (Scheduled|Present|No record yet)/ }).first();
    const bg = (el: typeof rest) => el.evaluate((n) => getComputedStyle(n).backgroundColor);
    expect(await bg(rest), "a rest day is drawn like a rota day").not.toEqual(await bg(rota));

    // Seven columns of tappable size, even on the phone.
    const box = await rest.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);

    await page.locator("[aria-current=date]").scrollIntoViewIfNeeded();
    await page.getByTestId("pay-period-title").locator("xpath=ancestor::*[contains(@class,'rounded')][1]")
      .screenshot({ path: `test-results/my-attendance-calendar-${label}.png` });
  });
}

// The line tablets are Galaxy Tab A9s: about 1005×600 CSS px in landscape.
for (const [label, width, height] of [["desktop", 1440, 1000], ["tablet", 1005, 600], ["phone", 390, 844]] as const) {
  test(`the pay period sits above the calendar and steps either way on the ${label} (${width}px)`, async ({ page }) => {
    asked.length = 0;
    await open(page, width, height);
    const title = page.getByTestId("pay-period-title");
    await expect(title).toHaveText("This period (This Pay Period)");
    // No holiday count anywhere on the page.
    await expect(page.getByText(/Holiday left/i)).toHaveCount(0);

    // Right above the calendar: the title ends before the weekday row starts.
    const titleBox = (await title.boundingBox())!;
    const weekday = (await page.getByText("Mon", { exact: true }).first().boundingBox())!;
    expect(titleBox.y + titleBox.height).toBeLessThanOrEqual(weekday.y);

    const next = page.getByRole("button", { name: "Next pay period: Next period" });
    const box = (await next.boundingBox())!;
    expect(box.height, "arrow too small to tap").toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);

    await next.click();
    await expect(title).toHaveText("Next period");
    await expect.poll(() => asked.at(-1)?.from).toBe(DATA.periods[2].start_date);
    // The calendar follows: its first day is the new period's first day.
    const first = DATA.periods[2].start_date;
    await expect(page.locator("button[aria-label]").filter({ hasText: String(Number(first.slice(8))) }).first()).toBeVisible();

    await page.getByRole("button", { name: "Previous pay period: This period" }).click();
    await page.getByRole("button", { name: "Previous pay period: Last period" }).click();
    await expect(title).toHaveText("Last period");
    await expect.poll(() => asked.at(-1)?.from).toBe(DATA.periods[0].start_date);
    await expect(page.getByRole("button", { name: "No earlier pay period" })).toBeDisabled();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, "page scrolls sideways").toBeLessThanOrEqual(0);
    await title.locator("xpath=ancestor::*[contains(@class,'rounded')][1]").screenshot({ path: `test-results/pay-period-${label}.png` });
  });
}
