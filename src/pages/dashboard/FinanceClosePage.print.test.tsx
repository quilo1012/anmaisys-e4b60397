/**
 * O que sai da impressora do Finance Close.
 *
 * O ecrã imprimia-se com `window.print()` sem nunca ter entrado na folha de impressão
 * da app: sem `print-content` a tabela de dezoito colunas mantinha a largura do ecrã
 * (1506px) numa folha A4 retrato de 794px — Present, Sick, Holiday, Unpaid e Part day
 * saíam **fora do papel**, sem aviso — e sem `print-keep` na banda do título a folha
 * saía sem nome, sem período e sem datas. Uma folha de pagamento que ninguém pode
 * arquivar nem conferir.
 *
 * Com `FC_BODY_OUT` no ambiente grava também o `container.innerHTML`, que é o corpo
 * que o harness do Playwright imprime — ver `pmsystem-ver-folhas-de-impressao-localmente`.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import fs from "node:fs";

// ─── dados, na forma real da fábrica ───────────────────────────────────────────

const PERIOD = { id: "p-aug", name: "August 2026", start_date: "2026-08-10", end_date: "2026-09-06" };
const PERIODS = [
  { id: "p-sep", name: "September 2026", start_date: "2026-09-07", end_date: "2026-10-11" },
  PERIOD,
  { id: "p-jul", name: "July 2026", start_date: "2026-07-13", end_date: "2026-08-09" },
];

const CREWS: [string | null, string, number][] = [
  ["Production", "Day", 60], ["Production", "Night", 40], ["Production", "Weekend", 30],
  ["Warehouse", "Warehouse Day", 15], ["Hygiene", "Day", 9], [null, "Night", 8],
  ["Hygiene", "Weekend", 4], ["Warehouse", "Night", 4], ["Office", "Day", 4],
  ["Quality", "Night", 4], ["Quality", "Day", 3], ["Lab", "Day", 3],
  ["Office", "Weekend", 3], ["Lab", "Night", 3], ["Warehouse", "Warehouse Weekend", 3],
  ["Lab", "Weekend", 2], ["Office", "Night", 2], ["Maintenance", "Day", 1],
  ["Hygiene", "Night", 1], ["Maintenance", "Night", 1], ["Warehouse", "Day", 1],
];

const FIRST = ["Ana", "João", "Miguel", "Catarina", "Ricardo", "Sofia", "Bruno", "Inês",
  "Tiago", "Marta", "Pedro", "Beatriz", "André", "Carolina", "Nuno", "Rita", "Filipe",
  "Daniela", "Hugo", "Mariana", "Elias", "Fabio", "Felipe", "Patrícia"];
const LAST = ["Silva", "Santos", "Ferreira", "Pereira", "Oliveira", "Costa", "Rodrigues",
  "Martins", "Jesus", "Sousa", "Fernandes", "Gonçalves", "Gomes", "Lopes", "Marques",
  "Alves", "Almeida", "Ribeiro", "Pinto", "Carvalho", "Soares", "Pinelli", "Quilo"];

/** PRNG determinista, para a folha sair sempre igual. */
let seed = 42;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];

const PATTERNS = [
  { id: "pat-day", name: "Mon–Thu Day", days: [1, 2, 3, 4], starts_at: "06:00", ends_at: "16:30", break_minutes: 30 },
  { id: "pat-night", name: "Mon–Thu Night", days: [1, 2, 3, 4], starts_at: "18:00", ends_at: "04:30", break_minutes: 30 },
  { id: "pat-wknd", name: "Fri–Mon", days: [5, 6, 0, 1], starts_at: "06:00", ends_at: "16:30", break_minutes: 30 },
];

interface Emp {
  id: string; full_name: string; department: string | null; shift_group: string;
  active: boolean; shift_pattern_id: string;
  shift_patterns: { name: string; days: number[] };
}
const EMPLOYEES: Emp[] = [];
for (const [dept, crew, n] of CREWS) {
  for (let i = 0; i < n; i++) {
    const pat = crew === "Night" ? "pat-night" : crew.includes("Weekend") ? "pat-wknd" : "pat-day";
    EMPLOYEES.push({
      id: `e${EMPLOYEES.length}`,
      full_name: `${pick(FIRST)} ${pick(LAST)}${rnd() > 0.7 ? " " + pick(LAST) : ""}`,
      department: dept, shift_group: crew, active: true,
      shift_pattern_id: pat,
      shift_patterns: { name: PATTERNS.find((p) => p.id === pat)!.name, days: PATTERNS.find((p) => p.id === pat)!.days },
    });
  }
}

