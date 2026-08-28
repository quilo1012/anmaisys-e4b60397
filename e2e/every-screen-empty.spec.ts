import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * Every screen, empty, on a phone.
 *
 * The audit could not open a single screen — no credentials, and every route needs a
 * session — so the whole layout half of it was read rather than seen. This is the part
 * that can be seen without credentials: the fixture supplies the session, answers every
 * Supabase call with nothing, and asks each screen the two questions jsdom cannot.
 *
 *   1. Does it fit the width of a phone? A page that scrolls sideways on a 390px screen
 *      is the defect the audit looked for statically, found six candidates for, and
 *      cleared all six by reading the parent element. Reading is not measuring.
 *
 *   2. Does an empty screen say it is empty? "VAZIO vs PARTIDO" was the second rule of
 *      the audit's method. A screen with no rows must not be a blank rectangle, and must
 *      not be a stack trace.
 *
 * EMPTY IS THE STATE WORTH SWEEPING. Every table returns [], every RPC returns null, and
 * that is one of the three states asked for — the one that needs no per-screen fixture,
 * so it can cover twenty-odd routes instead of two. The other two states are worth the
 * per-screen work the existing specs do, and this does not replace them.
 *
 * Nothing here reaches the network.
 */

const PROJECT_REF = "ybtrzqzliepknpzqdajx";

const FAKE_SESSION = {
  access_token: "fixture-access-token",
  refresh_token: "fixture-refresh-token",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: 4_102_444_800, // 2100-01-01, so supabase-js never refreshes over the wire
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

/** Admin, so a refusal screen never stands in for the screen being measured. */
const ROLE = "admin";

async function stubSupabase(page: Page) {
  await page.addInitScript(
    ([ref, session]) => {
      window.localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(session));
    },
    [PROJECT_REF, FAKE_SESSION] as const,
  );

  await page.route(/supabase\.co/, async (route: Route) => {
    const url = route.request().url();
    const json = (data: unknown) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });

    if (url.includes("/auth/v1/user")) return json(FAKE_SESSION.user);
    if (url.includes("/auth/v1/token")) return json(FAKE_SESSION);
    if (url.includes("/rpc/get_user_role")) return json(ROLE);
    if (url.includes("/rpc/has_role") || url.includes("/rpc/is_owner")) return json(true);
    // A single object is expected by these; an array would throw in the client.
    if (url.includes("/rpc/") && /single|maybe/.test(url)) return json(null);
    if (url.includes("/profiles")) {
      return json([{ id: FAKE_SESSION.user.id, name: "Fixture Admin", email: FAKE_SESSION.user.email, active: true }]);
    }
    // Everything else: present, and empty. That is the state under test.
    return json([]);
  });

  // Console errors are collected per test and asserted on, so a screen that throws
  // while rendering its empty state cannot pass by drawing nothing.
  const erros: string[] = [];
  page.on("pageerror", (e) => erros.push(String(e)));
  return erros;
}

/**
 * Content that is cut off, which is NOT the same as a page that scrolls sideways.
 *
 * index.css ends with `html, body, #root { max-width: 100vw; overflow-x: hidden }` — a
 * deliberate safety net so a wide table cannot drag the whole page. It has a
 * consequence nobody had noticed: `document.scrollWidth` can never exceed
 * `window.innerWidth`, so a check comparing the two is green on every page, always,
 * whatever it contains. Proved by injecting a 900px div into a 390px viewport and
 * watching scrollWidth stay at 390.
 *
 * That is the shape of `assertNoSidewaysScroll` in the two older specs. It has been
 * inert since it was written.
 *
 * What the safety net actually does is CLIP. Anything past the viewport is not
 * scrollable-to, it is gone — no scrollbar, no cut edge, no clue. So the thing worth
 * measuring is elements whose right edge is past the viewport and that are not inside
 * something scrollable, because those are unreachable rather than merely off to one
 * side. On /dashboard/line-production that was seventeen of them on a phone, Sign out
 * among them.
 */
