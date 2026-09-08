/**
 * O diálogo que cria um plano de preventiva.
 *
 * A coluna `pm_schedules.machine` é texto livre — a base nunca exigiu que o nome
 * existisse na tabela `machines`, e o PM Intelligence já escreve lá nomes que não
 * existem (marca-os com "Not in the machine or line register"). Quem impunha o
 * registo era só este ecrã, com um Select fechado alimentado pelo `useMachines`.
 *
 * O que isso custava na fábrica: um compressor, um empilhador, uma máquina que não
 * pertence a nenhuma linha e por isso ninguém registou — nenhum deles podia receber
 * um plano de preventiva, porque o nome não estava na lista para se escolher.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/hooks/useRole", () => ({ useRole: () => ({ can: () => true }) }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1" }, profile: { name: "Planner" }, role: "admin", loading: false }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

/** O registo de máquinas como está na base: só o que pertence a uma linha. */
vi.mock("@/hooks/useMachines", () => ({
  useMachines: () => ({
    data: [
      { id: "m1", name: "Line 4" },
      { id: "m2", name: "Line 5A" },
    ],
    isLoading: false,
  }),
}));

const createMutate = vi.fn().mockResolvedValue({ id: "s1" });
vi.mock("@/hooks/usePreventiveMaintenance", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  usePmSchedules: () => ({ data: [], isLoading: false }),
  usePmTasks: () => ({ data: [], isLoading: false }),
  usePmExecutions: () => ({ data: [], isLoading: false }),
  useCreatePmSchedule: () => ({ mutateAsync: createMutate, isPending: false }),
  useUpdatePmSchedule: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeletePmSchedule: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAddPmTask: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeletePmTask: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRecordPmExecution: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import PreventiveMaintenancePage from "@/pages/dashboard/PreventiveMaintenancePage";

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <PreventiveMaintenancePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

/** Abre o diálogo e devolve o campo da máquina. */
const abrirDialogo = async () => {
  fireEvent.click(screen.getByRole("button", { name: /new schedule/i }));
  return await screen.findByPlaceholderText(/type a machine/i);
};

const escrever = (campo: HTMLElement, texto: string) =>
  fireEvent.change(campo, { target: { value: texto } });

const criar = () => fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

describe("New PM Schedule — o campo da máquina", () => {
  beforeEach(() => createMutate.mockClear());

  it("aceita uma máquina que não está no registo", async () => {
    renderPage();

    escrever(await abrirDialogo(), "Compressor Sala 3");
    escrever(screen.getByPlaceholderText(/quarterly inspection/i), "Filter change");
    criar();

    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    expect(createMutate.mock.calls[0][0]).toMatchObject({
      machine: "Compressor Sala 3",
      title: "Filter change",
    });
  });

  it("continua a sugerir as máquinas do registo, e a sugestão escolhida é a que fica", async () => {
    renderPage();

    escrever(await abrirDialogo(), "Line 5");
    fireEvent.click(await screen.findByText("Line 5A"));
    escrever(screen.getByPlaceholderText(/quarterly inspection/i), "Belt check");
    criar();

    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    expect(createMutate.mock.calls[0][0]).toMatchObject({ machine: "Line 5A" });
  });

  /**
   * O Select que aqui estava mostrava a lista toda a quem lhe clicasse. Um combobox
   * que so sugere depois da primeira letra dava a escrita e tirava a consulta — quem
   * nao sabe de cor como a maquina esta escrita no registo ficava sem a poder ver.
   * Com `showAllOnFocus`, o foco que o proprio dialogo poe no campo ja abre o registo
   * inteiro, e escrever passa a filtra-lo.
   */
  it("mostra o registo inteiro assim que o diálogo abre", async () => {
    renderPage();
    await abrirDialogo();

    expect(await screen.findByText("Line 4")).toBeInTheDocument();
    expect(screen.getByText("Line 5A")).toBeInTheDocument();
  });

  it("não cria um plano com um nome só de espaços", async () => {
    renderPage();

    escrever(await abrirDialogo(), "   ");
    escrever(screen.getByPlaceholderText(/quarterly inspection/i), "Filter change");
    criar();

    await waitFor(() => expect(createMutate).not.toHaveBeenCalled());
  });
});
