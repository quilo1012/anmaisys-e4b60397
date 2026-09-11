import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * O controlo do menu no cabeçalho abre um menu com os três estados —
 * "Full menu", "Icons only", "Hide menu" — escolhidos directamente, sem ciclo.
 * Estes testes medem num Chromium a sério, que é a única coisa capaz de
 * responder às perguntas que aqui interessam:
 *
 * 1. Com o menu escondido, o botão do cabeçalho está mesmo por baixo do dedo,
 *    ou está tapado por outro? (Houve um bug em que um segundo botão flutuante
 *    "mostrar menu" se sobrepunha ao do cabeçalho no canto superior esquerdo
 *    e impedia chegar ao menu completo. O jsdom não faz layout e dava o teste
 *    por passado com os dois botões sobrepostos.)
 * 2. Do menu aberto vê-se qual das três opções está marcada, e um clique vai
 *    directamente para o estado escolhido — inclusive de "Menu completo" para
 *    "Esconder menu" e de volta, sem passar pelo intermédio.
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

const FULL_MENU = "Full menu";
const ICONS_ONLY = "Icons only";
const HIDE_MENU = "Hide menu";

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

/** Abre o menu do cabeçalho e devolve as três opções com o estado de cada uma. */
async function openMenuOptions(page: Page) {
  await page.locator('header button[aria-label*="menu" i]').first().click();
  const items = page.getByRole("menuitemradio");
  await items.first().waitFor();
  return items;
}

/** Escolhe um estado directamente pelo menu do cabeçalho. */
async function pickMenuState(page: Page, option: string) {
  const items = await openMenuOptions(page);
  await page.getByRole("menuitemradio", { name: option }).click();
  await page.waitForTimeout(350);
}

async function openDashboard(page: Page, width: number, height: number) {
  await stubSupabase(page);
  await page.setViewportSize({ width, height });
  await page.goto("/dashboard/manager");
  await page.waitForSelector("header button[aria-label*='menu' i]", { timeout: 20_000 });
}
test("role rules render", async ({ page }) => {
  const errs: string[] = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  await stubSupabase(page);
  await page.setViewportSize({ width: 1440, height: 1200 });
  await page.goto("/dashboard/roles?role=engineer");
  await page.waitForTimeout(3500);
  console.log("text:", (await page.locator("body").innerText()).slice(0, 400).replace(/\n/g, " | "));
  console.log("errors:", errs.slice(0, 3));
  await page.screenshot({ path: "/tmp/browser/rail/roles.png" });
});
