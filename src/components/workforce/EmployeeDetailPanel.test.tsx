/**
 * O painel do empregado, montado — e o que ele diz quando nao tem nada para mostrar.
 *
 * Reportado por quem usa o ecra, a 03/10/2026: *"no employee nao tem opcao de editar,
 * quando seleciona employee details nao mostra history overtime"*. Nada disto era um
 * defeito de logica, e por isso nenhuma auditoria o tinha apanhado — era o ecra calado
 * nos tres sitios onde tinha de falar.
 *
 * - Sem permissao, cada campo fica `disabled`, o botao Save desaparece e o bloco de
 *   saida tambem. Nada dizia porque. Um formulario inteiro apagado sem explicacao
 *   le-se como ecra partido.
 * - O separador Overtime dizia "No overtime recorded for this person", o que atira a
 *   culpa para o registo dele. `overtime_entries` tem **0 linhas em 29 periodos**:
 *   nunca foi importado overtime nenhum, para ninguem.
 * - O separador History esta vazio para 194 dos 211 activos, porque so 17 pessoas tem
 *   movimentos. Esse texto ja era honesto e fica como estava.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const EMPLOYEE = {
  id: "e1", full_name: "Ana Silva", department: "Production", position: null,
  active: true, shift_group: "Day", shift_pattern_id: null, manager_id: null,
  headcount_area_id: null, employee_ref: null, started_on: null, left_on: null,
  notes: null, sheet_aliases: null, user_id: null,
};

let overtimeAlgumaVez = false;

vi.mock("@/hooks/useWorkforce", () => ({
  useEmployees: () => ({ data: [EMPLOYEE] }),
  useShiftPatterns: () => ({ data: [] }),
  useHeadcountAreas: () => ({ data: [] }),
  useMovements: () => ({ data: [], isLoading: false }),
  useEmployeeOvertime: () => ({ data: [], isLoading: false }),
  useOvertimeEverImported: () => ({ data: overtimeAlgumaVez }),
  useUpdateEmployee: () => ({ mutate: vi.fn(), isPending: false }),
  describeDays: () => "",
  describeSchedule: () => "",
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { EmployeeDetailPanel } from "@/components/workforce/EmployeeDetailPanel";

function mount(canEdit: boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <EmployeeDetailPanel employee={EMPLOYEE as never} open onOpenChange={() => {}} canEdit={canEdit} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  // O Radix precisa destes tres; o jsdom nao tem nenhum. Sem eles o separador nao
  // troca e o teste falha por motivo nenhum.
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
});
afterEach(() => { cleanup(); overtimeAlgumaVez = false; });

/**
 * O Radix em `activationMode="automatic"` — o padrao — troca de separador no FOCO,
 * nao no clique. Um `fireEvent.click` sozinho nao muda nada e o teste falha a dizer
 * que o texto nao existe, quando o que nao aconteceu foi a troca.
 */
async function abrirSeparador(nome: string) {
  const t = await screen.findByRole("tab", { name: nome });
  fireEvent.focus(t);
  fireEvent.mouseDown(t);
  fireEvent.click(t);
}

describe("sem permissao, o painel diz que e so de leitura", () => {
  it("explica em vez de apagar o formulario em silencio", async () => {
    mount(false);
    expect(await screen.findByText(/Read-only view/i)).toBeTruthy();
    // E a razao, nao so o estado.
    expect(screen.getByText(/permission to change employee records/i)).toBeTruthy();
  });

  it("nao mostra a frase a quem pode editar", async () => {
    mount(true);
    await screen.findByText("Details");
    expect(screen.queryByText(/Read-only view/i)).toBeNull();
  });
});

describe("o separador Overtime nao culpa a pessoa por uma tabela vazia", () => {
  it("diz que nunca foi importado nada, para ninguem", async () => {
    overtimeAlgumaVez = false;
    mount(true);
    await abrirSeparador("Overtime");
    await waitFor(() => expect(screen.getByText(/ever been imported, for anybody/i)).toBeTruthy());
    // A frase antiga dava a entender que os outros tinham.
    expect(screen.queryByText(/No overtime recorded for this person/i)).toBeNull();
  });

  it("volta a ser sobre a pessoa assim que exista importacao de alguem", async () => {
    overtimeAlgumaVez = true;
    mount(true);
    await abrirSeparador("Overtime");
    await waitFor(() => expect(screen.getByText(/No overtime recorded for this person/i)).toBeTruthy());
  });
});
