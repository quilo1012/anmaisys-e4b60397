/**
 * Procurar uma pessoa, escolher as linhas e escolher as colunas do papel — no ecrã
 * montado, com as filas reais a passar pelo `buildClose`.
 *
 * A regra que estes testes seguram: o ecrã e o papel são duas tabelas. As definições
 * de impressão mudam o papel e nunca o ecrã; a pesquisa e as linhas mudam os dois,
 * e os totais do papel continuam a ser os das filas impressas.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen, within, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const PERIOD = { id: "p-aug", name: "August 2026", start_date: "2026-08-10", end_date: "2026-09-06" };

const DAY = { name: "Mon–Thu Day", days: [1, 2, 3, 4] };
const emp = (id: string, full_name: string, employee_ref: string | null, headcount_area_id: string | null,
  department = "Production") => ({
  id, full_name, employee_ref, headcount_area_id, department, shift_group: "Day", active: true,
  shift_pattern_id: "pat-day", shift_patterns: DAY,
});
/** Duas Ana Silva, de propósito: o nome não as separa, o id e o crachá sim. */
const EMPLOYEES = [
  emp("a1", "Ana Silva", "1001", "l1"),
  emp("a2", "Ana Silva", "1002", "l1"),
  emp("j1", "João Gonçalves", "2040", "l3"),
  emp("h1", "Rita Pinto", "3001", "hy", "Hygiene"),
  emp("n1", "Nuno Lopes", null, null),
];
const AREAS = [
  { id: "l1", name: "Line 1", active: true, sort_order: 1 },
  { id: "l2", name: "Line 2", active: true, sort_order: 2 },
  { id: "l3", name: "Line 3", active: true, sort_order: 3 },
  { id: "hy", name: "Hygiene", active: true, sort_order: 10 },
];
/** Horas diferentes para as duas Anas, para se ver que não se misturam. */
const CLOCKED = [
  { employee_id: "a1", on_date: "2026-08-11", worked_minutes: 600, balance_minutes: 120, absence_name: null },
  { employee_id: "a2", on_date: "2026-08-11", worked_minutes: 600, balance_minutes: 300, absence_name: null },
  { employee_id: "j1", on_date: "2026-08-11", worked_minutes: 600, balance_minutes: 60, absence_name: null },
];

vi.mock("@/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/BackButton", () => ({ BackButton: () => null }));
vi.mock("@/components/workforce/WorkforceTabs", () => ({ WorkforceTabs: () => null }));
vi.mock("@/components/workforce/OvertimePanel", () => ({ OvertimePanel: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useWorkforce", () => ({
  useEmployees: () => ({ data: EMPLOYEES }),
  useOvertimeEntries: () => ({ data: [] }),
}));
vi.mock("@/lib/fetchAllRows", () => ({
  fetchAllRows: async <T,>(q: { range: (a: number, b: number) => PromiseLike<{ data: T[] | null }> }) => {
    const { data } = await q.range(0, 999);
    return data ?? [];
  },
}));
vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    const state = { lt: false };
    const rows = () => {
      switch (table) {
        case "workforce_payroll_periods": return [PERIOD];
        case "employees": return EMPLOYEES;
        case "headcount_areas": return AREAS;
        case "attendance_days": return state.lt ? [] : CLOCKED;
        default: return [];
      }
    };
    const chain: Record<string, unknown> = {
      select: () => chain, eq: () => chain, gte: () => chain, lte: () => chain, order: () => chain,
      lt: () => { state.lt = true; return chain; },
      range: async () => ({ data: rows(), error: null }),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve({ data: rows(), error: null }).then(res, rej),
    };
    return chain;
  };
  return { supabase: { from } };
});

import FinanceClosePage from "@/pages/dashboard/FinanceClosePage";
import { CLOSE_COLUMNS, DEFAULT_PRINT_KEYS } from "@/lib/financeCloseColumns";

async function renderClose() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><FinanceClosePage /></MemoryRouter>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(utils.container.querySelectorAll("table.close-screen tbody tr")).toHaveLength(5));
  // As linhas chegam numa query à parte; esperar que o nome da linha apareça.
  await waitFor(() => expect(utils.container.querySelector("table.close-screen")!.textContent).toContain("Line 1"));
  return utils.container;
}

const screenRows = (c: HTMLElement) => [...c.querySelectorAll("table.close-screen tbody tr")];
const printIds = (c: HTMLElement) =>
  [...c.querySelectorAll("table.close-register tbody tr")].map((tr) => tr.getAttribute("data-employee-id"));
const printHeaders = (c: HTMLElement) =>
  [...c.querySelectorAll("table.close-register thead tr:last-child th")].map((th) => th.textContent);
const search = (q: string) =>
  fireEvent.change(screen.getByRole("searchbox", { name: "Search by employee" }), { target: { value: q } });

beforeEach(() => { window.localStorage.clear(); });

