import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * Smart Target, with a real-looking plan and none of the inputs the forecast is
 * still waiting for.
 *
 * That is the state the factory is in today, so it is the one worth seeing. The
 * page must show the job sequence it was given, say per line why there is no
 * number, and never print a target it did not compute. Nothing here reaches the
 * network: every Supabase call is answered from the fixtures below.
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

const DATE = "2026-11-03";
const SESSIONS = [
  { id: "s1", line: "Line 1", session_date: DATE, shift: "DAY" },
  { id: "s2", line: "Line 2", session_date: DATE, shift: "DAY" },
  { id: "s5", line: "Line 5", session_date: DATE, shift: "DAY" },
  { id: "st", line: "Tablet Line", session_date: DATE, shift: "DAY" },
  { id: "n1", line: "Line 1", session_date: DATE, shift: "NIGHT" },
];
const ITEMS = [
  { id: "i11", session_id: "s1", display_order: 1, sku_id: "sku-abe", sku_code_text: null, planned_qty: 6607 },
  { id: "i12", session_id: "s1", display_order: 2, sku_id: null, sku_code_text: "ABEENG-B2", planned_qty: 2400 },
  { id: "i13", session_id: "s1", display_order: 3, sku_id: "sku-col", sku_code_text: null, planned_qty: 0 },
  { id: "i21", session_id: "s2", display_order: 1, sku_id: "sku-col", sku_code_text: null, planned_qty: 3000 },
  { id: "i51", session_id: "s5", display_order: 1, sku_id: "sku-mm", sku_code_text: null, planned_qty: 900 },
  { id: "i52", session_id: "s5", display_order: 2, sku_id: "sku-abe", sku_code_text: null, planned_qty: 1500 },
  { id: "in1", session_id: "n1", display_order: 1, sku_id: "sku-mm", sku_code_text: null, planned_qty: 4000 },
];
const SKUS = [
  { id: "sku-abe", code: "ABEENG", name: "A.B.E 375G ENERGY", target_per_hour: 720 },
  { id: "sku-col", code: "COL165SR", name: "COLLAGEN 165G STRAWBERRY", target_per_hour: 0 },
  { id: "sku-mm", code: "MMMG2V", name: "MUSCLE MOOSE", target_per_hour: 600 },
];

// Five closed Line 2 shifts before DATE: 6362 × COL165SR at 2.9 s = 307.5 ideal min of
// 645 − 30 available, so Line 2 runs at 50% of iTouch's ideal speed.
const HISTORY_SESSIONS = [1, 2, 3, 4, 5].map((d) => ({ id: `h${d}`, line: "Line 2", session_date: `2026-10-0${d}`, shift: "DAY" }));
const HISTORY_ITEMS = HISTORY_SESSIONS.map((h) => ({ session_id: h.id, display_order: 1, sku_id: "sku-col", sku_code_text: null, actual_qty: 6362 }));

