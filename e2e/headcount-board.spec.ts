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

const AREA_IDS = AREAS.map((a) => a.id);
const ALLOCS = EMP.map((e, i) => ({
  id: `a${i}`, employee_id: e.id, on_date: "2026-10-01", shift: "Day",
  area_id: i < 26 ? AREA_IDS[i % AREA_IDS.length] : null,
  status: i < 26 ? "assigned" : ["sick", "holiday", "overtime", "unpaid"][i % 4],
  half_day: false, left_early_at: null, arrived_late_at: null, note: null, is_leader: i % 7 === 0,
}));

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
    if (url.includes("/rest/v1/daily_allocations")) return json(ALLOCS);
    if (url.includes("/rest/v1/employees")) return json(EMP);
    if (url.includes("/rest/v1/profiles")) return json(PROFILE);
    return json([]);
  });
}

async function openBoard(page: Page) {
  await stub(page);
  await page.setViewportSize({ width: 1600, height: 1400 });
  await page.goto("/dashboard/headcount");
  await page.locator(".headcount-columns").first().waitFor({ state: "visible", timeout: 20000 });
  // Dentro do board: o mesmo nome está também na folha de impressão escondida que o
  // ecrã carrega, e `.first()` sozinho resolve para essa.
  await expect(page.locator(".headcount-columns").getByText("Pedro Assis").first())
    .toBeVisible({ timeout: 15000 });
}

/** Os títulos das bandas, pela ordem em que estão no ecrã. */
async function bands(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll(".headcount-section-label")]
      // As maiúsculas são do CSS; o texto é "Production16".
      .map((el) => (el.textContent ?? "").replace(/\d+/g, "").trim().toUpperCase())
      .filter(Boolean),
  );
}

test("o board desenha as duas bandas da planilha, e não três", async ({ page }) => {
  await openBoard(page);

  // Eram Production, Sectors e Support. A folha da empresa tem duas bandas, e a
  // Hygiene, a Quality, o WH team e a Maintenance estão na segunda, ao lado do Lab e
  // do Office. O ecrã e o papel passam a arrumar a mesma gente da mesma maneira.
  const seen = await bands(page);
  expect(seen, `bandas no ecrã: ${seen.join(" | ")}`).not.toContain("SECTORS");
  expect(seen.filter((b) => b === "PRODUCTION" || b === "SUPPORT")).toEqual(["PRODUCTION", "SUPPORT"]);
});

test("os sectores estão na banda de apoio, e o Runner na de produção", async ({ page }) => {
  await openBoard(page);

  // Onde cada coluna cai é a prova de que a regra é a da planilha: `section` decide,
  // e o Runner tem `section = production` apesar de `kind = support`.
  const where = await page.evaluate(() => {
    const out: Record<string, string> = {};
    let band = "";
    document.querySelectorAll(".headcount-section-label, .headcount-columns").forEach((el) => {
      if (el.classList.contains("headcount-section-label")) {
        band = (el.textContent ?? "").replace(/\d+/g, "").trim().toUpperCase();
        return;
      }
      el.querySelectorAll("[data-slot='card-title'], .truncate.text-sm.font-bold").forEach((t) => {
        const name = (t.textContent ?? "").trim();
        if (name) out[name] = band;
      });
    });
    return out;
  });

  expect(where["Hygiene"], "a Hygiene tem de estar no apoio, como na folha").toBe("SUPPORT");
  expect(where["Quality"]).toBe("SUPPORT");
  expect(where["WH team"]).toBe("SUPPORT");
  expect(where["Maintenance"]).toBe("SUPPORT");
  expect(where["Runner"], "o Runner fica na produção, que é onde a folha o tem").toBe("PRODUCTION");
  expect(where["Line 1"]).toBe("PRODUCTION");
});