describe("procurar no Finance Close", () => {
  it("encontra pelo nome e mantém as duas Ana Silva separadas, cada uma com as suas horas", async () => {
    const c = await renderClose();
    search("ana silva");
    expect(screenRows(c)).toHaveLength(2);
    expect(printIds(c).sort()).toEqual(["a1", "a2"]);
    // 2 h e 5 h: se as filas se juntassem, sairia uma com 7.
    const ot = [...c.querySelectorAll("table.close-register tbody tr")].map((tr) => tr.textContent);
    expect(ot.join("|")).toContain("1001");
    expect(ot.join("|")).toContain("1002");
    expect(c.textContent).toContain("Showing 2 of 5");
  });

  it("encontra pelo número do crachá", async () => {
    const c = await renderClose();
    search("1002");
    expect(printIds(c)).toEqual(["a2"]);
  });

  it("diz quando ninguém corresponde, e limpar devolve a lista inteira", async () => {
    const c = await renderClose();
    search("zé ninguém");
    expect(screenRows(c)).toHaveLength(0);
    expect(c.textContent).toContain("No employee matches");
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(screenRows(c)).toHaveLength(5);
  });

  it("leva a pesquisa ao papel: o total impresso é o das filas impressas", async () => {
    const c = await renderClose();
    search("ana");
    const total = c.querySelector("table.close-summary tr.close-total")!;
    expect(total.textContent).toContain("matching “ana”");
    // Duas pessoas, 2 h + 5 h de overtime.
    expect(total.children[1].textContent).toBe("2");
    expect(total.children[4].textContent).toBe("7.00");
    expect(c.querySelector("th.print-caption")!.textContent).toContain("matching “ana”");
  });
});

describe("as linhas", () => {
  it("oferece todas as linhas do quadro, as vazias com zero, e filtra pela escolhida", async () => {
    const c = await renderClose();
    fireEvent.click(screen.getByRole("button", { name: "Lines" }));
    const list = await screen.findByRole("dialog");
    expect(list.textContent).toContain("Line 2");
    expect(list.textContent).toContain("No line recorded");
    fireEvent.click(within(list).getByText("Line 1").closest("label")!.querySelector("button")!);
    expect(printIds(c).sort()).toEqual(["a1", "a2"]);
    // A linha vazia: dito, não omitido.
    fireEvent.click(within(list).getByText("Line 1").closest("label")!.querySelector("button")!);
    fireEvent.click(within(list).getByText("Line 2").closest("label")!.querySelector("button")!);
    expect(screenRows(c)).toHaveLength(0);
    expect(c.textContent).toContain("Nobody in this close is placed on");
  });

  it("mostra a linha de cada pessoa no ecrã e no papel", async () => {
    const c = await renderClose();
    const j = c.querySelector('table.close-register tr[data-employee-id="j1"]')!;
    expect(j.textContent).toContain("Line 3");
    expect(printHeaders(c)).toContain("Line");
  });
});

describe("as definições de impressão", () => {
  const open = () => fireEvent.click(screen.getByRole("button", { name: /Print settings/ }));

  it("imprime as colunas por defeito antes de alguém escolher", async () => {
    const c = await renderClose();
    expect(printHeaders(c)).toEqual(CLOSE_COLUMNS.filter((x) => DEFAULT_PRINT_KEYS.includes(x.key)).map((x) => x.header));
  });

  it("Clear all deixa só o nome no papel, e o ecrã fica com as colunas todas", async () => {
    const c = await renderClose();
    const screenHeadersBefore = c.querySelectorAll("table.close-screen thead tr:last-child th").length;
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Clear all" }));
    expect(printHeaders(c)).toEqual(["Employee"]);
    expect(c.querySelectorAll("table.close-screen thead tr:last-child th").length).toBe(screenHeadersBefore);
    expect(screenHeadersBefore).toBe(CLOSE_COLUMNS.length);
    // A folha fica de pé: uma coluna não precisa de uma A4 deitada.
    expect(c.querySelector(".close-sheet")!.className).toContain("close-portrait");
  });

  it("uma coluna desmarcada sai do papel, e Select all põe-nas todas", async () => {
    const c = await renderClose();
    open();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Print Sick" }));
    expect(printHeaders(c)).not.toContain("Sick");
    // A pré-visualização é a mesma tabela, e diz o mesmo.
    const preview = document.querySelector("table.close-preview-table")!;
    expect([...preview.querySelectorAll("thead tr:last-child th")].map((th) => th.textContent)).toEqual(printHeaders(c));
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    expect(printHeaders(c)).toEqual(CLOSE_COLUMNS.map((x) => x.header));
    expect(c.querySelector(".close-sheet")!.className).not.toContain("close-portrait");
  });

  it("lembra a escolha neste navegador", async () => {
    const c = await renderClose();
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Clear all" }));
    expect(JSON.parse(window.localStorage.getItem("finance-close.print-columns.v1")!)).toEqual(["name"]);
    expect(printHeaders(c)).toEqual(["Employee"]);
  });
});
