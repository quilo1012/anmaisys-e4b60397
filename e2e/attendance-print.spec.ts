import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * O Time & Attendance em papel.
 *
 * Esta folha é entregue: vai do ecrã para a mão de quem fecha o salário, e é o único
 * sítio da aplicação onde a impressão não é uma conveniência mas o produto. O jsdom
 * não sabe responder a nada disto — não faz layout, não carrega o Tailwind e não tem
 * media `print`. Um Chromium real tem as três coisas.
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

const PROFILE = { id: FAKE_SESSION.user.id, name: "Office", email: FAKE_SESSION.user.email, active: true };

const PERIOD = { start_date: "2026-09-14", end_date: "2026-09-27" };

/**
 * Uma folha de pagamento como as que saem daqui: nomes compostos, departamentos de
 * texto livre e motivos de falta que se somam numa coluna estreita. Os nomes são
 * longos de propósito — é a coluna que parte.
 */
const PEOPLE = [
  ["Alexandra Nascimento Figueiredo", "Packing & Labelling"],
  ["Bartosz Wiśniewski", "Blending"],
  ["Carlos Manuel Ribeiro da Silva", "Packing & Labelling"],
  ["Daniela Oliveira", "Quality"],
  ["Eduardo Santos Monteiro", "Warehouse"],
  ["Fernanda Lopes Carvalho", "Blending"],
  ["Grzegorz Kowalczyk", "Engineering"],
  ["Helena Marques Pinto", "Packing & Labelling"],
  ["Ionuț Alexandru Popescu", "Warehouse"],
  ["Joana Rodrigues Teixeira", "Quality"],
  ["Krzysztof Nowakowski", "Engineering"],
  ["Luís Filipe Gonçalves", "Blending"],
  ["Mariana Costa Almeida", "Packing & Labelling"],
  ["Nuno Miguel Fernandes", "Warehouse"],
  ["Olga Kowalska", "Hygiene"],
  ["Patrícia Sousa Cardoso", "Packing & Labelling"],
  ["Ricardo Jorge Pereira", "Engineering"],
  ["Sofia Antunes Barbosa", "Quality"],
  ["Tomasz Zieliński", "Blending"],
  ["Vera Lúcia Machado", "Hygiene"],
  ["Wojciech Lewandowski", "Warehouse"],
  ["Ana Beatriz Correia Mendes", "Packing & Labelling"],
  ["Bruno Alexandre Matos", "Blending"],
  ["Cátia Sofia Nunes", "Quality"],
] as const;

const EMPLOYEES = PEOPLE.map(([full_name, department], i) => ({
  id: `emp-${i + 1}`,
  full_name,
  department,
  active: true,
  // A tabela `employees` é lida por dois sítios com `select` diferentes; o fixture
  // devolve o superconjunto para que ambos encontrem o que pedem.
  role: null,
  shift: i % 2 === 0 ? "Day" : "Night",
  start_date: "2024-01-08",
  end_date: null,
}));

const ABSENCES = ["Sickness", "Holiday", "Unpaid Leave", "Compassionate Leave", null, null, null, null];

/** Catorze dias de relógio, com faltas espalhadas de forma reprodutível. */
function attendanceDays() {
  const rows: Record<string, unknown>[] = [];
  const start = new Date(`${PERIOD.start_date}T00:00:00Z`);
  EMPLOYEES.forEach((e, i) => {
    for (let d = 0; d < 14; d++) {
      const day = new Date(start.getTime() + d * 86_400_000);
      const on_date = day.toISOString().slice(0, 10);
      if (day.getUTCDay() === 0) continue; // domingo
      const absence = ABSENCES[(i * 3 + d) % ABSENCES.length];
      // Um terço da folha fica a dever horas. O saldo é a única coluna com sinal e o
      // papel não tem cor para o carregar, por isso tem de haver negativos aqui.
      const short = i % 3 === 0;
      const worked = absence ? 0 : short ? 585 + ((i + d) % 4) * 10 : 660 + ((i + d) % 5) * 15;
      rows.push({
        employee_id: e.id,
        on_date,
        worked_minutes: worked,
        balance_minutes: absence ? 0 : worked - 660,
        absence_name: absence,
      });
    }
  });
  return rows;
}

