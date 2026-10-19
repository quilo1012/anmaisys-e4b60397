import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * No word split in the middle, on a phone.
 *
 * "PRODUCE D", "ATTAINME NT", "130 / 7", "40. / 571": on 19/10 the Production Control
 * header and the SKU count read like that on a phone. Nothing overflowed and nothing
 * threw — index.css had `overflow-wrap: anywhere` on every span and div inside <main>
 * below 768px, which lets a word break at ANY character and, worse, tells the layout
 * that the word is only one character wide, so grids and flex rows squeezed labels
 * until they broke. jsdom cannot see this; only line boxes can.
 *
 * Same empty-data fixture as every-screen-empty. Nothing reaches the network.
 */

const PROJECT_REF = "ybtrzqzliepknpzqdajx";
const SESSION = {
  access_token: "fixture", refresh_token: "fixture", token_type: "bearer", expires_in: 3600, expires_at: 4_102_444_800,
  user: { id: "00000000-0000-4000-8000-0000000000ad", aud: "authenticated", role: "authenticated", email: "fixture-admin@fixture.local", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" },
};

async function stub(page: Page) {
  await page.addInitScript(([ref, s]) => localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(s)), [PROJECT_REF, SESSION] as const);
  await page.route(/supabase\.co/, async (route: Route) => {
    const url = route.request().url();
    const json = (d: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(d) });
    if (url.includes("/auth/v1/user")) return json(SESSION.user);
    if (url.includes("/auth/v1/token")) return json(SESSION);
    if (url.includes("/rpc/get_user_role")) return json("admin");
    if (url.includes("/rpc/has_role") || url.includes("/rpc/is_owner")) return json(true);
    if (url.includes("/rpc/") && /single|maybe/.test(url)) return json(null);
    if (url.includes("/profiles")) return json([{ id: SESSION.user.id, name: "Fixture Admin", email: SESSION.user.email, active: true }]);
    return json([]);
  });
}

async function brokenWords(page: Page) {
  return page.evaluate(() => {
    const out: string[] = [];
    document.querySelectorAll<HTMLElement>("main p, main span, main div, main li, main h1, main h2, main h3, main label").forEach((el) => {
      const text = (el.textContent ?? "").trim();
      if (!text || /\s/.test(text) || el.childElementCount > 0) return;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      const range = document.createRange();
      range.selectNodeContents(el);
      const lines = new Set(Array.from(range.getClientRects()).map((x) => Math.round(x.top)));
      if (lines.size > 1) out.push(text);
    });
    return [...new Set(out)].slice(0, 10);
  });
}

const ROUTES = [
  "/dashboard/manager",
  "/dashboard/departments/production",
  "/dashboard/production-performance",
  "/dashboard/shift-history",
  "/dashboard/sku-products",
  "/dashboard/headcount",
  "/dashboard/work-orders",
  "/dashboard/downtime",
  "/dashboard/quality",
  "/dashboard/rag-weekly",
];

for (const width of [320, 390]) {
  test.describe(`${width}px`, () => {
    test.use({ viewport: { width, height: 844 } });
    for (const route of ROUTES) {
      test(`${route}: no word is split`, async ({ page }) => {
        await stub(page);
        await page.goto(route);
        await page.waitForSelector("main", { timeout: 15_000 });
        await page.waitForTimeout(1500);
        expect(await brokenWords(page), `${route} at ${width}px`).toEqual([]);
      });
    }
  });
}
