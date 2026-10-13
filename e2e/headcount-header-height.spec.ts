import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * Quanto do ecrã o board gasta antes do primeiro nome.
 *
 * Num portátil de 1366×768 a Line 1 começava a 619px do topo da página — sete filas
 * (um segundo Back, separadores, relógio, banda, Day/Night, barra do turno, cinco
 * cartões) antes do primeiro nome, e o ecrã acabava aí. Agora começa a ~310px. Isto mede
 * onde a grelha começa e falha se voltar a descer; a margem é para o texto do relógio,
 * que muda de comprimento com o estado do TimeMoto.
 */

const REF = "ybtrzqzliepknpzqdajx";
const SESSION = {
  access_token: "t", refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: 4_102_444_800,
  user: { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "a@f.local", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" },
};
const PROFILE = { id: SESSION.user.id, name: "Office", email: SESSION.user.email, active: true };

const AREAS = [
  ["l1", "Line 1", "production", "production"], ["l2", "Line 2", "production", "production"],
  ["l3", "Line 3", "production", "production"], ["l4", "Line 4", "production", "production"],
  ["l5", "Line 5", "production", "production"], ["l6", "Line 6", "production", "production"],
  ["tb", "Tablet line", "production", "production"], ["rn", "Runner", "support", "production"],
  ["hy", "Hygiene", "support", "sectors"], ["qa", "Quality", "support", "sectors"],
].map(([id, name, kind, section], i) => ({ id, name, kind, section, sort_order: (i + 1) * 10, active: true, sheet_label: null, sheet_group: null }));

const EMP = Array.from({ length: 40 }, (_, i) => ({
  id: `e${i}`, full_name: `Person ${String.fromCharCode(65 + (i % 26))}${i}`, department: null, active: true,
  shift_group: i % 2 ? "Weekend" : "B", start_date: "2024-01-08", end_date: null, role: null,
}));
const ALLOCS = EMP.map((e, i) => ({
  id: `a${i}`, employee_id: e.id, on_date: "2026-10-01", shift: "Day",
  area_id: i < 34 ? AREAS[i % AREAS.length].id : null,
  status: i < 34 ? "assigned" : ["sick", "holiday", "overtime"][i % 3],
  half_day: false, left_early_at: null, arrived_late_at: null, note: null, is_leader: false,
}));

async function open(page: Page, width: number, height: number) {
  await page.addInitScript(([ref, s]) => {
    window.localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(s));
    window.sessionStorage.setItem("pin-ok:workforce", "1");
  }, [REF, SESSION] as const);
  await page.route(/supabase\.co/, async (route: Route) => {
    const url = route.request().url();
    const json = (d: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(d) });
    if (url.includes("/auth/v1/user")) return json(SESSION.user);
    if (url.includes("/auth/v1/token")) return json(SESSION);
    if (url.includes("/rpc/get_user_role")) return json("admin");
    if (url.includes("/rest/v1/headcount_areas")) return json(AREAS);
    if (url.includes("/rest/v1/daily_allocations")) return json(ALLOCS);
    if (url.includes("/rest/v1/employees")) return json(EMP);
    if (url.includes("/rest/v1/profiles")) return json(PROFILE);
    return json([]);
  });
  await page.setViewportSize({ width, height });
  await page.goto("/dashboard/headcount");
  await page.getByRole("tab", { name: "Day" }).click();
  await page.locator(".headcount-columns").first().waitFor({ state: "visible", timeout: 20000 });
  await expect(page.locator(".headcount-columns").getByText("Person A0").first()).toBeVisible({ timeout: 15000 });
}

/** Quanto a área da página rola na horizontal — a grelha encaixa colunas, não rola. */
async function sideways(page: Page) {
  return page.evaluate(() => {
    const els = [document.documentElement, document.querySelector("#main-content") as HTMLElement | null];
    return Math.max(...els.filter(Boolean).map((el) => el!.scrollWidth - el!.clientWidth));
  });
}

/** Do topo da área da página (abaixo da barra do shell) até à primeira coluna. */
async function headerHeight(page: Page) {
  return page.evaluate(() => {
    const main = document.querySelector("#main-content") as HTMLElement | null;
    const grid = document.querySelector(".headcount-on-screen .headcount-columns") as HTMLElement;
    const top = main ? main.getBoundingClientRect().top : 0;
    return Math.round(grid.getBoundingClientRect().top - top);
  });
}

for (const [w, h, budget] of [[1366, 768, 340], [1920, 1080, 320]] as const) {
  test(`at ${w}×${h} the grid starts within ${budget}px of the page top`, async ({ page }) => {
    await open(page, w, h);
    const px = await headerHeight(page);
    console.log(`header ${w}x${h}: ${px}px`);
    await page.screenshot({ path: `e2e/.results/headcount-header-${w}.png` });
    expect(px).toBeLessThanOrEqual(budget);
    expect(await sideways(page)).toBeLessThanOrEqual(0);
  });
}

// O tablet de linha (Galaxy Tab A9 em paisagem) e um telemóvel: a banda e a barra do
// turno dobram em várias linhas, mas nada pode empurrar a página para o lado.
for (const [w, h] of [[1005, 600], [390, 844]] as const) {
  test(`at ${w}×${h} nothing pushes the page sideways`, async ({ page }) => {
    await open(page, w, h);
    await page.screenshot({ path: `e2e/.results/headcount-header-${w}.png` });
    expect(await sideways(page)).toBeLessThanOrEqual(0);
    await expect(page.getByRole("button", { name: /next day/i })).toBeVisible();
  });
}

test("Both sets the two boards side by side without spilling", async ({ page }) => {
  await open(page, 1920, 1080);
  await page.getByRole("tab", { name: "Both" }).click();
  await expect(page.locator(".headcount-on-screen")).toHaveCount(2);
  await expect(page.getByRole("tab", { name: "Both" })).toHaveAttribute("data-state", "active");
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300); // a transição do separador
  await page.screenshot({ path: "e2e/.results/headcount-header-both.png" });
  expect(await sideways(page)).toBeLessThanOrEqual(0);
});

test("every header action is still reachable at 1366", async ({ page }) => {
  await open(page, 1366, 768);
  for (const name of [/previous day/i, /next day/i, /export/i, /sync from sharepoint/i, /import/i, /print/i, /copy from the last day/i, /save as matrix/i]) {
    await expect(page.getByRole("button", { name }).first()).toBeVisible();
  }
  for (const name of ["Day", "Night", "Both"]) await expect(page.getByRole("tab", { name })).toBeVisible();
  await expect(page.getByRole("textbox", { name: /find a person/i })).toBeVisible();
  // As cinco contagens continuam lá, cada uma com o seu nome.
  for (const label of [/total staff/i, /on lines/i, /support/i, /away/i, /overtime/i]) {
    await expect(page.locator(".headcount-kpis").getByText(label).first()).toBeVisible();
  }
});
