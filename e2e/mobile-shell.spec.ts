import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * The phone shell, measured at the widths people actually hold.
 *
 * The four screens a supervisor opens first — Login, the dashboard, the Production
 * Dashboard and Performance — at 320 (iPhone SE), 360 (most Androids), 390 and 430
 * (current iPhones). jsdom can say a tab carries `min-h-14`; only a browser can say
 * it is 56px tall and that the date box still shows the year.
 *
 * Same fixture as every-screen-empty: a fake admin session and every Supabase call
 * answered with nothing. Nothing here reaches the network.
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

async function stubSupabase(page: Page, signedIn: boolean) {
  if (signedIn) {
    await page.addInitScript(
      ([ref, session]) => window.localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(session)),
      [PROJECT_REF, FAKE_SESSION] as const,
    );
  }
  await page.route(/supabase\.co/, async (route: Route) => {
    const url = route.request().url();
    const json = (data: unknown) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
    if (url.includes("/auth/v1/user")) return json(FAKE_SESSION.user);
    if (url.includes("/auth/v1/token")) return json(FAKE_SESSION);
    if (url.includes("/rpc/get_user_role")) return json("admin");
    if (url.includes("/rpc/has_role") || url.includes("/rpc/is_owner")) return json(true);
    if (url.includes("/rpc/") && /single|maybe/.test(url)) return json(null);
    if (url.includes("/profiles")) {
      return json([{ id: FAKE_SESSION.user.id, name: "Fixture Admin", email: FAKE_SESSION.user.email, active: true }]);
    }
    return json([]);
  });
}

/** Elements past the right edge and not inside a scroller: cut off, not reachable. */
async function clipped(page: Page) {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const out: string[] = [];
    document.querySelectorAll<HTMLElement>("body *").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || r.right <= vw + 1) return;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const ov = getComputedStyle(p).overflowX;
        if (ov === "auto" || ov === "scroll") return;
      }
      out.push(`${Math.round(r.right)}px ${el.tagName} "${(el.textContent ?? "").trim().slice(0, 30)}"`);
    });
    return out.slice(0, 5);
  });
}

const PHONES = [320, 360, 390, 430];
const SCREENS = ["/dashboard/manager", "/dashboard/departments/production", "/dashboard/production-performance"];

for (const width of PHONES) {
  test.describe(`phone ${width}px`, () => {
    test.use({ viewport: { width, height: 800 } });

    test("login fits and keeps its controls finger-sized", async ({ page }) => {
      await stubSupabase(page, false);
      await page.goto("/login");
      const submit = page.getByRole("button", { name: "Sign in" });
      await expect(submit).toBeVisible();
      expect((await submit.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      // The show-password toggle is a real control now, reachable from the keyboard.
      await expect(page.getByRole("button", { name: "Show password" })).not.toHaveAttribute("tabindex", "-1");
      expect(await clipped(page)).toEqual([]);
    });

    for (const path of SCREENS) {
      test(`${path}: header, tab bar, nothing cut off`, async ({ page }) => {
        await stubSupabase(page, true);
        await page.goto(path);

        const header = page.getByTestId("mobile-app-header");
        await expect(header).toBeVisible();
        const hb = (await header.boundingBox())!;
        expect(hb.height).toBeGreaterThanOrEqual(56);
        // Every control in the bar is inside the screen and at least 40px square.
        for (const name of [/unread notifications/, /^Account/]) {
          const b = (await header.getByRole("button", { name }).boundingBox())!;
          expect(b.x + b.width).toBeLessThanOrEqual(width);
          expect(b.height).toBeGreaterThanOrEqual(40);
        }

        const nav = page.getByRole("navigation", { name: "Primary" });
        await expect(nav).toBeVisible();
        for (const tab of await nav.getByRole("button").all()) {
          expect((await tab.boundingBox())!.height).toBeGreaterThanOrEqual(48);
        }
        // The admin's home is the dashboard: there, and only there, Home is the current
        // tab. The other two screens are not among the admin's tabs, so none is.
        await expect(nav.locator('[aria-current="page"]')).toHaveCount(path === "/dashboard/manager" ? 1 : 0);
        if (path === "/dashboard/manager") {
          await expect(nav.locator('[aria-current="page"]')).toHaveText("Home");
        }

        expect(await clipped(page), `${path} at ${width}px`).toEqual([]);
      });
    }

    test("Performance date boxes keep the year", async ({ page }) => {
      await stubSupabase(page, true);
      await page.goto("/dashboard/production-performance");
      const from = page.getByRole("button", { name: "From" });
      await expect(from).toBeVisible();
      // Not truncated: the visible text span is as wide as its content.
      const cut = await from.evaluate((b) => {
        const s = [...b.querySelectorAll("span")].find((x) => x.getBoundingClientRect().width > 0)!;
        return s.scrollWidth > s.clientWidth + 1;
      });
      expect(cut).toBe(false);
      await expect(from).toHaveText(/\d{2} \w{3} \d{2}/);
    });
  });
}

test.describe("notifications on the narrowest phone", () => {
  test.use({ viewport: { width: 320, height: 700 } });
  test("the panel opens inside the screen", async ({ page }) => {
    await stubSupabase(page, true);
    await page.goto("/dashboard/manager");
    await page.getByRole("button", { name: /unread notifications/ }).click();
    const panel = page.getByRole("dialog");
    await expect(panel).toBeVisible();
    const b = (await panel.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(320);
  });
});
