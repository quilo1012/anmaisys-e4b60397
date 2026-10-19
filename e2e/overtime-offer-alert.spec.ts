import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * The "OVERTIME AVAILABLE" alert in a real browser, on a phone and at a desk.
 *
 * jsdom can say the buttons exist; it cannot say they are on screen at 360px with
 * nothing cut off, or that the page under the alert does not scroll sideways. Every
 * request to Supabase is answered here — nothing reaches production, and the answer
 * the alert sends is captured, not written.
 */

const REF = "ybtrzqzliepknpzqdajx";
const SESSION = {
  access_token: "t", refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: 4_102_444_800,
  user: { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "e045@f.local", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" },
};
const PROFILE = { id: SESSION.user.id, name: "Ana Silva", email: SESSION.user.email, active: true };

const day = (n: number) => {
  const d = new Date(Date.now() + n * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const ME = { id: "e-1", full_name: "Ana Silva", department: "Production", shift_group: "Day" };
const ASK = {
  id: "11111111-1111-4111-8111-111111111111", on_date: day(3), starts_at: "18:00:00", ends_at: "06:00:00",
  headcount: 4, department: "Production", shift_group: null, note: "Line 3 changeover — bring PPE",
  status: "open", created_by: "boss", created_at: new Date().toISOString(), closed_at: null,
};

async function open(page: Page, width: number, height: number) {
  const answers: unknown[] = [];
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
    if (url.includes("/rpc/overtime_places")) return json([{ request_id: ASK.id, taken: 1, headcount: 4 }]);
    if (url.includes("/rpc/my_overtime_block")) return json([]);
    if (url.includes("/rpc/my_overtime_clashes")) return json([]);
    if (url.includes("/rpc/answer_overtime")) {
      answers.push(route.request().postDataJSON());
      return json({ id: "r1", request_id: ASK.id, employee_id: ME.id, answer: "yes", decision: "accepted" });
    }
    if (url.includes("/rest/v1/overtime_requests")) return json([ASK]);
    if (url.includes("/rest/v1/profiles")) return json(PROFILE);
    return json([]);
  });
  await page.setViewportSize({ width, height });
  await page.goto("/dashboard/my-overtime");
  const dialog = page.getByTestId("overtime-offer-alert");
  await expect(dialog).toBeVisible({ timeout: 20000 });
  return { dialog, answers };
}

for (const [label, width, height] of [["desktop", 1440, 900], ["phone", 360, 640]] as const) {
  test(`the overtime alert fits the ${label} with both answers on screen (${width}px)`, async ({ page }) => {
    const { dialog, answers } = await open(page, width, height);
    await expect(dialog.getByText("OVERTIME AVAILABLE")).toBeVisible();
    await expect(dialog.getByText("18:00–06:00")).toBeVisible();
    await expect(dialog.getByText("(12h)")).toBeVisible();
    await expect(dialog.getByText("3 of 4 places left")).toBeVisible();

    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width + 0.5);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    const accept = dialog.getByRole("button", { name: /accept overtime/i });
    const decline = dialog.getByRole("button", { name: /^decline$/i });
    for (const b of [accept, decline]) {
      await b.scrollIntoViewIfNeeded();
      await expect(b).toBeInViewport();
      const bb = await b.boundingBox();
      expect(bb!.height).toBeGreaterThanOrEqual(44);
    }

    // Keyboard: focus stays inside the alert and reaches the answer.
    await accept.focus();
    await page.keyboard.press("Enter");
    await expect(dialog.getByText("You're booked")).toBeVisible();
    expect(answers).toEqual([{ p_request_id: ASK.id, p_answer: "yes" }]);
    await dialog.getByRole("button", { name: /^done$/i }).click();
    await expect(dialog).toBeHidden();
  });
}
