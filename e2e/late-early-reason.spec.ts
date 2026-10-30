import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * The reason for a late start or an early finish (BLOCO 139), on a phone, in the board's
 * day dialog. Every request to Supabase is answered here — nothing reaches production — and
 * the save is captured, not written.
 */

const REF = "ybtrzqzliepknpzqdajx";
const SESSION = {
  access_token: "t", refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: 4_102_444_800,
  user: { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "a@f.local", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" },
};
const PROFILE = { id: SESSION.user.id, name: "Office", email: SESSION.user.email, active: true };
const AREAS = [
  { id: "gp", name: "Gel Packing", kind: "production", section: "production", sort_order: 10, active: true, sheet_label: null, sheet_group: null },
  { id: "l1", name: "Line 1", kind: "production", section: "production", sort_order: 20, active: true, sheet_label: null, sheet_group: null },
];
const EMP = [
  { id: "e1", full_name: "Talita Melech", department: null, active: true, shift_group: "B", start_date: "2024-01-08", end_date: null, role: null },
  { id: "e2", full_name: "Pedro Assis", department: null, active: true, shift_group: "B", start_date: "2024-01-08", end_date: null, role: null },
];
const ALLOCS = [
  { id: "a1", employee_id: "e1", on_date: "2026-10-30", shift: "Day", area_id: "gp", status: "assigned", half_day: false,
    left_early_at: "11:00:00", arrived_late_at: null, left_early_reason: null, arrived_late_reason: null, note: null, is_leader: false },
  { id: "a2", employee_id: "e2", on_date: "2026-10-30", shift: "Day", area_id: "l1", status: "assigned", half_day: false,
    left_early_at: null, arrived_late_at: null, left_early_reason: null, arrived_late_reason: null, note: null, is_leader: false },
];

test("the dialog asks why Talita went home at 11:00, and saves it once (390px)", async ({ page }) => {
  const saves: unknown[] = [];
  await page.addInitScript(([ref, s]) => {
    window.localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(s));
    window.sessionStorage.setItem("pin-ok:workforce", "1");
  }, [REF, SESSION] as const);
  await page.route(/supabase\.co/, async (route: Route) => {
    const req = route.request();
    const url = req.url();
    const json = (d: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(d) });
    if (url.includes("/auth/v1/user")) return json(SESSION.user);
    if (url.includes("/auth/v1/token")) return json(SESSION);
    if (url.includes("/rpc/get_user_role")) return json("admin");
    if (url.includes("/rest/v1/headcount_areas")) return json(AREAS);
    if (url.includes("/rest/v1/daily_allocations")) {
      if (req.method() === "PATCH") { saves.push(req.postDataJSON()); return route.fulfill({ status: 204, body: "" }); }
      return json(ALLOCS);
    }
    if (url.includes("/rest/v1/employees")) return json(EMP);
    if (url.includes("/rest/v1/profiles")) return json(PROFILE);
    return json([]);
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard/headcount");
  await page.getByRole("tab", { name: "Day" }).click();
  await page.locator(".headcount-columns").getByText("Talita Melech").first().click({ timeout: 20000 });

  const box = page.getByLabel("Reason for leaving early");
  await expect(box).toBeVisible();
  await expect(page.getByLabel("Reason for arriving late")).toHaveCount(0);
  await box.fill("Doctor's appointment");
  expect(saves).toEqual([]);
  await box.press("Enter");
  await expect.poll(() => saves.length).toBe(1);
  expect(saves[0]).toEqual({ left_early_reason: "Doctor's appointment" });

  const overflow = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]') as HTMLElement | null;
    return d ? d.scrollWidth - d.clientWidth : 0;
  });
  expect(overflow, "the dialog scrolls sideways").toBeLessThanOrEqual(0);
  await box.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/late-early-reason-phone.png" });
});
