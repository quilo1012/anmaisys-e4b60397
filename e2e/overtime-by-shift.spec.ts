import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * Overtime Management, in a real browser, at a desk and on a phone.
 *
 * jsdom can say the Day and Night sections exist; it cannot say they fit a 390px
 * screen without the decision buttons sliding off the edge. Every request to Supabase
 * is answered here — nothing reaches the production database.
 */

const REF = "ybtrzqzliepknpzqdajx";
const SESSION = {
  access_token: "t", refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: 4_102_444_800,
  user: { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "a@f.local", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" },
};
const PROFILE = { id: SESSION.user.id, name: "Office", email: SESSION.user.email, active: true };

const day = (n: number) => {
  const d = new Date(Date.now() + n * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const ask = (id: string, on_date: string, starts_at: string, ends_at: string, headcount: number, extra = {}) => ({
  id, on_date, starts_at, ends_at, headcount, department: null, shift_group: null, note: null,
  status: "open", created_by: SESSION.user.id, created_at: "2026-10-12T10:00:00Z", closed_at: null, ...extra,
});
const REQUESTS = [
  ask("d1", day(1), "06:00:00", "18:00:00", 4, { department: "Packing", note: "Line 3, packing. Bring safety boots." }),
  ask("n1", day(1), "18:00:00", "06:00:00", 3),
  ask("n2", day(2), "18:00:00", "06:00:00", 2, { shift_group: "Night" }),
];
const ROSTER = [
  ["e1", "Rosana Garcia Cardozo", "Packing", "Day"], ["e2", "Daniel Quilo", "Packing", "Night"],
  ["e3", "Daniel", "Blending", "Day"], ["e4", "Daniel", "Warehouse", "Night"],
  ["e5", "Welligton Segat", "Packing", "Night"], ["e6", "Felipe Pinelli", "Blending", "Day"],
].map(([id, full_name, department, shift_group]) => ({ id, full_name, department, shift_group }));
let k = 0;
const resp = (request_id: string, employee_id: string, decision: string | null, answer = "yes") => ({
  id: `r${++k}`, request_id, employee_id, answer, decision,
  answered_at: "2026-10-12T10:00:00Z", decided_at: null,
});
const RESPONSES = [
  resp("d1", "e1", "accepted"), resp("d1", "e3", null), resp("d1", "e6", "reserve"), resp("d1", "e4", null, "no"),
  resp("n1", "e1", null), resp("n1", "e2", "accepted"), resp("n1", "e5", null),
];
// e5 is already on the night board tomorrow; e1 is rostered on the day tomorrow.
const BOARD = [
  { on_date: day(1), shift: "Night", employee_id: "e5", status: "assigned" },
  { on_date: day(1), shift: "Day", employee_id: "e1", status: "overtime" },
];

async function open(page: Page, width: number) {
  await page.addInitScript(([ref, s]) => {
    window.localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(s));
    window.sessionStorage.setItem("pin-ok:workforce", "1");
  }, [REF, SESSION] as const);
  await page.route(/supabase\.co/, async (route: Route) => {
    const url = route.request().url();
    const json = (d: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(d) });
    if (url.includes("/auth/v1/user")) return json(SESSION.user);
    if (url.includes("/auth/v1/token")) return json(SESSION);
    if (url.includes("/rpc/get_user_role")) return json("manager");
    if (url.includes("/rpc/overtime_roster")) return json(ROSTER);
    if (url.includes("/rest/v1/overtime_requests")) return json(REQUESTS);
    if (url.includes("/rest/v1/overtime_responses")) return json(RESPONSES);
    if (url.includes("/rest/v1/daily_allocations")) return json(BOARD);
    if (url.includes("/rest/v1/overtime_rules")) return json(null);
    if (url.includes("/rest/v1/profiles")) return json(PROFILE);
    return json([]);
  });
  await page.setViewportSize({ width, height: 1400 });
  await page.goto("/dashboard/overtime");
  await expect(page.getByRole("heading", { name: "Overtime Management" })).toBeVisible({ timeout: 20000 });
  await expect(page.getByText("Welligton Segat").first()).toBeVisible({ timeout: 15000 });
}

for (const [label, width] of [["desktop", 1440], ["tablet", 1005], ["phone", 390]] as const) {
  test(`overtime by shift fits the ${label} (${width}px)`, async ({ page }) => {
    await open(page, width);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, "the page scrolls sideways").toBeLessThanOrEqual(0);

    const night = page.getByRole("region", { name: /Night shift/ });
    await expect(night.getByText(/Already rostered on the night shift/)).toBeVisible();
    await expect(night.getByRole("button", { name: "Accept Welligton Segat" })).toBeDisabled();
    // Every decision button is on screen, not cut off at the right edge.
    for (const b of await page.getByRole("button", { name: /^(Accept|Reserve|Decline) / }).all()) {
      const box = await b.boundingBox();
      expect(box && box.x + box.width).toBeLessThanOrEqual(width);
    }
    await page.screenshot({ path: `e2e/.results/overtime-${label}.png`, fullPage: true });
  });
}

test("the Night tab shows only night asks", async ({ page }) => {
  await open(page, 1440);
  await page.getByRole("tab", { name: /Night shift/ }).click();
  await expect(page.getByRole("region", { name: /Day shift/ })).toHaveCount(0);
  await expect(page.getByText("Line 3, packing", { exact: false })).toHaveCount(0);
  await expect(page.getByRole("region", { name: /Night shift/ }).getByText("Daniel Quilo")).toBeVisible();
});
