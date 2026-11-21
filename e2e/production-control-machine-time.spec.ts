import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * O relógio da MÁQUINA na Production Control — o painel "Machine time", que põe a
 * pesquisa como o "OEE Machine by Period" do iTouching: total, paragens planeadas,
 * disponível, a correr, paragens não planeadas, disponibilidade.
 *
 * A conta está em `src/lib/machineTime.test.ts`. Aqui mede-se a cadeia: que a página
 * pede o log do iTouching para o período escolhido, pede o catálogo dos códigos, e
 * escreve a linha e o total na tabela.
 *
 * Nada disto chega à rede: o Supabase é todo respondido pelo fixture abaixo.
 */

const PROJECT_REF = "apblxaaktftinstoidvp";
const FAKE_SESSION = {
  access_token: "fixture-access-token", refresh_token: "fixture-refresh-token",
  token_type: "bearer", expires_in: 3600, expires_at: 4_102_444_800,
  user: { id: "00000000-0000-4000-8000-0000000000ad", aud: "authenticated", role: "authenticated",
    email: "fixture-admin@fixture.local", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" },
};

// Novembro é GMT: o relógio de Londres é UTC.
const DAY = "2026-11-16";
const SESSIONS = [
  { id: "s1", session_date: DAY, shift: "DAY", line: "Line 6", leader_id: null, leader_name: "Pedro",
    staff_planned: 8, staff_actual: 8, tickets: null, tickets_unit: null, locked: false, notes: null,
    production_items: [{
      id: "i1", sku_id: "sku1", sku_code_text: null, target_qty: 0, planned_qty: 0, actual_qty: 4200,
      notes: null, blender_ref: null, batch_code: "1", manufacture_month: null, expiry_month: null,
      started_at: `${DAY}T07:00:00Z`, finished_at: `${DAY}T17:00:00Z`, display_order: 0,
      created_at: `${DAY}T05:00:00Z`, tickets_unit: "tubs", production_blender_entries: [],
    }] },
];
const SKUS = [{ id: "sku1", code: "MMWPC", name: "MUSCLE MOOSE WHEY PROTEIN 900G - CHOCOLATE", weight: 900 }];

// O turno de dia da Line 6, 06:00–18:00: 1h30 planeada, 9h15 a correr, 1h15 parada sem plano.
const LOG = [
  { line: "Line 6", status: 1, stop_label: "No Planned Shift", changed_at: "2026-11-15T22:00:00Z" },
  { line: "Line 6", status: 7, stop_label: "Line Preparation", changed_at: `${DAY}T06:30:00Z` },
  { line: "Line 6", status: 4, stop_label: null, changed_at: `${DAY}T07:00:00Z` },
  { line: "Line 6", status: 7, stop_label: "Breaks", changed_at: `${DAY}T10:00:00Z` },
  { line: "Line 6", status: 6, stop_label: null, changed_at: `${DAY}T10:30:00Z` },
  { line: "Line 6", status: 7, stop_label: "Printer Fault", changed_at: `${DAY}T13:00:00Z` },
  { line: "Line 6", status: 5, stop_label: null, changed_at: `${DAY}T14:00:00Z` },
  { line: "Line 6", status: 8, stop_label: null, changed_at: `${DAY}T14:15:00Z` },
];
const CODES = [
  { name: "No Planned Shift", planned: true },
  { name: "Line Preparation", planned: true },
  { name: "Breaks", planned: true },
  { name: "Printer Fault", planned: false },
];

async function stub(page: Page, seen: string[]) {
  await page.addInitScript(([ref, session, day]) => {
    window.localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(session));
    // O período abre no dia do fixture, e só no turno de dia, sem esperar pelo calendário.
    // Ao meio-dia, para o dia ser o mesmo em qualquer fuso em que o browser corra.
    window.localStorage.setItem("dr:ops", JSON.stringify({ preset: "custom", from: `${day}T12:00:00.000Z`, to: `${day}T12:00:00.000Z` }));
  }, [PROJECT_REF, FAKE_SESSION, DAY] as const);

  await page.route(/supabase\.co/, async (route: Route) => {
    const url = route.request().url();
    const json = (data: unknown) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
    if (url.includes("/auth/v1/user")) return json(FAKE_SESSION.user);
    if (url.includes("/auth/v1/token")) return json(FAKE_SESSION);
    if (url.includes("/rpc/get_user_role")) return json("admin");
    // The chat lists (the bell's groups) are lists: a `true` there crashes the layout.
    if (url.includes("/rpc/chat_")) return json([]);
    if (url.includes("/rpc/")) return json(true);
    if (url.includes("/profiles")) return json([{ id: FAKE_SESSION.user.id, name: "Daniel Quiló", email: FAKE_SESSION.user.email, active: true }]);
    if (url.includes("intouch_status_log")) { seen.push(decodeURIComponent(url)); return json(LOG); }
    if (url.includes("intouch_stop_code_catalog")) return json(CODES);
    if (url.includes("production_sessions")) return json(SESSIONS);
    if (url.includes("sku_products")) return json(SKUS);
    if (url.includes("production_lines")) return json([{ id: "6", name: "Line 6", active: true }]);
    return json([]);
  });
}

test("escreve o relógio da máquina para a pesquisa, como o iTouching", async ({ page }) => {
  const seen: string[] = [];
  await stub(page, seen);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.clock.setFixedTime(new Date("2026-11-21T07:50:00Z"));
  await page.goto("/dashboard/shift-history");

  const panel = page.getByRole("region", { name: "Machine time" });
  await expect(panel).toBeVisible({ timeout: 60_000 });
  await page.getByRole("combobox", { name: "Shift" }).click();
  await page.getByRole("option", { name: "Day" }).click();

  const row = panel.locator("tbody tr").filter({ hasText: "Line 6" });
  await expect(row).toBeVisible({ timeout: 30_000 });
  // Total 12:00 · Planned 1:30 · Available 10:30 · Run 9:15 · Unplanned 1:15 · 88.1%
  await expect(row).toContainText("12:00");
  await expect(row).toContainText("1:30");
  await expect(row).toContainText("10:30");
  await expect(row).toContainText("9:15");
  await expect(row).toContainText("1:15");
  await expect(row).toContainText("88.1%");
  await expect(row).toContainText("4,200");
  await expect(panel).toContainText("Printer Fault 1:00");

  // Pediu o log desde quatro dias antes do turno (o estado em que a linha entrou nele)
  // até ao fim do turno.
  expect(seen.some((u) => u.includes("changed_at=gte.2026-11-12T06:00:00.000Z") && u.includes("changed_at=lt.2026-11-16T18:00:00.000Z"))).toBe(true);

  if (process.env.PW_SCREENSHOT) await panel.screenshot({ path: process.env.PW_SCREENSHOT });
});
