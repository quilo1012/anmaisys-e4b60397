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
  await expect(page.getByText("Alexandra Nascimento Figueiredo").first()).toBeVisible();
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
    document.querySelectorAll("tbody.sheet-body tr").forEach((r) =>
      [...r.children].forEach((c) => set.add(getComputedStyle(c).display)),
    );
    return [...set];
  });
  expect(displays, "uma célula deixou de ser célula no papel").toEqual(["table-cell"]);

  const widths = await page.evaluate(() =>
    [...document.querySelectorAll(
      "tbody.sheet-body tr:not(.sheet-band):not(.sheet-subtotal):not(.sheet-total)",
    )].map((r) => Math.round(r.children[0].getBoundingClientRect().width)),
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
  const total = page.locator("tbody.sheet-body tr.sheet-total");
  await expect(total).toBeVisible();
  await expect(total).toContainText("All departments");

  await expect(page.getByText("Checked by")).toBeVisible();
  await expect(page.getByText("Signature")).toBeVisible();
});

test("o saldo devido sai a vermelho, e continua legível sem cor nenhuma", async ({ page }) => {
  await openTheSheet(page);

  // No corpo do papel: o do ecrã está lá, escondido, com as suas próprias cores.
  const owed = page.locator("tbody.sheet-body td.text-destructive-strong").first();
  await expect(owed).toBeVisible();
  const style = await owed.evaluate((el) => {
    const cs = getComputedStyle(el);
    const m = /rgba?\((\d+), (\d+), (\d+)/.exec(cs.color)!;
    const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return { weight: Number(cs.fontWeight), r, g, b, text: (el.textContent ?? "").trim() };
  });

  expect(style.r, "o saldo devido tem de sair vermelho").toBeGreaterThan(style.g + 60);
  expect(style.r, "o saldo devido tem de sair vermelho").toBeGreaterThan(style.b + 60);

  // E tem de ser um vermelho ESCURO. Um vermelho vivo passa por uma laser
  // monocromática e sai um cinzento claro: a coluna que menos pode perder o sinal
  // ficaria mais fraca do que o preto à volta dela.
  const luminance = (0.299 * style.r + 0.587 * style.g + 0.114 * style.b) / 255;
  expect(
    luminance,
    `este vermelho sai cinzento a ${Math.round(luminance * 100)}% — mais claro do que o texto à volta quando a folha for a preto`,
  ).toBeLessThan(0.4);

  // A cor nunca é o único portador: o peso e o traço de menos ficam por baixo dela.
  expect(style.weight, "a hora devida tem de vir a negrito, e não só a vermelho").toBeGreaterThanOrEqual(700);
  expect(style.text.startsWith("\u2212") || style.text.startsWith("-"), "o número perdeu o sinal").toBe(true);

  // E a regra vale onde a conta fecha, não só nas pessoas: um departamento a dever
  // horas é o que o chefe tem de ver ao virar a página.
  const negatives = await page.evaluate(() => {
    const out: { where: string; text: string; red: boolean }[] = [];
    document.querySelectorAll("tbody.sheet-body tr.sheet-subtotal, tbody.sheet-body tr.sheet-total").forEach((r) => {
      const cell = [...r.children].find((c) => /^[−-]/.test((c.textContent ?? "").trim())) as HTMLElement | undefined;
      if (!cell) return;
      const m = /rgba?\((\d+), (\d+), (\d+)/.exec(getComputedStyle(cell).color)!;
      out.push({
        where: r.className.includes("sheet-total") ? "o total do documento" : "um subtotal de departamento",
        text: (cell.textContent ?? "").trim(),
        red: Number(m[1]) > Number(m[2]) + 60,
      });
    });
    return out;
  });
  expect(negatives.length, "o fixture tem de fechar alguma conta a negativo").toBeGreaterThan(0);
  for (const n of negatives) {
    expect(n.red, `${n.where} fecha em ${n.text} e sai a preto`).toBe(true);
  }
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

test("a folha é ordenada por departamento, e cada um fecha a sua conta", async ({ page }) => {
  await openTheSheet(page);

  // No ecrã a tabela está por horas trabalhadas, que é a pergunta do ecrã. No papel é
  // entregue também ao chefe de um departamento, que tem doze pessoas em cento e
  // setenta e seis nomes — e uma ordenação por horas espalha-lhe os doze pela folha
  // toda.
  const bands = await page.locator("tbody.sheet-body tr.sheet-band td:first-child").allTextContents();
  expect(bands.length, "a folha tem de abrir um grupo por departamento").toBeGreaterThan(1);
  expect(bands, "os departamentos não estão por ordem").toEqual([...bands].sort((a, b) => a.localeCompare(b)));

  // Dentro do grupo, a ordem é o nome: é por aí que se procura uma pessoa, e uma folha
  // cuja ordem muda de quinzena para quinzena não se compara com a anterior.
  const firstGroupNames = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("tbody.sheet-body tr")];
    const start = rows.findIndex((r) => r.classList.contains("sheet-band"));
    const out: string[] = [];
    for (const r of rows.slice(start + 1)) {
      if (r.classList.contains("sheet-subtotal")) break;
      out.push((r.children[0].textContent ?? "").trim());
    }
    return out;
  });
  expect(firstGroupNames.length).toBeGreaterThan(1);
  expect(firstGroupNames, "os nomes dentro do departamento não estão por ordem")
    .toEqual([...firstGroupNames].sort((a, b) => a.localeCompare(b)));

  // Cada departamento fecha a sua conta, e o documento fecha a de todos.
  const subtotals = page.locator("tbody.sheet-body tr.sheet-subtotal");
  expect(await subtotals.count(), "falta o subtotal de um departamento").toBe(bands.length);
  await expect(page.locator("tbody.sheet-body tr.sheet-total")).toContainText("All departments");
});

test("quem deve horas leva uma marca na margem, e mais ninguém", async ({ page }) => {
  await openTheSheet(page);

  // A marca é uma régua na margem da linha e não uma cor, porque esta folha sai de uma
  // laser monocromática onde o vermelho e o verde saem o mesmo cinzento.
  const marks = await page.evaluate(() => {
    const out: { name: string; balance: string; marked: boolean; rule: boolean }[] = [];
    document.querySelectorAll("tbody.sheet-body tr").forEach((r) => {
      if (r.classList.contains("sheet-band") || r.classList.contains("sheet-subtotal") || r.classList.contains("sheet-total")) return;
      const cells = r.children;
      const first = cells[0] as HTMLElement;
      const before = getComputedStyle(first, "::before");
      out.push({
        name: (first.textContent ?? "").trim(),
        balance: (cells[2]?.textContent ?? "").trim(),
        marked: r.hasAttribute("data-settle"),
        rule: before.content !== "none" && parseFloat(before.width || "0") > 0,
      });
    });
    return out;
  });

  expect(marks.length, "não há linhas de pessoa nenhumas").toBeGreaterThan(5);
  const owing = marks.filter((m) => m.balance.startsWith("\u2212") || m.balance.startsWith("-"));
  expect(owing.length, "o fixture tem de trazer quem deve horas").toBeGreaterThan(0);

  for (const m of marks) {
    const shouldBeMarked = m.balance.startsWith("\u2212") || m.balance.startsWith("-");
    expect(m.marked, `${m.name} tem saldo ${m.balance} e a marca está ${m.marked ? "posta" : "em falta"}`)
      .toBe(shouldBeMarked);
    expect(m.rule, `${m.name}: a marca da margem não foi desenhada`).toBe(shouldBeMarked);
  }
});

test("a cabeça lidera pela conta que falta saldar", async ({ page }) => {
  await openTheSheet(page);

  // Uma fila de cinco números iguais dá o mesmo peso a "24 pessoas", que é contexto, e
  // a horas que ninguém reconciliou, que é trabalho por fazer.
  const lead = page.locator(".sheet-record-lead");
  await expect(lead).toContainText("To settle");
  const size = await lead.locator("dd").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  const rest = await page.locator(".sheet-record > div:not(.sheet-record-lead) dd").first()
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(size, "a figura que lidera tem de ser maior do que as que a acompanham").toBeGreaterThan(rest);
});

test("o saldo devido é a ÚNICA coisa a cor na folha", async ({ page }) => {
  await openTheSheet(page);

  // O resto é cinzento: numa laser monocromática cada matiz é um cinzento
  // imprevisível, e uma folha onde tudo tem cor é uma folha onde nada se destaca.
  const coloured = await page.evaluate(() => {
    const out: string[] = [];
    document.querySelectorAll<HTMLElement>(".attendance-sheet *").forEach((el) => {
      if (!el.textContent?.trim() || el.childElementCount > 0) return;
      // Só o que sai mesmo impresso. O corpo do ecrã continua no DOM, escondido, e
      // tem as cores do ecrã — que é precisamente onde elas devem estar.
      if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return;
      const c = getComputedStyle(el).color;
      const m = c.match(/rgba?\((\d+), (\d+), (\d+)/);
      if (!m) return;
      const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
      if (r === g && g === b) return;
      // A excepção, e é uma só.
      if (el.closest("td")?.classList.contains("text-destructive-strong")) return;
      out.push(`${el.textContent.trim().slice(0, 24)} → ${c}`);
    });
    return out;
  });
  expect(coloured, `impresso a cor sem ser o saldo devido: ${coloured.join("; ")}`).toEqual([]);
});
