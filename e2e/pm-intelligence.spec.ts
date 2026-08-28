import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * O PM Intelligence num telemóvel, num tablet de linha e num monitor de escritório.
 *
 * Aqui mede-se só o que o jsdom não sabe responder. A aritmética está em
 * src/lib/pmIntelligence.test.ts e o comportamento do ecrã em
 * src/pages/dashboard/PMIntelligencePage.test.tsx; nada disso se repete.
 *
 * O que esta página tem de próprio e arriscado é uma tabela de oito colunas com
 * `min-w-[860px]` dentro de um `overflow-x-auto`: tem de deslizar dentro do seu
 * cartão sem levar a página atrás. E os rótulos dos KPIs são curtos e vivem em
 * caixas estreitas, que é exactamente onde o `overflow-wrap: anywhere` do index.css
 * parte uma palavra a meio sem falhar nenhuma verificação de largura.
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
    email: "planner@fixture.local",
    app_metadata: {},
    user_metadata: {},
    created_at: "2026-01-01T00:00:00Z",
  },
};

const PROFILE = {
  id: FAKE_SESSION.user.id,
  name: "Maintenance Manager",
  email: FAKE_SESSION.user.email,
  active: true,
};

/** O registo de activos como está na base: as duas tabelas cruzam-se. */
const LINES = [
  { id: "l1", name: "Line 1", has_sides: false, display_order: 1 },
  { id: "l4", name: "Line 4", has_sides: false, display_order: 4 },
  { id: "l5", name: "Line 5", has_sides: true, display_order: 5 },
  { id: "l6", name: "Line 6", has_sides: true, display_order: 6 },
  { id: "lc1", name: "Capsules Machine 1", has_sides: false, display_order: 7 },
];

const MACHINES = [
  { id: "m1", name: "Line 1", line_id: "l1" },
  { id: "m4", name: "Line 4", line_id: "l4" },
  { id: "m5a", name: "Line 5A", line_id: "l5" },
  { id: "m5b", name: "Line 5B", line_id: "l5" },
  { id: "m6a", name: "Line 6A", line_id: "l6" },
  { id: "m6b", name: "Line 6B", line_id: "l6" },
  { id: "mc1", name: "Capsules Machine 1", line_id: "lc1" },
  { id: "mcp", name: "Capsules Packing", line_id: null },
];

/**
 * Uma frota construída para que os seis blocos apareçam todos.
 *
 * Uma frota só de casos fáceis nunca encontra um transbordo: as descrições são
 * compridas de propósito, e `Bag Sealer 4 + Printer 5 @ Line 3` é um nome de texto
 * livre como os que estão mesmo na base — o pior caso para uma coluna estreita.
 */
const day = 86_400_000;
const ago = (n: number) => new Date(Date.now() - n * day).toISOString();

function fleet() {
  const rows: Record<string, unknown>[] = [];
  let n = 0;
  const wo = (machine: string, daysAgo: number, description: string, extra: Record<string, unknown> = {}) => {
    n += 1;
    rows.push({
      id: `wo-${n}`, wo_number: 1000 + n, machine, created_at: ago(daysAgo),
      description, status: "closed", priority: "medium", requester_name: "Operator",
      operator_id: PROFILE.id, engineer_id: null, engineer_name: null, closed_by: null,
      signed_by_name: null, notified_engineers: [], notes: "", wo_type: "production",
      line_at_time: machine.startsWith("Line") ? machine.slice(0, 6) : "Line 3",
      line_id: "l4", received_at: null, arrived_at: null,
      started_at: ago(daysAgo), finished_at: new Date(Date.now() - daysAgo * day + 40 * 60_000).toISOString(),
      closed_at: null, completed_at: null, paused_at: null, total_paused_minutes: 0,
      ...extra,
    });
  };

  // Crónico: avaria mais depressa do que qualquer ciclo preventivo apanha.
  for (let i = 0; i < 73; i++) {
    wo("Line 4", 1 + (i % 88), "Conveyor jam at the infeed — belt tracking off and the guide rail worked loose again");
  }
  for (let i = 0; i < 16; i++) wo("Line 6A", 2 + i * 5, "Sealer temperature drifting out of tolerance mid-run");
  // Pronto para plano: intervalo mensurável, sem plano nenhum.
  for (let i = 0; i < 4; i++) wo("Capsules Machine 1", 5 + i * 20, "Feeder blocked by capsule fines");
  for (let i = 0; i < 2; i++) wo("Bag Sealer 4 + Printer 5 @ Line 3", 20 + i * 30, "Printer ribbon shredding on the sleeve");
  // Intervalo desviado e intervalo calibrado (têm plano na base).
  for (let i = 0; i < 5; i++) wo("Line 5A", 6 + i * 16, "Pump seal weeping");
  for (let i = 0; i < 4; i++) wo("Capsules Packing", 8 + i * 21, "Carton magazine misfeed");
  // Agregado: a ordem nomeia uma linha inteira.
  for (let i = 0; i < 3; i++) wo("Line 5", 12 + i * 25, "Line stopped, cause not recorded against a machine");
  // Falha única.
  wo("Line 6B", 30, "Guard interlock intermittent");
  wo("Line 1", 44, "Compressed air leak at the manifold");
  // Excluídas: não são avarias.
  wo("Line 4", 9, "Planned service", { wo_type: "preventive" });
  wo("Line 4", 11, "Stores pick", { wo_type: "warehouse_service" });
  // Sem activo nomeado — lidas, e impossíveis de agrupar.
  wo("", 4, "Something on the floor");
  wo("", 14, "Reported by phone");
  return rows;
}