async function stub(page: Page, cycles: unknown[] = [], history = false) {
  await page.addInitScript(([ref, session]) => {
    window.localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(session));
  }, [PROJECT_REF, FAKE_SESSION] as const);
  await page.route(/supabase\.co/, async (route: Route) => {
    const url = route.request().url();
    const json = (data: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
    if (url.includes("/auth/v1/user")) return json(FAKE_SESSION.user);
    if (url.includes("/auth/v1/token")) return json(FAKE_SESSION);
    if (url.includes("/rpc/get_user_role")) return json("admin");
    if (url.includes("/rpc/has_role") || url.includes("/rpc/is_owner")) return json(true);
    if (url.includes("/rpc/") && /single|maybe/.test(url)) return json(null);
    if (url.includes("/profiles")) return json([{ id: FAKE_SESSION.user.id, name: "Fixture Admin", email: FAKE_SESSION.user.email, active: true }]);
    // The forecast reads up to DATE itself; the eight-week history stops the day before.
    if (url.includes("/production_sessions")) return json(url.includes(`session_date=lte.${DATE}`) ? SESSIONS : history ? HISTORY_SESSIONS : []);
    if (url.includes("/production_items")) return json(url.includes("actual_qty") ? (history ? HISTORY_ITEMS : []) : ITEMS);
    if (url.includes("/sku_products")) return json(SKUS);
    if (url.includes("/itouch_cycle_times")) return json(cycles);
    return json([]);
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
}

async function open(page: Page) {
  await page.goto("/dashboard/smart-target");
  await page.getByLabel("Shift date").fill(DATE);
  await page.getByRole("button", { name: "Day" }).click();
  await expect(page.getByRole("button", { name: "Day" })).toHaveAttribute("aria-pressed", "true");
  await page.mouse.move(0, 0);
  await expect(page.getByRole("heading", { name: "Line 1" })).toBeVisible();
  await page.waitForTimeout(300); // let the switch's colour transition finish before a screenshot
}

test("shows the plan, says why there is no number, and prints no target it did not compute", async ({ page }) => {
  const errors = await stub(page);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await open(page);

  // The sequence it was given, batch suffix cleaned, planned 0 shown as unknown.
  const line1 = page.getByTestId("smart-target-line-1");
  await expect(line1).toContainText("ABEENG");
  await expect(line1).toContainText("COL165SR");
  await expect(line1).toContainText("Not enough data");
  await expect(line1).toContainText("No rate for ABEENG, COL165SR.");
  // 720 sits in sku_products for ABEENG. It is a line default and must not appear.
  await expect(page.getByText("720", { exact: false })).toHaveCount(0);

  await expect(page.getByTestId("smart-target-line-3")).toContainText("No plan for this shift");
  await expect(page.getByText(/Tablet Line/)).toBeVisible();
  await page.screenshot({ path: "e2e/.results/smart-target-desktop.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("fits a phone", async ({ page }) => {
  const errors = await stub(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  const clipped = await page.evaluate(() => {
    const vw = window.innerWidth;
    let n = 0;
    document.querySelectorAll<HTMLElement>("main *").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (!r.width || r.right <= vw + 1) return;
      let p: HTMLElement | null = el.parentElement;
      while (p && p !== document.body) {
        if (["auto", "scroll"].includes(getComputedStyle(p).overflowX)) return;
        p = p.parentElement;
      }
      n++;
    });
    return n;
  });
  await page.screenshot({ path: "e2e/.results/smart-target-phone.png", fullPage: true });
  expect(clipped).toBe(0);
  expect(errors).toEqual([]);
});

test("shows the iTouch cycles it holds and lists the ones Production must fix", async ({ page }) => {
  const at = "2026-11-04T20:16:00Z";
  const src = "iTouch Product Details (Applied_Nutrition_All_Lines.xlsx, loaded 04/11/2026)";
  const row = (machine: string, sku: string, cycle_seconds: number | null) =>
    ({ machine, sku, cycle_seconds, cavities: null, source: src, imported_at: at });
  const errors = await stub(page, [
    row("Filler Line 1", "ABEENG", 3.5),
    row("Filler Line 1", "COL165SR", null),
    row("Filler Line 4", "MMMG2V", 0.31),
    row("Capsules MC 1", "CAPS1", 2),
  ]);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await open(page);

  await expect(page.getByText(/Applied_Nutrition_All_Lines\.xlsx/)).toBeVisible();
  await expect(page.getByText("1 usable").first()).toBeVisible();
  await expect(page.getByText(/For Production to fix in iTouch/)).toBeVisible();
  await page.getByText(/For Production to fix in iTouch/).click();
  await expect(page.getByRole("cell", { name: "No standard cycle time in iTouch." })).toBeVisible();
  await expect(page.getByRole("cell", { name: /below 1\.5 s/ })).toBeVisible();
  // Capsules are outside v1: left out, not reported as a fault.
  await expect(page.getByText("CAPS1")).toHaveCount(0);
  // A cycle is not a forecast. Line 1 is also one of the lines held back (Q24).
  await expect(page.getByTestId("smart-target-line-1")).toContainText("Line 1 varies too much from shift to shift");
  await expect(page.getByRole("button", { name: "Import iTouch cycles" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("forecasts Line 2 from its own last eight weeks, and holds Line 1 back with the reason", async ({ page }) => {
  const at = "2026-11-04T20:16:00Z";
  const src = "iTouch Product Details (test)";
  const errors = await stub(page, [
    { machine: "Filler Line 2", sku: "COL165SR", cycle_seconds: 2.9, cavities: null, source: src, imported_at: at },
    { machine: "Filler Line 1", sku: "ABEENG", cycle_seconds: 3.5, cavities: null, source: src, imported_at: at },
  ], true);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await open(page);

  const line2 = page.getByTestId("smart-target-line-2");
  await expect(line2).toContainText("iTouch ideal × 50%, this line's performance over 5 shifts");
  await expect(line2).toContainText("Order completes at this rate");
  await expect(line2).toContainText("Low confidence");
  await expect(line2).toContainText("3,000");

  const line1 = page.getByTestId("smart-target-line-1");
  await expect(line1).toContainText("Line 1 varies too much from shift to shift");
  await expect(line1).toContainText("Not enough data");
  await page.screenshot({ path: "e2e/.results/smart-target-forecast.png", fullPage: true });
  expect(errors).toEqual([]);
});
