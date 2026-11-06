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

const PROJECT_REF = "apblxaaktftinstoidvp";
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
const historyOn = (line: number) => {
  const sessions = [1, 2, 3, 4, 5].map((d) => ({ id: `h${d}`, line: `Line ${line}`, session_date: `2026-10-0${d}`, shift: "DAY" }));
  return { sessions, items: sessions.map((h) => ({ session_id: h.id, display_order: 1, sku_id: "sku-col", sku_code_text: null, actual_qty: 6362 })) };
};

async function stub(page: Page, cycles: unknown[] = [], history = false, items: unknown[] = ITEMS, historyLine = 2, queue: unknown[] = [], forecasts: unknown[] = []) {
  const { sessions: HISTORY_SESSIONS, items: HISTORY_ITEMS } = historyOn(historyLine);
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
    if (url.includes("/smart_target_queue_snapshots")) return json(queue);
    if (url.includes("/smart_target_forecasts")) return json(forecasts);
    if (url.includes("/production_sessions")) return json(url.includes(`session_date=lte.${DATE}`) ? SESSIONS : history ? HISTORY_SESSIONS : []);
    if (url.includes("/production_items")) return json(url.includes("planned_qty") ? items : history ? HISTORY_ITEMS : []);
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
  await expect(page.getByTestId("smart-target-line-1")).toContainText("Not enough data");
  await expect(page.getByRole("button", { name: "Import iTouch cycles" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("forecasts Line 2 from its own last eight weeks, and says why Line 1 has no number", async ({ page }) => {
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
  await expect(line1).toContainText("Not enough data");
  await page.screenshot({ path: "e2e/.results/smart-target-forecast.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("uses the rate the line reached where iTouch's cycle is wrong, and lists the cycle to fix", async ({ page }) => {
  const at = "2026-11-04T20:16:00Z";
  const src = "iTouch Product Details (test)";
  // Line 5 has no base. Its COL165SR cycle has the decimal point in the wrong place, as
  // Line 4's PERUCRE500 did on 05/11 (0.31 s), and the five history shifts filled only it.
  const errors = await stub(page, [
    { machine: "Filler Line 5", sku: "COL165SR", cycle_seconds: 0.31, cavities: null, source: src, imported_at: at },
    { machine: "Filler Line 1", sku: "ABEENG", cycle_seconds: 3.5, cavities: null, source: src, imported_at: at },
  ], true, [
    { id: "i21", session_id: "s2", display_order: 1, sku_id: "sku-col", sku_code_text: null, planned_qty: 3000 },
    { id: "i51", session_id: "s5", display_order: 1, sku_id: "sku-col", sku_code_text: null, planned_qty: 3000 },
  ], 5);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await open(page);

  const line5 = page.getByTestId("smart-target-line-5");
  await expect(line5).toContainText("Rate from the line's last 5 shifts of this product");
  await expect(line5).toContainText("3,000");
  await expect(line5).not.toContainText("No rate for COL165SR");

  const fix = page.getByTestId("smart-target-fix-itouch");
  await expect(fix).toContainText("COL165SR");
  await expect(fix).toContainText("0.31 s");
  await expect(fix).toContainText("COLLAGEN 165G STRAWBERRY");
  await expect(fix).toContainText(/Target [\d,]+\/h/);
  await page.screenshot({ path: "e2e/.results/smart-target-why.png", fullPage: true });
  await expect(line5).toContainText("Why this target");
  await expect(fix).toContainText("31,810");
  await expect(fix).toContainText("Has a rate from the line's recent shifts");
  expect(errors).toEqual([]);
});

test("with nothing in Production Control, the plan is iTouch's queue, batches as one job", async ({ page }) => {
  const at = "2026-11-03T07:00:00Z";
  const errors = await stub(page, [
    { machine: "Filler Line 2", sku: "COL165SR", cycle_seconds: 2.9, cavities: null, source: "iTouch (test)", imported_at: at },
  ], true, [], 2, [
    { line: "Line 2", seq: 15, sku: "COL165SR - B15", order_qty: 2500, done_qty: 0, status: "Scheduled", fetched_at: at },
    { line: "Line 2", seq: 16, sku: "COL165SR - B16", order_qty: 2500, done_qty: 0, status: "Scheduled", fetched_at: at },
  ]);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await open(page);
  const line2 = page.getByTestId("smart-target-line-2");
  await expect(line2).toContainText("COL165SR");
  await expect(line2).not.toContainText("B15");
  await expect(line2).toContainText("Order 5,000");
  await expect(line2).toContainText("Plan from the iTouch queue read at 07:00");
  await expect(line2).toContainText("Rate from the line's last 5 shifts of this product");
  await expect(line2).toContainText("Why this target");
  expect(errors).toEqual([]);
});

test("forecasts the last job with no order as the line's capacity to the end of the shift", async ({ page }) => {
  const at = "2026-11-04T20:16:00Z";
  const src = "iTouch Product Details (test)";
  const errors = await stub(page, [
    { machine: "Filler Line 5", sku: "MMMG2V", cycle_seconds: 7.8, cavities: null, source: src, imported_at: at },
    { machine: "Filler Line 5", sku: "COL165SR", cycle_seconds: 2.9, cavities: null, source: src, imported_at: at },
  ], true, [
    { id: "i51", session_id: "s5", display_order: 1, sku_id: "sku-mm", sku_code_text: null, planned_qty: 0 },
    { id: "i52", session_id: "s5", display_order: 2, sku_id: "sku-mm", sku_code_text: null, planned_qty: null },
  ], 5);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await open(page);
  const line5 = page.getByTestId("smart-target-line-5");
  await expect(line5).toContainText("No order quantity: runs to the end of the shift");
  await expect(line5).toContainText("Forecast");
  await expect(line5).not.toContainText("Not enough data");
  expect(errors).toEqual([]);
});

test("fills a missing order quantity from the iTouch queue saved for the shift", async ({ page }) => {
  const at = "2026-11-04T20:16:00Z";
  const src = "iTouch Product Details (test)";
  const errors = await stub(page, [
    { machine: "Filler Line 5", sku: "MMMG2V", cycle_seconds: 7.8, cavities: null, source: src, imported_at: at },
    { machine: "Filler Line 5", sku: "COL165SR", cycle_seconds: 2.9, cavities: null, source: src, imported_at: at },
  ], true, [
    { id: "i51", session_id: "s5", display_order: 1, sku_id: "sku-mm", sku_code_text: null, planned_qty: 0 },
  ], 5, [
    { line: "Line 5", seq: 1, sku: "MMMG2V-B3", order_qty: 800, done_qty: 300, status: "Running", fetched_at: "2026-11-03T06:04:00Z" },
  ]);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await open(page);
  await expect(page.getByText("Order quantities: iTouch queue read at 06:04.")).toBeVisible();
  const line5 = page.getByTestId("smart-target-line-5");
  await expect(line5).toContainText("Order 500"); // 800 ordered − 300 already made
  await expect(line5).toContainText("Order completes at this rate");
  await expect(line5).toContainText("from the iTouch queue read at 06:04");
  expect(errors).toEqual([]);
});

test("reads iTouch once for the shift running now, saves it, and then reads only the saved copy", async ({ page }) => {
  await page.addInitScript(([ref, session]) => {
    window.localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(session));
  }, [PROJECT_REF, FAKE_SESSION] as const);
  let saved: unknown[] = [];
  const calls = { itouch: 0, save: 0 };
  await page.route(/supabase\.co/, async (route: Route) => {
    const url = route.request().url();
    const json = (data: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
    if (url.includes("/auth/v1/user")) return json(FAKE_SESSION.user);
    if (url.includes("/auth/v1/token")) return json(FAKE_SESSION);
    if (url.includes("/rpc/get_user_role")) return json("admin");
    if (url.includes("/rpc/has_role") || url.includes("/rpc/is_owner")) return json(true);
    if (url.includes("/functions/v1/intouch-list-scheduled-jobs")) {
      calls.itouch++;
      return json({ sections: [{ line: "Line 5", items: [{ sku_code: "MMMG2V", qty: 900, actual: 0, status: "Running", seq: 1 }] }] });
    }
    if (url.includes("/rpc/save_smart_target_queue")) {
      calls.save++;
      const body = route.request().postDataJSON() as { p_rows: Record<string, unknown>[] };
      saved = body.p_rows.map((r) => ({ ...r, fetched_at: new Date().toISOString() }));
      return json({ saved: true, rows: saved.length });
    }
    if (url.includes("/smart_target_queue_snapshots")) return json(saved);
    if (url.includes("/rpc/") && /single|maybe/.test(url)) return json(null);
    if (url.includes("/profiles")) return json([{ id: FAKE_SESSION.user.id, name: "Fixture Admin", email: FAKE_SESSION.user.email, active: true }]);
    return json([]);
  });
  // No date picked: the page opens on the shift running now, the only one iTouch can describe.
  await page.goto("/dashboard/smart-target");
  await expect(page.getByText(/Order quantities: iTouch queue read at \d\d:\d\d\./)).toBeVisible();
  await page.waitForTimeout(1500);
  expect(calls).toEqual({ itouch: 1, save: 1 });
  expect(saved).toEqual([expect.objectContaining({ line: "Line 5", seq: 1, sku: "MMMG2V", order_qty: 900, done_qty: 0 })]);
});

test("shows how close the kept forecasts were, against what was logged", async ({ page }) => {
  const at = "2026-11-04T20:16:00Z";
  const errors = await stub(page, [
    { machine: "Filler Line 2", sku: "COL165SR", cycle_seconds: 2.9, cavities: null, source: "test", imported_at: at },
  ], true, ITEMS, 2, [], [
    // History has 6362 logged on Line 2 each of 01–05/10 (DAY).
    { session_date: "2026-10-01", shift: "DAY", line: 2, shown: true, expected_total: 6000, frozen_at: "2026-10-01T05:10:00Z" }, // −5.7%
    { session_date: "2026-10-02", shift: "DAY", line: 2, shown: true, expected_total: 7600, frozen_at: "2026-10-02T05:20:00Z" }, // +19.5%
    { session_date: "2026-10-03", shift: "DAY", line: 2, shown: true, expected_total: 6400, frozen_at: "2026-10-03T12:00:00Z" }, // made late
  ]);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await open(page);
  const card = page.getByTestId("smart-target-accuracy");
  const row2 = card.getByRole("row", { name: /^Line 2/ });
  await expect(row2).toContainText("2"); // shifts measured
  await expect(row2).toContainText("12.6%"); // median of 5.7 and 19.5
  await expect(row2).toContainText("50%"); // within ±10%
  await expect(row2).toContainText("100%"); // within ±20%
  await expect(row2).toContainText("1 made late");
  await expect(card.getByRole("row", { name: /^Line 1\b/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test("keeps the running shift's forecast once, every line alike", async ({ page }) => {
  await page.addInitScript(([ref, session]) => {
    window.localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(session));
  }, [PROJECT_REF, FAKE_SESSION] as const);
  const saves: { p_rows: { line: number; shown: boolean; expected_total: number | null }[] }[] = [];
  const hist = historyOn(2);
  await page.route(/supabase\.co/, async (route: Route) => {
    const url = route.request().url();
    const json = (data: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
    if (url.includes("/auth/v1/user")) return json(FAKE_SESSION.user);
    if (url.includes("/auth/v1/token")) return json(FAKE_SESSION);
    if (url.includes("/rpc/get_user_role")) return json("admin");
    if (url.includes("/rpc/has_role") || url.includes("/rpc/is_owner")) return json(true);
    if (url.includes("/rpc/save_smart_target_forecasts")) { saves.push(route.request().postDataJSON()); return json({ saved: 2 }); }
    if (url.includes("/functions/v1/intouch-list-scheduled-jobs")) return json({ sections: [] });
    if (url.includes("/itouch_cycle_times")) return json([
      { machine: "Filler Line 2", sku: "COL165SR", cycle_seconds: 2.9, cavities: null, source: "t", imported_at: "2026-11-01T00:00:00Z" },
      { machine: "Filler Line 1", sku: "COL165SR", cycle_seconds: 2.9, cavities: null, source: "t", imported_at: "2026-11-01T00:00:00Z" },
    ]);
    if (url.includes("/production_sessions")) {
      if (url.includes("order=id")) return json([...hist.sessions, ...hist.sessions.map((h) => ({ ...h, id: `${h.id}b`, line: "Line 1" }))]);
      const today = /session_date=lte\.(\d{4}-\d{2}-\d{2})/.exec(url)?.[1] ?? "";
      return json(["DAY", "NIGHT"].flatMap((sh) => [
        { id: `t2${sh}`, line: "Line 2", session_date: today, shift: sh },
        { id: `t1${sh}`, line: "Line 1", session_date: today, shift: sh },
      ]));
    }
    if (url.includes("/production_items")) {
      if (!url.includes("planned_qty")) return json([...hist.items, ...hist.items.map((i) => ({ ...i, session_id: `${i.session_id}b` }))]);
      return json(["DAY", "NIGHT"].flatMap((sh) => [
        { id: `i2${sh}`, session_id: `t2${sh}`, display_order: 1, sku_id: "sku-col", sku_code_text: null, planned_qty: 0 },
        { id: `i1${sh}`, session_id: `t1${sh}`, display_order: 1, sku_id: "sku-col", sku_code_text: null, planned_qty: 0 },
      ]));
    }
    if (url.includes("/sku_products")) return json(SKUS);
    if (url.includes("/rpc/") && /single|maybe/.test(url)) return json(null);
    if (url.includes("/profiles")) return json([{ id: FAKE_SESSION.user.id, name: "Fixture Admin", email: FAKE_SESSION.user.email, active: true }]);
    return json([]);
  });
  await page.goto("/dashboard/smart-target");
  await expect.poll(() => saves.length, { timeout: 15000 }).toBe(1);
  await page.waitForTimeout(1500);
  expect(saves).toHaveLength(1);
  const rows = saves[0].p_rows.sort((a, b) => a.line - b.line);
  expect(rows.map((r) => [r.line, r.shown, r.expected_total !== null])).toEqual([[1, true, true], [2, true, true]]);
});

test("a line shows the target kept for the shift, what was logged, and not the recalculation as the target", async ({ page }) => {
  const at = `${DATE}T07:39:00Z`;
  const items = [{ id: "i21", session_id: "s2", display_order: 1, sku_id: "sku-col", sku_code_text: null, planned_qty: 3000, created_at: at, actual_qty: 1432 }];
  await stub(page, [
    { machine: "Filler Line 2", sku: "COL165SR", cycle_seconds: 2.9, cavities: null, source: "t", imported_at: at },
  ], true, items, 2, [], [
    { session_date: DATE, shift: "DAY", line: 2, shown: true, expected_total: 2903, frozen_at: at, jobs: [], engine_version: "smart-target-engine/1.0" },
  ]);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await open(page);
  const line2 = page.getByTestId("smart-target-line-2");
  await expect(line2).toContainText("2,903");
  await expect(line2).toContainText("target set 07:39");
  await expect(page.getByTestId("smart-target-logged-2")).toHaveText(/Logged 1,432 · target \+103%/);
  await expect(line2).toContainText("Calculated now: 3,000");
});

