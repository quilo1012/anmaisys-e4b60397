import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * O ciclo dos três estados do menu — cheio, ícones, escondido — medido num
 * Chromium a sério, que é a única coisa capaz de responder à pergunta que aqui
 * interessa: quando o menu está escondido, o botão que o traz de volta está
 * mesmo por baixo do dedo, ou está tapado por outro?
 *
 * O jsdom não faz layout, portanto dá o teste por passado com dois botões
 * sobrepostos no mesmo canto. Era exactamente esse o defeito.
 *
 * Nada aqui vai à rede: todos os pedidos ao Supabase são respondidos pelo fixture.
 */

const PROJECT_REF = "ybtrzqzliepknpzqdajx";

const FAKE_SESSION = {
  access_token: "fixture-access-token",
  refresh_token: "fixture-refresh-token",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: 4_102_444_800,
  user: {
    id: "00000000-0000-4000-8000-000000000001",
    aud: "authenticated",
    role: "authenticated",
    email: "admin@fixture.local",
    app_metadata: {},
    user_metadata: {},
    created_at: "2026-01-01T00:00:00Z",
  },
};

const PROFILE = { id: FAKE_SESSION.user.id, name: "Admin Fixture", email: FAKE_SESSION.user.email, active: true };

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
    if (url.includes("/rpc/get_user_role")) return json("admin");
    if (url.includes("/rest/v1/profiles")) return json(PROFILE);
    return json([]);
  });
}

/** Onde está o painel do menu e o que diz o botão do cabeçalho. */
async function readMenu(page: Page) {
  return page.evaluate(() => {
    const wrapper = document.querySelector("[data-state][data-collapsible][data-side]") as HTMLElement | null;
    const panel = document.querySelector('[data-sidebar="sidebar"]') as HTMLElement | null;
    const header = document.querySelector('header button[aria-label*="menu" i]') as HTMLElement | null;
    const r = panel?.getBoundingClientRect();
    const h = header?.getBoundingClientRect();
    // Quem está mesmo por cima do centro do botão do cabeçalho?
    const onTop = h ? (document.elementFromPoint(h.left + h.width / 2, h.top + h.height / 2) as HTMLElement | null) : null;
    return {
      collapsible: wrapper?.dataset.collapsible ?? null,
      panelLeft: r ? Math.round(r.left) : null,
      panelWidth: r ? Math.round(r.width) : null,
      headerLabel: header?.getAttribute("aria-label") ?? null,
      headerIsClickable: !!(header && onTop && (header === onTop || header.contains(onTop))),
      whatIsOnTop: onTop ? `${onTop.tagName}[${onTop.getAttribute("aria-label") ?? onTop.className.slice(0, 60)}]` : null,
    };
  });
}

const clickHeader = async (page: Page) => {
  await page.locator('header button[aria-label*="menu" i]').first().click();
  await page.waitForTimeout(350);
};

async function openDashboard(page: Page, width: number, height: number) {
  await stubSupabase(page);
  await page.setViewportSize({ width, height });
  await page.goto("/dashboard/manager");
  await page.waitForSelector("header button[aria-label*='menu' i]", { timeout: 20_000 });
}

test.describe("o menu volta de escondido", () => {
  test("no monitor: nada tapa o botão do cabeçalho com o menu escondido", async ({ page }) => {
    await openDashboard(page, 1440, 900);

    await clickHeader(page); // cheio -> ícones
    await clickHeader(page); // ícones -> escondido

    const hidden = await readMenu(page);
    expect(hidden.collapsible, "o menu devia estar escondido").toBe("offcanvas");
    expect(
      hidden.headerIsClickable,
      `o botão "${hidden.headerLabel}" está tapado por ${hidden.whatIsOnTop} — é o único que traz o menu inteiro de volta`,
    ).toBe(true);
  });

  test("no monitor: o ciclo fecha — escondido volta ao menu inteiro", async ({ page }) => {
    await openDashboard(page, 1440, 900);

    await clickHeader(page); // cheio -> ícones
    await clickHeader(page); // ícones -> escondido
    await clickHeader(page); // escondido -> cheio

    const back = await readMenu(page);
    expect(back.collapsible, "três carregadelas deviam devolver o menu inteiro").toBe("");
    expect(back.panelLeft).toBe(0);
    expect(back.panelWidth ?? 0).toBeGreaterThan(120);
  });

  test("no tablet: o ciclo fecha na mesma", async ({ page }) => {
    await openDashboard(page, 900, 700);

    // Num tablet o menu já arranca em ícones.
    await clickHeader(page); // ícones -> escondido
    expect((await readMenu(page)).collapsible).toBe("offcanvas");
    await clickHeader(page); // escondido -> cheio

    const back = await readMenu(page);
    expect(back.collapsible).toBe("");
    expect(back.panelLeft).toBe(0);
  });
});