const PM_SCHEDULES = [
  // Muito mais frequente do que a evidência pede → "Interval has drifted".
  {
    id: "pm-1", machine: "Line 5A", title: "Pump seal check", description: null,
    interval_days: 7, last_done_at: ago(3), next_due_at: ago(-4), active: true,
    assigned_engineer_id: null, priority: "medium", created_by: null,
    created_at: ago(200), updated_at: ago(3),
  },
  // Já bate certo com o que as falhas dizem → "Calibrated".
  {
    id: "pm-2", machine: "Capsules Packing", title: "Magazine service", description: null,
    interval_days: 16, last_done_at: ago(5), next_due_at: ago(-11), active: true,
    assigned_engineer_id: null, priority: "medium", created_by: null,
    created_at: ago(200), updated_at: ago(5),
  },
];

async function stubSupabase(page: Page) {
  await page.addInitScript(
    ([ref, session]) => {
      window.localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(session));
    },
    [PROJECT_REF, FAKE_SESSION] as const,
  );

  const WORK_ORDERS = fleet();

  await page.route(/supabase\.co/, async (route: Route) => {
    const url = route.request().url();
    const json = (data: unknown) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });

    if (url.includes("/auth/v1/user")) return json(FAKE_SESSION.user);
    if (url.includes("/auth/v1/token")) return json(FAKE_SESSION);
    // maintenance_manager tem pm.view e pm.manage — os botões têm de aparecer.
    if (url.includes("/rpc/get_user_role")) return json("maintenance_manager");
    if (url.includes("/rpc/list_active_profile_names")) return json([{ id: PROFILE.id, name: PROFILE.name }]);
    if (url.includes("/rpc/list_engineer_names")) return json([]);
    if (url.includes("/rest/v1/work_orders")) return json(WORK_ORDERS);
    if (url.includes("/rest/v1/pm_schedules")) return json(PM_SCHEDULES);
    if (url.includes("/rest/v1/machines")) return json(MACHINES);
    if (url.includes("/rest/v1/lines")) return json(LINES);
    if (url.includes("/rest/v1/profiles")) return json(PROFILE);
    return json([]);
  });
}

/** A única coisa que o jsdom não consegue: a página cabe na largura que lhe deram? */
async function assertNoSidewaysScroll(page: Page, where: string) {
  // NOTE — this compares document.scrollWidth against window.innerWidth, and index.css
  // clamps html/body/#root to 100vw with overflow-x: hidden, so scrollWidth can never
  // exceed innerWidth and this can never fail. Proved by injecting a 900px div into a
  // 390px viewport: scrollWidth stayed at 390. Kept because it costs nothing and would
  // start working if the clamp were ever removed, but the check that finds real defects
  // is assertNothingIsClipped in every-screen-empty.spec.ts, which measures element
  // right edges instead — it found three screens this one had passed.
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    widest: (() => {
      let worst = { tag: "", cls: "", right: 0 };
      document.querySelectorAll<HTMLElement>("body *").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.right > worst.right) worst = { tag: el.tagName, cls: String(el.className).slice(0, 80), right: Math.round(r.right) };
      });
      return worst;
    })(),
  }));
  expect(
    overflow.scrollWidth,
    `${where}: a página desliza de lado — o elemento mais largo ${overflow.widest.tag}.${overflow.widest.cls} chega aos ${overflow.widest.right}px`,
  ).toBeLessThanOrEqual(overflow.innerWidth + 1);
}

/**
 * Nenhuma palavra pode ser partida entre linhas.
 *
 * O index.css põe `overflow-wrap: anywhere` em cada div e span dentro de `main`, por
 * isso uma palavra larga de mais para a sua caixa não é cortada nem transborda — é
 * partida onde acaba o espaço. Os rótulos dos KPIs desta página são exactamente esse
 * caso: caixas estreitas, quatro numa grelha, texto curto.
 */
