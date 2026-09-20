import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * O relógio do turno na Production Control — `/dashboard/shift-history`.
 *
 * O que aqui se mede não é a conta: essa está em `src/lib/productionTime.test.ts`, onde
 * se lê sem browser nenhum. O que se mede é a CADEIA — que a folha pede os itens, os
 * põe pela ordem do relógio, escreve a duração de cada corrida e o intervalo entre
 * duas, e que a banda da baía soma as duas coisas. É uma cadeia com quatro elos em
 * quatro sítios do ficheiro, e cada um deles já saiu de sincronia com os outros uma vez.
 *
 * A sessão da Tablet Line é a de 17/09 tal como a base a devolveu: as três corridas
 * baralhadas, com a das 14:45 primeiro. Se a ordem se perder outra vez, é aqui que se vê.
 *
 * Nada disto chega à rede: o Supabase é todo respondido pelo fixture abaixo.
 */

const PROJECT_REF = "ybtrzqzliepknpzqdajx";
const FAKE_SESSION = {
  access_token: "fixture-access-token", refresh_token: "fixture-refresh-token",
  token_type: "bearer", expires_in: 3600, expires_at: 4_102_444_800,
  user: { id: "00000000-0000-4000-8000-0000000000ad", aud: "authenticated", role: "authenticated",
    email: "fixture-admin@fixture.local", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" },
};

// O relógio da fábrica, escrito por extenso: setembro é horário de verão britânico,
// e a folha lê sempre Londres. Construir isto com `new Date(local)` punha o fixture a
// depender do fuso da máquina que corre o teste — verde aqui, uma hora ao lado no CI.
const iso = (d: string, hm: string) => `${d}T${hm}:00+01:00`;
const item = (id: string, sku: string, batch: string, qty: number, start: string | null, finish: string | null, d = "2026-09-17") => ({
  id, sku_id: sku, sku_code_text: null, target_qty: 0, planned_qty: 0, actual_qty: qty,
  notes: null, blender_ref: null, batch_code: batch, manufacture_month: null, expiry_month: null,
  started_at: start ? iso(d, start) : null, finished_at: finish ? iso(d, finish) : null,
  display_order: 0, created_at: `${d}T05:00:00Z`, tickets_unit: "bags",
  production_blender_entries: [{ blender_number: 1, quantity: qty }],
});

const SESSIONS = [
  { id: "s1", session_date: "2026-09-17", shift: "DAY", line: "Tablet Line", leader_id: null, leader_name: "Gill",
    staff_planned: 8, staff_actual: 8, tickets: null, tickets_unit: null, locked: false, notes: null,
    production_items: [
      item("t3", "sku3", "C26256", 1596, "14:45", "16:45"),
      item("t1", "sku1", "A26238", 400, "06:20", "07:07"),
      item("t2", "sku2", "F26257", 5658, "07:50", "14:25"),
    ] },
  { id: "s2", session_date: "2026-09-17", shift: "DAY", line: "Line 1", leader_id: null, leader_name: "Murilo",
    staff_planned: 9, staff_actual: 9, tickets: null, tickets_unit: null, locked: false, notes: null,
    production_items: [
      item("l1", "sku4", "L26260", 756, "06:10", "09:00"),
      item("l2", "sku5", "P26259", 727, "08:35", "11:32"),
      item("l3", "sku6", "P26259", 619, "12:00", null),
    ] },
  { id: "s3", session_date: "2026-09-17", shift: "NIGHT", line: "Line 1", leader_id: null, leader_name: "Kaz",
    staff_planned: 7, staff_actual: 6, tickets: null, tickets_unit: null, locked: false, notes: null,
    production_items: [
      item("n1", "sku4", "L26260", 2348, "22:10", "23:40"),
      item("n2", "sku5", "L26261", 900, "01:20", "03:35", "2026-09-18"),
    ] },
];

const SKUS = [
  { id: "sku1", code: "USSHREDCAPS", name: "US SHRED X EXTREME THERMOGENIC CAPS", weight: null },
  { id: "sku2", code: "CALCIUMK2", name: "CALCIUM & VITAMIN K2 - 60 CAPSULES", weight: null },
  { id: "sku3", code: "ASHWA", name: "ASHWAGANDHA KSM66 + ASTRAGALUS", weight: null },
  { id: "sku4", code: "CARBBM", name: "CARB X 1.2KG - BLACKCURRANT MOJITO", weight: 1200 },
  { id: "sku5", code: "PERUBCAA1400", name: "BCAA AMINO-HYDRATE 1.4KG ICY BLUE", weight: 1400 },
  { id: "sku6", code: "BCAA1400BR", name: "BCAA AMINO-HYDRATE 1.4KG ICY BLUE RAZZ", weight: 1400 },
];

async function stub(page: Page) {
  await page.addInitScript(([ref, session]) => {
    window.localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(session));
  }, [PROJECT_REF, FAKE_SESSION] as const);

  await page.route(/supabase\.co/, async (route: Route) => {
    const url = route.request().url();
    const json = (data: unknown) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
    if (url.includes("/auth/v1/user")) return json(FAKE_SESSION.user);
    if (url.includes("/auth/v1/token")) return json(FAKE_SESSION);
    if (url.includes("/rpc/get_user_role")) return json("admin");
    if (url.includes("/rpc/")) return json(true);
    if (url.includes("/profiles")) return json([{ id: FAKE_SESSION.user.id, name: "Daniel Quiló", email: FAKE_SESSION.user.email, active: true }]);
    if (url.includes("production_sessions")) return json(SESSIONS);
    if (url.includes("sku_products")) return json(SKUS);
    if (url.includes("production_lines")) return json([
      { id: "1", name: "Tablet Line", active: true }, { id: "2", name: "Line 1", active: true },
    ]);
    return json([]);
  });
}

