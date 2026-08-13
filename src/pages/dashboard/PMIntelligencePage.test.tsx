/**
 * O ecrã inteiro, com os dados que a fábrica tem hoje.
 *
 * A aritmética está testada à parte, em src/lib/pmIntelligence.test.ts. O que tem de
 * valer aqui é o que se lê: que a mesma constante deixou de aparecer em todas as
 * linhas, que quem não pode alterar planos não vê o botão que os altera, e que o
 * período que o cabeçalho diz é o período de que os números saíram.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { WorkOrder } from "@/hooks/useWorkOrders";

const roleCan = vi.fn((_action: string) => true);

vi.mock("@/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useRole", () => ({ useRole: () => ({ can: (a: string) => roleCan(a) }) }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1" }, profile: { name: "Planner" }, role: "planner", loading: false }),
}));

const workOrders = vi.fn();
const schedules = vi.fn();
vi.mock("@/hooks/useWorkOrders", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useWorkOrders: () => workOrders(),
  useCreateWorkOrder: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/usePreventiveMaintenance", () => ({
  usePmSchedules: () => schedules(),
  useUpdatePmSchedule: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreatePmSchedule: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

/** O registo de activos como está na base: as duas tabelas cruzam-se. */
vi.mock("@/hooks/useMachines", () => ({
  useLines: () => ({
    data: [
      { id: "l4", name: "Line 4" },
      { id: "l5", name: "Line 5" },
      { id: "lc1", name: "Capsules Machine 1" },
    ],
    isLoading: false,
  }),
  useMachines: () => ({
    data: [
      { name: "Line 4", line_id: "l4" },
      { name: "Line 5A", line_id: "l5" },
      { name: "Line 5B", line_id: "l5" },
      { name: "Capsules Machine 1", line_id: "lc1" },
    ],
    isLoading: false,
  }),
}));

import PMIntelligencePage from "@/pages/dashboard/PMIntelligencePage";

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

/** Line 4 falha 73 vezes em 90 dias; Capsules Machine 1, quatro. */
const FLEET: Partial<WorkOrder>[] = [
  ...Array.from({ length: 73 }, (_, i) => ({
    machine: "Line 4", created_at: daysAgo(1 + (i % 88)), description: "Conveyor jam",
  })),
  ...Array.from({ length: 4 }, (_, i) => ({
    machine: "Capsules Machine 1", created_at: daysAgo(5 + i * 20), description: "Feeder blocked",
  })),
  { machine: "Line 5", created_at: daysAgo(10), description: "Sensor fault" },
  { machine: "Line 5", created_at: daysAgo(50), description: "Sensor fault" },
  { machine: "Printer 9 @ Line 2", created_at: daysAgo(12), description: "Ribbon" },
  { machine: "", created_at: daysAgo(3), description: "No asset named" },
  { machine: "Line 4", created_at: daysAgo(6), description: "Planned", wo_type: "preventive" },
];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <PMIntelligencePage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  roleCan.mockReturnValue(true);
  workOrders.mockReturnValue({ data: FLEET, isLoading: false });
  schedules.mockReturnValue({ data: [], isLoading: false });
});

/**
 * O nome de um activo aparece duas vezes na página — na tabela e no cartão de
 * trabalho recorrente, que é onde os crónicos vão parar. Estes testes são sobre a
 * tabela, por isso procuram lá dentro.
 */
async function assetRow(name: string): Promise<HTMLElement> {
  const table = await screen.findByRole("table");
  const cell = await within(table).findByRole("cell", { name: new RegExp(`^${name}`) });
  return cell.closest("tr")!;
}

describe("PM Intelligence", () => {
  /**
   * A regressão que motivou tudo isto: 0,7 × MTBF medido sobre o vão entre a primeira
   * e a última falha caía abaixo do piso em quase todas as chaves, e o clamp levantava
   * cada uma delas para 7 — a coluna inteira imprimia a mesma constante com ar de
   * cálculo. Agora Capsules Machine 1 tem um intervalo próprio, e a Line 4, que avaria
   * de trinta em trinta horas, não recebe intervalo nenhum.
   */
  it("gives an asset its own interval instead of the clamp floor", async () => {
    renderPage();
    const row = await assetRow("Capsules Machine 1");
    expect(within(row).getByText("16d")).toBeInTheDocument();
    expect(within(row).queryByText("7d")).not.toBeInTheDocument();
  });

  it("refuses an interval for an asset that fails faster than any PM cycle", async () => {
    renderPage();
    const row = await assetRow("Line 4");
    expect(within(row).getByText("none holds")).toBeInTheDocument();
    expect(screen.getByText("Fails faster than any PM cycle")).toBeInTheDocument();
  });

  /**
   * `Capsules Machine 1` está na tabela `lines` e é uma máquina; `Line 5` tem duas
   * máquinas por baixo e é uma linha. A versão anterior perguntava só "está em
   * `lines`?" e errava nas duas.
   */
  it("tells a line apart from a machine that happens to be registered as one", async () => {
    renderPage();
    expect(within(await assetRow("Line 5")).getByText("not per line")).toBeInTheDocument();
    expect(within(await assetRow("Capsules Machine 1")).queryByText("not per line")).toBeNull();
  });

  it("marks an asset that is in neither register", async () => {
    renderPage();
    const row = await assetRow("Printer 9 @ Line 2");
    expect(within(row).getByText("unregistered")).toBeInTheDocument();
  });

  /**
   * A rota admite supervisor, planner e engineer, que têm `pm.view` e não `pm.manage`.
   * A página oferecia-lhes na mesma o botão que escreve em `pm_schedules`.
   */
  it("offers no way to change a schedule without pm.manage", async () => {
    roleCan.mockImplementation((action: string) => action !== "pm.manage");
    renderPage();
    await assetRow("Capsules Machine 1");
    expect(screen.queryByRole("button", { name: /create plan/i })).toBeNull();
    expect(screen.getAllByText("view only").length).toBeGreaterThan(0);
  });

  it("offers to create the plan it just measured", async () => {
    renderPage();
    const row = await assetRow("Capsules Machine 1");
    expect(within(row).getByRole("button", { name: /create plan/i })).toBeInTheDocument();
  });

  /** Metade das ordens não nomeia activo. Saltá-las é correcto; escondê-lo não é. */
  it("says how much of the record it could actually read", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/name no asset/i)).toBeInTheDocument());
    expect(screen.getByText(/preventive or warehouse orders are/i)).toBeInTheDocument();
  });

  /**
   * O bloco de falha única abre fechado — onze linhas dessas enterram as sete que
   * pedem resposta. Fechado no ecrã e não no papel: o rodapé impresso conta os activos
   * todos, e uma folha que esconde linhas mente sobre o seu próprio total.
   */
  it("folds the single-failure deck away on screen but keeps it on paper", async () => {
    renderPage();
    const row = await assetRow("Printer 9 @ Line 2");
    expect(row.className).toContain("hidden");
    expect(row.className).toContain("print:table-row");

    const deck = screen.getByRole("button", { name: /Too few failures to measure/ });
    expect(deck).toHaveAttribute("aria-expanded", "false");
  });

  it("offers the period as a control rather than a hardcoded ninety days", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByLabelText("Period")).toBeInTheDocument());
    expect(screen.getByText("Last 90 days")).toBeInTheDocument();
  });
});