async function assertNoWordIsBroken(page: Page, where: string) {
  const broken = await page.evaluate(() => {
    const out: string[] = [];
    document.querySelectorAll<HTMLElement>("main p, main span, main div, main li").forEach((el) => {
      const text = (el.textContent ?? "").trim();
      if (!text || /\s/.test(text) || el.childElementCount > 0) return;
      const range = document.createRange();
      range.selectNodeContents(el);
      const lines = new Set(Array.from(range.getClientRects()).map((r) => Math.round(r.top)));
      if (lines.size > 1) out.push(text);
    });
    return out;
  });
  expect(broken, `${where}: estas palavras estão partidas entre linhas`).toEqual([]);
}

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

for (const vp of VIEWPORTS) {
  test.describe(`${vp.name} (${vp.width}×${vp.height})`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("the screen fits, and the wide table scrolls inside its own card", async ({ page }) => {
      await stubSupabase(page);
      await page.goto("/dashboard/pm-intelligence");

      await expect(page.getByRole("heading", { name: "PM Intelligence" })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText("Service intervals")).toBeVisible({ timeout: 30_000 });

      // `fullPage` só apanha o viewport: o DashboardLayout faz scroll dentro de si
      // próprio, por isso o documento nunca cresce. A tabela é fotografada à parte.
      await page.screenshot({ path: `e2e/.results/pm-${vp.name}-1-overview.png`, fullPage: true });
      await page.locator("table").first().screenshot({ path: `e2e/.results/pm-${vp.name}-3-table.png` });

      await assertNoSidewaysScroll(page, `${vp.name} PM Intelligence`);
      await assertNoWordIsBroken(page, `${vp.name} PM Intelligence`);

      // A tabela é larga de propósito. Deslizar é o comportamento certo — desde que
      // deslize dentro do cartão dela e não leve a página atrás.
      const scroller = page.locator(".overflow-x-auto").filter({ has: page.locator("table") }).first();
      const box = await scroller.boundingBox();
      expect(box!.width, "o cartão da tabela é mais largo do que o ecrã").toBeLessThanOrEqual(vp.width);
    });

    test("every deck the evidence produced is on screen, and says what to do", async ({ page }) => {
      await stubSupabase(page);
      await page.goto("/dashboard/pm-intelligence");
      await expect(page.getByText("Service intervals")).toBeVisible({ timeout: 30_000 });

      /*
       * Dentro da tabela, e não na página inteira: os mosaicos de KPI são também
       * botões e usam de propósito as mesmas palavras que os blocos que filtram.
       * Um nome repetido no ecrã é coerência; num selector é ambiguidade.
       */
      const table = page.locator("table").first();
      for (const deck of [
        "Fails faster than any PM cycle",
        "Ready for a plan",
        "Interval has drifted",
        "Calibrated",
        "Recorded against a line",
        "Too few failures to measure",
      ]) {
        await expect(
          table.getByRole("button", { name: new RegExp(`^${deck}`) }),
          `o bloco "${deck}" não está no ecrã`,
        ).toBeVisible();
      }

      // O bug de origem: a mesma constante em todas as linhas. Os intervalos
      // recomendados têm de ser mais do que um valor distinto.
      const recommended = await page.evaluate(() => {
        const cells: string[] = [];
        document.querySelectorAll("table tbody tr").forEach((tr) => {
          const td = tr.children[5];
          if (td) cells.push((td.textContent ?? "").trim());
        });
        return cells.filter((c) => /^\d+d/.test(c));
      });
      expect(new Set(recommended).size, `só um intervalo distinto em toda a tabela: ${recommended.join(", ")}`)
        .toBeGreaterThan(1);
    });

    test("the period is a control, and changing it changes the numbers", async ({ page }) => {
      await stubSupabase(page);
      await page.goto("/dashboard/pm-intelligence");
      await expect(page.getByText("Service intervals")).toBeVisible({ timeout: 30_000 });

      const period = page.getByRole("button", { name: "Period", exact: true });
      await expect(period).toBeVisible();
      /*
       * O que se afirma é o estado final, não a diferença para um texto capturado
       * antes: comparar com um retrato anterior corre contra o primeiro arranque do
       * servidor e falhou uma vez em nove por isso.
       *
       * E afirma-se o número de dias de propósito. O chip dizia "Last 90 days" e a
       * frase por baixo dizia "the 89 days to…", porque o preset vai de
       * `startOfDay(hoje−89)` até agora e um `Math.round` cortava a fracção do dia
       * de hoje. Os dois têm de dizer o mesmo.
       */
      await expect(page.getByText(/Read from/)).toContainText("the 90 days to", { timeout: 15_000 });

      await period.click();
      await page.getByRole("button", { name: "Last 7 days", exact: true }).click();
      await expect(page.getByText(/Read from/)).toContainText("the 7 days to", { timeout: 15_000 });

      await page.screenshot({ path: `e2e/.results/pm-${vp.name}-2-seven-days.png`, fullPage: true });
      await assertNoSidewaysScroll(page, `${vp.name} PM Intelligence, 7 days`);
      await assertNoWordIsBroken(page, `${vp.name} PM Intelligence, 7 days`);
    });
  });
}