test.beforeEach(async ({ page }) => {
  await stub(page);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/dashboard/shift-history");
  // Generoso de propósito: com os quatro testes deste ficheiro em paralelo contra um
  // `npm run dev` acabado de arrancar, os 5 s por omissão são o tempo de compilação do
  // Vite e não o da folha.
  await expect(page.getByRole("columnheader", { name: "Run" })).toBeVisible({ timeout: 60_000 });
});

test("escreve o turno pela ordem do relógio, e não pela que a base deu", async ({ page }) => {
  // O fixture manda a das 14:45 primeiro, como a base mandava.
  const skus = await page.locator("tbody tr td:nth-child(7)").allInnerTexts();
  const ordem = skus.map((t) => t.trim()).filter((t) => /^[A-Z0-9]+$/.test(t));
  expect(ordem.slice(0, 3)).toEqual(["USSHREDCAPS", "CALCIUMK2", "ASHWA"]);
});

test("diz o que cada corrida levou", async ({ page }) => {
  // 06:20 → 07:07 são 47 minutos; 07:50 → 14:25 são 6h35. A fila sem fim não tem
  // duração nenhuma, e um travessão é o que se escreve quando não há número.
  const row = page.locator("tbody tr").filter({ hasText: "USSHREDCAPS" }).first();
  await expect(row).toContainText("47m");
  await expect(page.locator("tbody tr").filter({ hasText: "CALCIUMK2" }).first()).toContainText("6h35");
});

test("escreve o intervalo ENTRE duas corridas, e acusa uma sobreposição", async ({ page }) => {
  await expect(page.getByText("43m changeover")).toBeVisible();
  // Line 1: a segunda corrida começa 25 minutos antes de a primeira acabar.
  await expect(page.getByText(/overlaps the run above by 25m/)).toBeVisible();
  // E a noite que atravessa a meia-noite: 23:40 → 01:20 são 100 minutos.
  await expect(page.getByText("1h40 changeover")).toBeVisible();
});

test("a banda da baía soma o relógio da linha no dia", async ({ page }) => {
  await expect(page.getByText(/9h22 running · 1h03 between runs/)).toBeVisible();
  await expect(page.getByText("1 overlap")).toBeVisible();
});


test("escreve a data e a linha uma vez por bloco, e o turno onde ele muda", async ({ page }) => {
  // Um bloco é, por construção, uma data e uma linha só — e estavam escritas em todas
  // as filas dele. Continuam no DOM para quem ouve a folha; o que sai é a repetição.
  const primeira = page.locator("tbody tr").filter({ hasText: "USSHREDCAPS" }).first();
  const seguinte = page.locator("tbody tr").filter({ hasText: "CALCIUMK2" }).first();
  await expect(primeira.locator("td").nth(1).locator("span.sr-only")).toHaveCount(0);
  await expect(seguinte.locator("td").nth(1).locator("span.sr-only")).toHaveCount(1);
  await expect(seguinte.locator("td").nth(3).locator("span.sr-only")).toHaveCount(1);
  // A conta do fixture: oito filas, dois blocos (Tablet e Line 1) e três sessões
  // (Tablet dia, Line 1 dia, Line 1 noite). A data e a linha escrevem-se uma vez por
  // bloco — seis filas ficam caladas. O turno escreve-se onde muda, como o líder na
  // coluna ao lado: três vezes, e cinco caladas.
  await expect(page.locator("tbody tr > td:nth-child(2) > span.sr-only")).toHaveCount(6);
  await expect(page.locator("tbody tr > td:nth-child(4) > span.sr-only")).toHaveCount(6);
  await expect(page.locator("tbody tr > td:nth-child(3) > span.sr-only")).toHaveCount(5);
});

test("diz quantas corridas é que não têm hora que se leia", async ({ page }) => {
  // A fila das 12:00 ficou por fechar: oito corridas, sete medidas.
  await expect(page.getByText("1 without a readable time")).toBeVisible();
  await expect(page.getByText("1 untimed")).toBeVisible();
});

test.describe("num portátil noutro fuso", () => {
  test.use({ timezoneId: "America/New_York" });

  test("a folha continua a dizer a hora do relógio da fábrica", async ({ page }) => {
    // O ecrã escrevia as horas no fuso da máquina. Em Nova Iorque as 06:20 de Warrington
    // passavam a 01:20 — e o campo, que grava sempre Londres, gravava-as de volta como
    // 01:20 de Warrington a quem lhe tocasse.
    const linha = page.locator("tbody tr").filter({ hasText: "USSHREDCAPS" }).first();
    await expect(linha.locator('input[type="time"]').first()).toHaveValue("06:20");
    await expect(linha).toContainText("47m");
  });
});