/** Os dias do período, e os do mês anterior para o banco de horas de abertura. */
const days = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = new Date(from + "T00:00:00Z"); d <= new Date(to + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
};
const PERIOD_DAYS = days(PERIOD.start_date, PERIOD.end_date);

interface Alloc {
  employee_id: string; on_date: string; shift: string; status: string;
  left_early_at: string | null; arrived_late_at: string | null;
}
interface Clock {
  employee_id: string; on_date: string; worked_minutes: number;
  balance_minutes: number; absence_name: string | null;
}
const board: Alloc[] = [];
const clocked: Clock[] = [];
const opening: { employee_id: string; balance_minutes: number }[] = [];
const marks: { employee_id: string; on_date: string; status: string }[] = [];
const overtime: { employee_id: string; hours: number }[] = [];

for (const e of EMPLOYEES) {
  const pat = PATTERNS.find((p) => p.id === e.shift_pattern_id)!;
  const boardShift = e.shift_group === "Night" ? "Night" : "Day";
  opening.push({ employee_id: e.id, balance_minutes: Math.round((rnd() - 0.45) * 900) });
  if (rnd() > 0.9) overtime.push({ employee_id: e.id, hours: +(rnd() * 14).toFixed(2) });
  for (const on_date of PERIOD_DAYS) {
    const dow = new Date(on_date + "T00:00:00Z").getUTCDay();
    if (!pat.days.includes(dow)) continue;
    if (rnd() > 0.93) {
      marks.push({ employee_id: e.id, on_date, status: pick(["sick", "holiday", "unpaid"]) });
      continue;
    }
    const late = rnd() > 0.95 ? "08:15" : null;
    const early = rnd() > 0.95 ? "13:40" : null;
    board.push({
      employee_id: e.id, on_date, shift: boardShift,
      status: rnd() > 0.96 ? "overtime" : "assigned",
      left_early_at: early, arrived_late_at: late,
    });
    clocked.push({
      employee_id: e.id, on_date,
      worked_minutes: 570 + Math.round((rnd() - 0.5) * 120),
      balance_minutes: Math.round((rnd() - 0.4) * 90),
      absence_name: null,
    });
  }
}

// ─── mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/AdminPinGate", () => ({
  AdminPinGate: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/BackButton", () => ({ BackButton: () => null }));
vi.mock("@/components/workforce/WorkforceTabs", () => ({ WorkforceTabs: () => null }));
vi.mock("@/components/workforce/OvertimePanel", () => ({ OvertimePanel: () => <div>OT panel</div> }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useWorkforce", () => ({
  useEmployees: () => ({ data: EMPLOYEES }),
  useOvertimeEntries: () => ({ data: overtime }),
}));

vi.mock("@/lib/fetchAllRows", () => ({
  fetchAllRows: async <T,>(q: { range: (a: number, b: number) => PromiseLike<{ data: T[] | null }> }) => {
    const { data } = await q.range(0, 999);
    return data ?? [];
  },
}));

vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    const state = { table, lt: false };
    const rows = () => {
      switch (state.table) {
        case "workforce_payroll_periods": return PERIODS;
        case "employees": return EMPLOYEES;
        case "shift_patterns": return PATTERNS;
        case "overtime_entries": return overtime;
        case "attendance_days": return state.lt ? opening : clocked;
        case "employee_attendance": return marks;
        case "daily_allocations": return board;
        default: return [];
      }
    };
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      gte: () => chain,
      lte: () => chain,
      lt: () => { state.lt = true; return chain; },
      order: () => chain,
      range: async () => ({ data: rows(), error: null }),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve({ data: rows(), error: null }).then(res, rej),
    };
    return chain;
  };
  return { supabase: { from } };
});

import FinanceClosePage from "@/pages/dashboard/FinanceClosePage";
import { CLOSE_COLUMNS } from "@/lib/financeCloseColumns";