async function stubSupabase(page: Page) {
  await page.addInitScript(
    ([ref, session]) => {
      window.localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(session));
      // A segunda porta do Time & Attendance. O PIN é verificado por uma edge
      // function; aqui a secção já está aberta, porque o que se mede é a folha.
      window.sessionStorage.setItem("pin-ok:workforce", "1");
    },
    [PROJECT_REF, FAKE_SESSION] as const,
  );

  const DAYS = attendanceDays();

  await page.route(/supabase\.co/, async (route: Route) => {
    const url = route.request().url();
    const json = (data: unknown) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });

    if (url.includes("/auth/v1/user")) return json(FAKE_SESSION.user);
    if (url.includes("/auth/v1/token")) return json(FAKE_SESSION);
    if (url.includes("/rpc/get_user_role")) return json("admin");
    if (url.includes("/rest/v1/workforce_payroll_periods")) return json(PERIOD);
    if (url.includes("/rest/v1/attendance_days")) return json(DAYS);
    if (url.includes("/rest/v1/employees")) return json(EMPLOYEES);
    if (url.includes("/rest/v1/profiles")) return json(PROFILE);
    return json([]);
  });
}

async function openTheSheet(page: Page) {
  await stubSupabase(page);
  // A4 paisagem em pixels CSS, que é a largura a que o browser compõe a folha.
  await page.setViewportSize({ width: 1123, height: 794 });
  await page.goto("/dashboard/attendance");
  await expect(page.getByRole("heading", { name: "Time & Attendance" })).toBeVisible();
  await expect(page.getByText("Alexandra Nascimento Figueiredo")).toBeVisible();
  await page.emulateMedia({ media: "print" });
}

/**
 * Nenhuma palavra pode ser partida entre linhas.
 *
 * O index.css põe `overflow-wrap: anywhere` em cada div e span dentro de `main`, e a
 * folha impressa é estreita onde o ecrã é largo: é aqui que uma palavra se parte a
 * meio sem falhar nenhuma verificação de largura.
 */
async function assertNoWordIsBroken(page: Page, where: string) {
  const broken = await page.evaluate(() => {
    const out: string[] = [];
    document.querySelectorAll<HTMLElement>("main p, main span, main div, main dt, main dd, main td, main th").forEach((el) => {
      const text = (el.textContent ?? "").trim();
      if (!text || /\s/.test(text) || el.childElementCount > 0) return;
      const range = document.createRange();
      range.selectNodeContents(el);
      if (range.getClientRects().length > 1) out.push(text.slice(0, 40));
    });
    return out;
  });
  expect(broken, `${where}: palavra partida a meio — ${broken.join(", ")}`).toEqual([]);
}

test("a primeira folha é o documento, e não uma folha em branco", async ({ page }) => {
  await openTheSheet(page);

  // A barra lateral é `h-svh`. Enquanto não trazia `data-sidebar`, a regra de
  // impressão não lhe chegava e ela reservava uma folha inteira: o documento começava
  // na página dois e a um saía da impressora em branco.
  const headTop = await page.evaluate(() => {
    const h = document.querySelector("header.sheet-head, header.print-keep") as HTMLElement | null;
    return h ? Math.round(h.getBoundingClientRect().top) : -1;
  });
  expect(headTop, "o título do documento tem de estar na primeira folha").toBeGreaterThan(0);
  expect(headTop, "o título do documento foi empurrado para fora da primeira folha").toBeLessThan(200);
});

