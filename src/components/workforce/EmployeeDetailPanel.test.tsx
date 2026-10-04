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
const guardar = vi.fn();

vi.mock("@/hooks/useWorkforce", () => ({
  useEmployees: () => ({ data: [EMPLOYEE] }),
  useShiftPatterns: () => ({ data: [] }),
  useHeadcountAreas: () => ({ data: [] }),
  useMovements: () => ({ data: [], isLoading: false }),
  useEmployeeOvertime: () => ({ data: [], isLoading: false }),
  useOvertimeEverImported: () => ({ data: overtimeAlgumaVez }),
  useUpdateEmployee: () => ({ mutate: guardar, isPending: false }),
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
afterEach(() => { cleanup(); overtimeAlgumaVez = false; guardar.mockClear(); });

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

/**
 * O nome, que ate 04/10/2026 so se podia corrigir na base de dados.
 *
 * Reportado assim: *"nao consigo editar nome dele, as informacoes nao bate com o que
 * esta no sistema"*. O `full_name` era o titulo do painel e mais nada — o dialogo de
 * "Add employee" pedia-o na criacao e nenhum ecra o corrigia depois. Quinze dos 211
 * activos estao em MAIUSCULAS e vinte e tres tem so um nome, todos do import.
 */
describe("o nome e o email corrigem-se aqui", () => {
  it("abre o nome num campo, nao so no titulo", async () => {
    mount(true);
    const campo = (await screen.findByLabelText(/Full name/i)) as HTMLInputElement;
    expect(campo.value).toBe("Ana Silva");
    expect(campo.disabled).toBe(false);
  });

  it("manda o nome e o email no mesmo save", async () => {
    mount(true);
    fireEvent.change(await screen.findByLabelText(/Full name/i), { target: { value: "Ana Silva Souza" } });
    fireEvent.change(screen.getByLabelText(/^Email$/i), { target: { value: "ana@appliednutrition.uk" } });
    fireEvent.click(screen.getByRole("button", { name: /Save/i }));

    expect(guardar).toHaveBeenCalledTimes(1);
    expect(guardar.mock.calls[0][0].patch).toMatchObject({
      full_name: "Ana Silva Souza",
      email: "ana@appliednutrition.uk",
    });
  });

  it("guarda a grafia antiga para a folha de headcount nao perder a pessoa", async () => {
    mount(true);
    fireEvent.change(await screen.findByLabelText(/Full name/i), { target: { value: "Ana Silva Souza" } });
    fireEvent.click(screen.getByRole("button", { name: /Save/i }));
    expect(guardar.mock.calls[0][0].patch.sheet_aliases).toBe("Ana Silva");
  });

  it("nao inventa um alias quando so mudaram as maiusculas", async () => {
    mount(true);
    // O `normalise()` do import ja trata as duas como a mesma pessoa.
    fireEvent.change(await screen.findByLabelText(/Full name/i), { target: { value: "ANA SILVA" } });
    fireEvent.click(screen.getByRole("button", { name: /Save/i }));
    expect(guardar.mock.calls[0][0].patch).not.toHaveProperty("sheet_aliases");
  });

  it("nao deixa gravar um nome vazio", async () => {
    mount(true);
    fireEvent.change(await screen.findByLabelText(/Full name/i), { target: { value: "   " } });
    expect(screen.getByText(/A name is required/i)).toBeTruthy();
    expect((screen.getByRole("button", { name: /Save/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("fecha o campo a quem nao pode editar", async () => {
    mount(false);
    expect(((await screen.findByLabelText(/Full name/i)) as HTMLInputElement).disabled).toBe(true);
  });
});
