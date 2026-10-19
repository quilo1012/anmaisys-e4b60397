import { test, expect, type Page, type Route } from "@playwright/test";

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
  ["wh", "WH team", "support", "sectors"], ["mt", "Maintenance", "support", "sectors"],
  ["lab", "Lab", "support", "support"], ["of", "Office", "support", "support"],
].map(([id, name, kind, section], i) => ({ id, name, kind, section, sort_order: (i + 1) * 10, active: true, sheet_label: null, sheet_group: null }));

const NAMES = ["Pedro Assis","Welligton Segat","Felipe Pinelli","Carlos Russo","Juan Bartholo","Guilherme Dias","Diego Alves","Macelio Souza","Nilton Filho","Eduardo Belini","Marcio Carvalho","David Goncalves","Everton Luz","Adriano Melo","Lucas Glor","Rodolfo Pires","Alice Kovac","Simone Reis","Kevin Mota","Stetson Luz","Natalia Braz","Karen Dias","Wilma Rosa","Ramao Neves","Henrique Sa","Fabio Crespo","Alysson Reis","Aleks Petrov","Karina Braz","Ivan Costa"];
// Metade no crew Fri–Mon, que leva o crachá FRI–MON — o que roubava o espaço do nome.
const EMP = NAMES.map((full_name, i) => ({ id: `e${i}`, full_name: i === 3 ? "Sandro Vasconcelos" : full_name, department: null, active: true, shift_group: i % 2 ? "Weekend" : "B", start_date: "2024-01-08", end_date: null, role: null }));

// Quinze que o rota põe no turno e ninguém colocou — um domingo real tinha 15.
const UNPLACED = ["Elielton Barbosa","Ezaquiel Silva","Jaime Brandao","Jessika Lopes","Ketlyn Amorin","Laila Nunes","Leonor Lima","Leticia Peres","Luis Fernandes","Magno Vitoria","Nilson Santos","Reynaldo Costa","Tiago Rocha","Vanessa Prado","Yuri Matos"];
// Crews que não dizem os seus dias: sem padrão, estão devidos todos os dias. Um crew
// Fri–Mon sem padrão já não está devido de terça a quinta, e o teste da bandeja passava
// ou falhava conforme o dia da semana em que corria.
UNPLACED.forEach((full_name, k) => EMP.push({ id: `u${k}`, full_name, department: k % 3 ? null : "Warehouse", active: true, shift_group: k % 2 ? "B" : "Warehouse Day", start_date: "2024-01-08", end_date: null, role: null }));
const AREA_IDS = AREAS.map((a) => a.id);
const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();
const ALLOCS = EMP.filter((e) => !e.id.startsWith("u")).map((e, i) => ({
  id: `a${i}`, employee_id: e.id, on_date: "2026-10-01", shift: "Day",
  area_id: i < 26 ? AREA_IDS[i % AREA_IDS.length] : null,
  status: i < 26 ? "assigned" : ["sick", "holiday", "overtime", "unpaid"][i % 4],
  // Pedro Assis (e0) works a half day, 06:00–12:00, and has said yes to 12:00–14:00.
  half_day: i === 0, left_early_at: null, arrived_late_at: null, note: null, is_leader: i % 7 === 0,
  overtime_request_id: null,
}));
// Welligton Segat (e1, Fri–Mon crew) is on the board only through his confirmed ask:
// the bridge's row, in the Overtime column — the card that ran out of room.
Object.assign(ALLOCS[1], { area_id: null, status: "overtime", overtime_request_id: "q3" });
// Felipe Pinelli (e2) is on a full day and has a confirmed ask on the NIGHT board:
// it must not stretch his day card.
const CONFIRMED = [
  { request_id: "q1", employee_id: "e0", overtime_requests: { on_date: today, starts_at: "12:00:00", ends_at: "14:00:00", status: "open" }, overtime_outcomes: [] },
  { request_id: "q3", employee_id: "e1", overtime_requests: { on_date: today, starts_at: "06:00:00", ends_at: "14:00:00", status: "open" }, overtime_outcomes: [] },
  { request_id: "q2", employee_id: "e2", overtime_requests: { on_date: today, starts_at: "18:00:00", ends_at: "20:00:00", status: "open" }, overtime_outcomes: [] },
];

async function stub(page: Page) {
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
    if (url.includes("/rest/v1/overtime_responses")) return json(CONFIRMED);
    if (url.includes("/rest/v1/daily_allocations")) return json(ALLOCS);
    if (url.includes("/rest/v1/employees")) return json(EMP);
    if (url.includes("/rest/v1/profiles")) return json(PROFILE);
    return json([]);
  });
}

async function openBoard(page: Page, width = 1600) {
  await stub(page);
  await page.setViewportSize({ width, height: 1400 });
  await page.goto("/dashboard/headcount");
  await page.getByRole("tab", { name: "Day" }).click();
  await page.locator(".headcount-columns").first().waitFor({ state: "visible", timeout: 20000 });
  await expect(page.locator(".headcount-columns").getByText("Pedro Assis").first()).toBeVisible({ timeout: 15000 });
}

/**
 * Confirmed overtime on the Headcount board, in a real browser.
 *
 * A half day (06:00–12:00) with a yes to 12:00–14:00 used to read as the half day: the
 * bridge's insert met the planned row and did nothing. The card now says the hours the
 * person is really on for. Every request to Supabase is answered here.
 */
test("a half day stretched by confirmed overtime reads 06:00–14:00 on the card", async ({ page }) => {
  await openBoard(page);
  const pedro = page.locator(".headcount-columns .headcount-chip", { hasText: "Pedro Assis" }).first();
  await expect(pedro.getByTestId("board-work-hours")).toHaveText("06–14", { timeout: 15000 });
  await expect(pedro.getByTestId("board-work-hours")).toHaveAttribute("title", /Shift 06:00–12:00 · confirmed overtime 12:00–14:00 · 8h on/);
  await pedro.screenshot({ path: "test-results/board-confirmed-overtime-chip.png" });
});

// 1005px is the line tablet (Galaxy Tab A9), where the columns are narrowest.
for (const width of [1600, 1005]) test(`a card in the Overtime column keeps its name, hours and crew inside the cell (${width}px)`, async ({ page }) => {
  await openBoard(page, width);
  const card = page.locator(".headcount-chip", { hasText: "Welligton Segat" }).first();
  await expect(card.getByTestId("board-work-hours")).toHaveText("06–14", { timeout: 15000 });
  await expect(card.getByTitle(/crew$/)).toBeVisible();
  // Every part of the card is inside the card's own box: nothing cut at the top or bottom.
  const inside = await card.evaluate((el) => {
    const box = el.getBoundingClientRect();
    return [...el.querySelectorAll<HTMLElement>("span")].every((s) => {
      const r = s.getBoundingClientRect();
      return r.height === 0 || (r.top >= box.top - 0.5 && r.bottom <= box.bottom + 0.5
        && r.left >= box.left - 0.5 && r.right <= box.right + 0.5);
    });
  });
  expect(inside, "a mark spills out of the cell, or is cut at its edge").toBe(true);
  await card.screenshot({ path: `test-results/board-overtime-column-card-${width}.png` });
});

test("an ask for the night does not stretch the day card", async ({ page }) => {
  await openBoard(page);
  const felipe = page.locator(".headcount-columns .headcount-chip", { hasText: "Felipe Pinelli" }).first();
  await expect(felipe).toBeVisible();
  await expect(felipe.getByTestId("board-work-hours")).toHaveCount(0);
});
