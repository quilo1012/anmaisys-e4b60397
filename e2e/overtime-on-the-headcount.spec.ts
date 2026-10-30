import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * Overtime placed on the Headcount by hand, and overtime worked past the last clock
 * import, on a phone. 30/10/2026, Ailton Junior: Where I'm working said "Overtime" for
 * Saturday, My Overtime said "0 Accepted", and My Attendance said "Overtime 0 h" after
 * two weekend shifts. Every request to Supabase is answered here — nothing reaches
 * production.
 */

const REF = "ybtrzqzliepknpzqdajx";
const SESSION = {
  access_token: "t", refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: 4_102_444_800,
  user: { id: "00000000-0000-4000-8000-000000000003", aud: "authenticated", role: "authenticated", email: "e003@f.local", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" },
};
const PROFILE = { id: SESSION.user.id, name: "Ailton Junior", email: SESSION.user.email, active: true };

const day = (n: number) => {
  const d = new Date(Date.now() + n * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const ME = { id: "e-003", full_name: "Ailton Junior", department: "Production", shift_group: "Day" };
const ASK = {
  id: "22222222-2222-4222-8222-222222222222", on_date: day(2), starts_at: "06:00:00", ends_at: "18:00:00",
  headcount: null, department: null, shift_group: null, note: null,
  status: "open", created_by: "boss", created_at: new Date().toISOString(), closed_at: null,
};
const ATTENDANCE = {
  me: { id: "e-003", full_name: "Ailton Junior", employee_ref: "E003", department: "Production", position: "Team Leader", shift_group: "Day", started_on: null },
  pattern: { name: "Tue–Fri days", days: [2, 3, 4, 5], starts_at: "06:00:00", ends_at: "18:00:00", break_minutes: 0, annual_leave_days: 22.5 },
  clocks: [{ on_date: day(-10), start_time: "6:00", end_time: "18:00", worked_minutes: 720, balance_minutes: 0, scheduled_minutes: 720, overtime_adj_minutes: 0, absence_name: null }],
  clocked_to: day(-10), clocks_imported_at: new Date().toISOString(),
  marks: [], holiday_marks: [], requests: [], payroll: [], overtime: [],
  board: [{ on_date: day(1), shift: "Day", status: "overtime", half_day: false, area: "Line 2", area_kind: "production", is_leader: false }],
  periods: [{ id: "p", name: "October 2026", start_date: day(-18), end_date: day(9) }],
};
const WORKED = [
  { id: "r1", overtime_requests: { on_date: day(-6), starts_at: "06:00:00", ends_at: "18:00:00", status: "open" } },
  { id: "r2", overtime_requests: { on_date: day(-5), starts_at: "06:00:00", ends_at: "14:00:00", status: "open" } },
];

async function open(page: Page, path: string) {
  await page.addInitScript(([ref, s]) => {
    window.localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(s));
  }, [REF, SESSION] as const);
  await page.route(/supabase\.co/, async (route: Route) => {
    const url = route.request().url();
    const json = (d: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(d) });
    if (url.includes("/auth/v1/user")) return json(SESSION.user);
    if (url.includes("/auth/v1/token")) return json(SESSION);
    if (url.includes("/rpc/get_user_role")) return json("employee");
    if (url.includes("/rpc/my_overtime_identity")) return json([ME]);
    if (url.includes("/rpc/my_attendance")) return json(ATTENDANCE);
    if (url.includes("/rpc/overtime_places")) return json([]);
    if (url.includes("/rpc/my_overtime_block")) return json([]);
    if (url.includes("/rpc/my_overtime_clashes")) return json([]);
    if (url.includes("/rest/v1/overtime_requests")) return json([ASK]);
    if (url.includes("/rest/v1/overtime_responses") && url.includes("overtime_requests")) return json(WORKED);
    if (url.includes("/rest/v1/overtime_outcomes")) return json([{ response_id: "r1", outcome: "attended" }, { response_id: "r2", outcome: "attended" }]);
    if (url.includes("/rest/v1/profiles")) return json(PROFILE);
    return json([]);
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(path);
}

const sideways = (page: Page) =>
  page.evaluate(() => {
    const main = document.getElementById("main-content");
    return Math.max(
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
      main ? main.scrollWidth - main.clientWidth : 0,
    );
  });

test("My Overtime lists the Headcount booking and counts it as accepted (390px)", async ({ page }) => {
  await open(page, "/dashboard/my-overtime");
  const card = page.getByTestId("board-booking");
  await expect(card).toBeVisible({ timeout: 20000 });
  await expect(card).toContainText("Line 2");
  await expect(card).toContainText("You're in");
  await expect(page.getByRole("button", { name: /^1\s*Accepted$/ })).toBeVisible();
  expect(await sideways(page), "page scrolls sideways").toBeLessThanOrEqual(0);
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/my-overtime-board-booking-phone.png", fullPage: false });
});

test("My Attendance shows the attended shifts beside the clock's figure (390px)", async ({ page }) => {
  await open(page, "/dashboard/my-attendance");
  const box = page.getByTestId("overtime-shifts");
  await expect(box).toBeVisible({ timeout: 20000 });
  await expect(box).toContainText("20 h");
  await expect(box).toContainText("on the Headcount");
  await expect(page.getByTestId("hours-balance")).toContainText("not in this figure yet");
  expect(await sideways(page), "page scrolls sideways").toBeLessThanOrEqual(0);
  await page.getByTestId("hours-balance").screenshot({ path: "test-results/my-attendance-overtime-shifts-phone.png" });
});