test("cada coluna acaba num Total, como cada coluna da planilha", async ({ page }) => {
  await openBoard(page);

  // A contagem estava num crachá no cabeçalho. Na folha fica debaixo do último nome,
  // e era aí que quem lê a folha a ia procurar no ecrã sem a encontrar.
  const columns = await page.evaluate(() => {
    const out: { name: string; total: string | null; totalBelowNames: boolean }[] = [];
    document.querySelectorAll(".headcount-columns > *").forEach((col) => {
      const name = (col.querySelector(".truncate.text-sm.font-bold")?.textContent ?? "").trim();
      if (!name) return;
      const foot = [...col.querySelectorAll("div")].find((d) => d.firstElementChild?.textContent?.trim() === "Total");
      const title = col.querySelector(".truncate.text-sm.font-bold");
      out.push({
        name,
        total: foot ? (foot.lastElementChild?.textContent ?? "").trim() : null,
        totalBelowNames: !!(foot && title && title.getBoundingClientRect().bottom < foot.getBoundingClientRect().top),
      });
    });
    return out;
  });

  expect(columns.length, "não há colunas nenhumas no board").toBeGreaterThan(8);
  for (const c of columns) {
    expect(c.total, `a coluna ${c.name} não acaba num Total`).not.toBeNull();
    expect(c.total, `o Total de ${c.name} não é um número`).toMatch(/^\d+$/);
    expect(c.totalBelowNames, `o Total de ${c.name} não está debaixo dos nomes`).toBe(true);
  }

  await page.screenshot({ path: "e2e/.results/board.png", fullPage: true });
});

test("o nome cabe inteiro, e os Totais de uma banda ficam na mesma fila", async ({ page }) => {
  await openBoard(page);

  // Com o FRI–MON ao lado do nome, uma coluna de 150px mostrava "Sandro V…". O nome
  // passou para uma linha sua; aqui mede-se que nenhum nome da banda é cortado.
  const cut = await page.evaluate(() =>
    [...document.querySelectorAll(".headcount-columns .headcount-chip .truncate")]
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map((el) => el.textContent),
  );
  expect(cut, `nomes cortados: ${cut.join(", ")}`).toEqual([]);

  // As células com marca são mais altas se ninguém as prender; os Totais saíam em degraus.
  const tops = await page.evaluate(() => {
    const band = document.querySelector(".headcount-columns")!;
    return [...band.querySelectorAll(".headcount-sheet-column")].map((col) =>
      Math.round([...col.querySelectorAll("span")].find((s) => s.textContent?.trim() === "Total")!.getBoundingClientRect().top),
    );
  });
  expect(new Set(tops).size, `Totais a alturas diferentes: ${tops.join(", ")}`).toBe(1);
});

test("escreve-se um nome na célula vazia e a pessoa entra na coluna", async ({ page }) => {
  // Como na folha: escreve-se na célula. Mas o que se grava é a pessoa do cadastro
  // escolhida na lista, nunca o texto escrito.
  const writes: Record<string, unknown>[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/rest/v1/daily_allocations") && r.method() === "POST") {
      const body = r.postDataJSON();
      writes.push(...(Array.isArray(body) ? body : [body]));
    }
  });
  await openBoard(page);

  const cell = page.getByRole("combobox", { name: "Add a person to Line 3" });
  await cell.fill("vasconc");
  await expect(page.getByRole("option", { name: /Sandro Vasconcelos/ })).toBeVisible();
  await cell.press("Enter");

  await expect.poll(() => writes.length).toBeGreaterThan(0);
  const w = writes.at(-1)!;
  expect(w.employee_id).toBe("e3");
  expect(w.area_id).toBe("l3");
  await expect(cell).toHaveValue("");
});

test("quem não tem crew no cadastro aparece no board, numa coluna à parte", async ({ page }) => {
  // Criados pelo import da folha sem crew, não estavam em board nenhum: nem numa
  // coluna, nem em "Not placed yet". Ninguém os via.
  await stub(page);
  const crewless = { id: "nc1", full_name: "Rita Semcrew", department: null, active: true, shift_group: null, start_date: "2026-10-01", end_date: null, role: null };
  await page.route(/\/rest\/v1\/employees/, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([...EMP, crewless]) }));
  await page.setViewportSize({ width: 1600, height: 1400 });
  await page.goto("/dashboard/headcount");
  const board = page.locator(".headcount-columns");
  await expect(board.getByText("Pedro Assis").first()).toBeVisible({ timeout: 20000 });

  const col = page.locator(".headcount-sheet-column", { hasText: "No crew on file" }).first();
  await expect(col).toBeVisible();
  await expect(col.getByText("Rita Semcrew")).toBeVisible();
  // Uma vez só: não é "por colocar" do turno, é outra coisa.
  await expect(page.locator(".headcount-sheet-column", { hasText: "Not placed yet" }).getByText("Rita Semcrew")).toHaveCount(0);
});