async function assertNothingIsClipped(page: Page, where: string) {
  const cortados = await page.evaluate(() => {
    const vw = window.innerWidth;
    const maus: { tag: string; cls: string; right: number; txt: string }[] = [];
    document.querySelectorAll<HTMLElement>("body *").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;      // not rendered
      if (r.right <= vw + 1) return;                    // inside the viewport
      // Inside a container that scrolls? Then it is reachable, and by design — this is
      // how every wide table in this app is meant to behave.
      let p: HTMLElement | null = el.parentElement;
      while (p && p !== document.body) {
        const ov = getComputedStyle(p).overflowX;
        if (ov === "auto" || ov === "scroll") return;
        p = p.parentElement;
      }
      maus.push({
        tag: el.tagName,
        cls: String(el.className).slice(0, 60),
        right: Math.round(r.right),
        txt: (el.textContent ?? "").trim().slice(0, 40),
      });
    });
    return maus.sort((a, b) => b.right - a.right).slice(0, 5);
  });

  expect(
    cortados,
    `${where}: content is clipped and unreachable at ${await page.evaluate(() => window.innerWidth)}px —\n` +
      cortados.map((m) => `  ${m.right}px  ${m.tag}.${m.cls}  "${m.txt}"`).join("\n"),
  ).toEqual([]);
}

/**
 * The routes an admin can open, from App.tsx. Redirects and the operator-only screens
 * are left out: a redirect measures the page it lands on, and an operator screen would
 * measure a refusal.
 */
const ECRAS = [
  "/dashboard/manager", "/dashboard/engineer", "/dashboard/warehouse", "/dashboard/analytics",
  "/dashboard/work-orders", "/dashboard/machines", "/dashboard/problems", "/dashboard/control-center",
  "/dashboard/people", "/dashboard/headcount", "/dashboard/leave", "/dashboard/attendance",
  "/dashboard/finance-close", "/dashboard/reports", "/dashboard/system", "/dashboard/audit-logs",
  "/dashboard/downtime", "/dashboard/preventive", "/dashboard/reliability", "/dashboard/stock",
  "/dashboard/users", "/dashboard/permissions", "/dashboard/settings", "/dashboard/suppliers",
  "/dashboard/sku-products", "/dashboard/production-performance", "/dashboard/quality",
  "/dashboard/shift-history", "/dashboard/rag-weekly", "/dashboard/line-production",
  "/dashboard/pm-intelligence", "/dashboard/messages",
];

/** The two sizes this factory actually holds. The wall display is its own screen. */
const TAMANHOS = [
  { nome: "telemovel", width: 390, height: 844 },
  { nome: "tablet de linha", width: 820, height: 1180 },
];

test.describe("every screen, empty, on a phone", () => {
  for (const tamanho of TAMANHOS)
  for (const rota of ECRAS) {
    test(`${rota} fits and does not throw — ${tamanho.nome}`, async ({ page }) => {
      await page.setViewportSize({ width: tamanho.width, height: tamanho.height });
      const erros = await stubSupabase(page);

      await page.goto(rota);
      // The shell, not the data: every screen renders inside one, and waiting for
      // networkidle would wait for requests that are being fulfilled locally.
      await page.waitForSelector("main, [role=main], body > div", { timeout: 15_000 });
      await page.waitForTimeout(600);

      // A screen that throws while rendering nothing is the "PARTIDO" the audit's
      // method separates from "VAZIO", and it is invisible from the outside.
      expect(erros, `${rota} threw while rendering its empty state:\n${erros.join("\n")}`).toEqual([]);

      await assertNothingIsClipped(page, rota);

      // And it must have drawn something. A blank page fits any width.
      const texto = (await page.locator("body").innerText()).trim();
      expect(texto.length, `${rota} rendered no text at all`).toBeGreaterThan(20);
    });
  }
});