test("só o documento vai para o papel", async ({ page }) => {
  await openTheSheet(page);

  // `.print-content [class*="flex"] { display: flex !important }` batia `.no-print` e
  // `button:not(.print-keep)` na especificidade, e seis controlos saíam impressos.
  const controls = await page.evaluate(() =>
    [...document.querySelectorAll("button, input")]
      .filter((el) => {
        const cs = getComputedStyle(el);
        return cs.display !== "none" && cs.visibility !== "hidden";
      })
      .map((el) => (el.textContent || (el as HTMLInputElement).value || el.tagName).trim().slice(0, 30)),
  );
  expect(controls, `controlos impressos na folha: ${controls.join(", ")}`).toEqual([]);
});

test("cada linha da tabela continua a ser uma linha", async ({ page }) => {
  await openTheSheet(page);

  // `.print-content .truncate { display: block }` apanhava a célula do nome e punha-a
  // fora da linha: a coluna deixava de ser dimensionada com as outras.
  const displays = await page.evaluate(() => {
    const set = new Set<string>();
    document.querySelectorAll("tbody tr").forEach((r) =>
      [...r.children].forEach((c) => set.add(getComputedStyle(c).display)),
    );
    return [...set];
  });
  expect(displays, "uma célula deixou de ser célula no papel").toEqual(["table-cell"]);

  const widths = await page.evaluate(() =>
    [...document.querySelectorAll("tbody tr")].map((r) =>
      Math.round(r.children[0].getBoundingClientRect().width),
    ),
  );
  expect(new Set(widths).size, "a coluna Employee tem larguras diferentes de linha para linha").toBe(1);
});

test("a folha diz o que é, soma e tem onde se assinar", async ({ page }) => {
  await openTheSheet(page);

  await expect(page.getByRole("heading", { name: "Time & Attendance" })).toBeVisible();
  await expect(page.getByText("14/09/2026 — 27/09/2026").first()).toBeVisible();
  await expect(page.getByText(/Hours clocked on TimeMoto/)).toBeVisible();

  // A cabeça corrente: o Chrome não numera páginas com `@page`, e esta folha são seis
  // para cento e setenta e seis pessoas. O `<thead>` repete-se, e é o que diz à folha
  // quatro o que ela é.
  await expect(page.locator("th.print-caption")).toContainText("Time & Attendance");
  await expect(page.locator("th.print-caption")).toContainText("14/09/2026");

  // Uma folha de números que não fecha é uma folha que ninguém pode conferir.
  const total = page.locator("tr.sheet-total");
  await expect(total).toBeVisible();
  await expect(total).toContainText("Total");

  await expect(page.getByText("Checked by")).toBeVisible();
  await expect(page.getByText("Signature")).toBeVisible();
});

test("o saldo devido lê-se sem cor nenhuma", async ({ page }) => {
  await openTheSheet(page);

  // Numa laser monocromática o verde e o âmbar saem o mesmo cinzento, e um número
  // cinzento lê-se como um número menos importante — o contrário do que é verdade.
  // No papel o sinal é o traço de menos e o peso da letra.
  const owed = page.locator("td.text-destructive-strong").first();
  await expect(owed).toBeVisible();
  const style = await owed.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { weight: cs.fontWeight, colour: cs.color };
  });
  expect(Number(style.weight), "a hora devida tem de vir a negrito no papel").toBeGreaterThanOrEqual(700);
  expect(style.colour, "nada nesta folha é impresso a cor").toBe("rgb(0, 0, 0)");
});

test("a folha cabe na largura do papel e nenhuma palavra se parte", async ({ page }) => {
  await openTheSheet(page);

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(
    overflow.scrollWidth,
    "a folha é mais larga do que o papel — as colunas da direita não saem impressas",
  ).toBeLessThanOrEqual(overflow.innerWidth + 1);

  await assertNoWordIsBroken(page, "a folha impressa");

  await page.screenshot({ path: "e2e/.results/attendance-print.png", fullPage: true });
});