async function renderClose() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><FinanceClosePage /></MemoryRouter>
    </QueryClientProvider>,
  );
  // Sem timers reais: bombear a fila até as filas todas estarem montadas.
  for (let i = 0; i < 60 && !container.querySelector("tbody tr:nth-child(20)"); i++) {
    await vi.advanceTimersByTimeAsync(50);
  }
  if (process.env.FC_BODY_OUT) fs.writeFileSync(process.env.FC_BODY_OUT, container.innerHTML);
  return container;
}

describe("a folha de papel do Finance Close", () => {
  beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-08-25T09:00:00Z")); });
  afterAll(() => { vi.useRealTimers(); });

  it("entra na folha de impressão da app, e deitada", async () => {
    const container = await renderClose();
    // Sem `print-content` nada em `@media print` toca nesta tabela: ela sai com a
    // largura do ecrã e o papel corta-lhe o terço da direita.
    const sheet = container.querySelector(".print-content");
    expect(sheet).not.toBeNull();
    // Dezoito colunas não cabem em retrato — a soma das larguras do PDF é 264mm.
    expect(sheet!.className).toContain("print-landscape");
  });

  it("leva o título, o período e as datas para o papel", async () => {
    const container = await renderClose();
    // Todo o `<header>` é escondido na impressão; este carrega o nome do documento.
    const band = container.querySelector("header.print-keep");
    expect(band).not.toBeNull();
    expect(band!.textContent).toContain("Finance Close");
    expect(band!.textContent).toContain("10/08/2026 → 06/09/2026");
  });

  it("repete o período em cada página, e afasta as filas do bordo", async () => {
    const container = await renderClose();
    // O `<thead>` é o único grupo que o browser repete: é a única linha que pode
    // dizer à página sete de onze de que fecho é que estas horas são.
    const caption = container.querySelector("th.print-caption");
    expect(caption).not.toBeNull();
    expect(caption!.textContent).toContain("August 2026");
    expect(caption!.textContent).toContain("10/08/2026 → 06/09/2026");
    // Uma banda a menos e as colunas da direita ficam sem cabeçalho nenhum.
    expect(caption!.getAttribute("colspan")).toBe(String(CLOSE_COLUMNS.length));

    const foot = container.querySelector("tfoot.print-edge td");
    expect(foot).not.toBeNull();
    expect(foot!.getAttribute("colspan")).toBe(String(CLOSE_COLUMNS.length));
    // O rodapé assina a folha: treze folhas soltas numa secretária não têm outra
    // maneira de dizer de que documento vieram.
    expect(foot!.textContent).toContain("Finance Close");
    expect(foot!.textContent).toContain("August 2026");
  });

  it("dá às colunas as larguras que o PDF já tinha", async () => {
    const container = await renderClose();
    // Sem isto o navegador reparte as dezoito por igual: o nome ficava com 17,7mm
    // dos 34 que lhe cabiam e partia-se em três linhas, enquanto o Δ sobrava.
    const cols = container.querySelectorAll("table.close-register col[data-mm]");
    expect(cols.length).toBe(CLOSE_COLUMNS.length);
    expect((cols[0] as HTMLElement).style.getPropertyValue("--mm"))
      .toBe(String(CLOSE_COLUMNS[0].mm));
  });

  it("troca as oito caixas por um resumo com o total da fábrica", async () => {
    const container = await renderClose();
    const summary = container.querySelector("table.close-summary");
    expect(summary).not.toBeNull();
    // Em papel as caixas ocupavam 55mm e empurravam o registo para a folha dois.
    const total = summary!.querySelector("tr.close-total");
    expect(total).not.toBeNull();
    expect(total!.textContent).toContain("Whole factory");
    expect(total!.textContent).toContain("201");
  });

  it("põe as notas no fim e tira o aviso de ecrã do papel", async () => {
    const container = await renderClose();
    const notes = container.querySelector(".close-notes");
    expect(notes).not.toBeNull();
    expect(notes!.textContent).toContain("Each period settles on its own");
    // A mesma nota no ecrã fica acima da tabela — e fora do papel, ou sairia duas
    // vezes.
    const screenNote = container.querySelector("p.border-warning\\/30");
    expect(screenNote?.className).toContain("print:hidden");
    // Assinada, porque a folha muda de mãos antes de alguém ser pago.
    expect(container.querySelector(".close-signoff")?.textContent).toContain("Checked by");
  });
});
