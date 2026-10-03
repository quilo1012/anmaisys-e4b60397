/**
 * O separador Board vs clock, montado.
 *
 * O 2B foi entregue com a regra testada em `boardClockStatus.test.ts` e o ecrã nunca
 * montado — e todos os documentos desde 01/10 acabam na mesma linha: ninguém abriu
 * isto num browser. Não se consegue abrir daqui: o sandbox não deixa chegar ao
 * Supabase, e o `/dashboard/attendance` responde com um redireccionamento para
 * `/login`, correctamente. Isto é o mais perto que se chega de forma repetível, e vale
 * mais do que a captura de ecrã que substitui: corre outra vez na próxima alteração.
 *
 * O que fixa é o que distingue este separador de uma tabela qualquer — que o terceiro
 * sentido aparece e não conta, que uma leitura falhada não se lê como acordo, e que a
 * regra está escrita no topo em vez de ficar no documento.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * As três categorias, com o terceiro em maioria — que é a forma da base real:
 * 258 planned_not_clocked, 454 clocked_not_planned e 1365 sem registo nenhum.
 */
const ROWS = [
  { on_date: "2026-09-05", shift: "Day", employee_id: "e1", kind: "planned_not_clocked", board_status: "assigned", worked_minutes: 0 },
  { on_date: "2026-09-05", shift: "Day", employee_id: "e2", kind: "clocked_not_planned", board_status: null, worked_minutes: 720 },
  { on_date: "2026-09-05", shift: "Night", employee_id: "e3", kind: "not_comparable", board_status: "assigned", worked_minutes: null },
  { on_date: "2026-09-04", shift: "Night", employee_id: "e4", kind: "not_comparable", board_status: "overtime", worked_minutes: null },
];

let failRead = false;

vi.mock("@/integrations/supabase/client", () => {
  const chain = () => {
    const c: Record<string, unknown> = {
      select: () => c, gte: () => c, lte: () => c, order: () => c,
      range: (from: number) =>
        Promise.resolve(
          failRead
            ? { data: null, error: { message: "permission denied" } }
            : { data: from === 0 ? ROWS : [], error: null },
        ),
    };
    return c;
  };
  return { supabase: { from: () => chain() } };
});

import { ClockReconciliation } from "@/components/workforce/ClockReconciliation";

const NAMES = new Map([
  ["e1", "Ana Silva"],
  ["e2", "Liana Tora"],
  ["e3", "Jorge Matos"],
  ["e4", "Rui Dias"],
]);

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ClockReconciliation from="2026-09-01" to="2026-09-06" nameById={NAMES} />
    </QueryClientProvider>,
  );
}

beforeEach(() => { failRead = false; });
afterEach(() => cleanup());

describe("o separador Board vs clock, montado", () => {
  it("conta as duas divergências e deixa o terceiro sentido de fora", async () => {
    mount();
    // Os rótulos das figuras existem antes dos dados — enquanto a leitura corre o
    // valor é "—". Esperar por um nome é esperar pelas linhas.
    await screen.findByText("Ana Silva");
    // 1 + 1 comparáveis. Os dois `not_comparable` estão no ecrã e não entram na conta:
    // contá-los seria acusar alguém de faltar com base numa linha nunca escrita.
    const lead = screen.getByText("Disagreements");
    expect(within(lead.parentElement!).getByText("2")).toBeTruthy();
    // E o terceiro é dito, com o seu próprio número, para que "zero divergências" na
    // noite não passe por "o board estava certo".
    const terceiro = screen.getByText("No clock record");
    expect(within(terceiro.parentElement!).getByText("2")).toBeTruthy();
  });

  it("escreve a regra antes de qualquer número", async () => {
    mount();
    // Cada figura abaixo lê-se de maneira diferente conforme se ache que uma das
    // fontes devia ganhar, por isso a frase não pode viver só no documento.
    const forte = await screen.findByText(/Neither corrects the other/i);
    expect(forte.closest("p")!.textContent).toMatch(/nothing here can be edited/i);
  });

  it("dá nome a quem discorda, em vez de um uuid", async () => {
    mount();
    expect(await screen.findByText("Ana Silva")).toBeTruthy();
    expect(screen.getByText("Liana Tora")).toBeTruthy();
  });

  it("não oferece nenhum botão que mude o board ou o relógio", async () => {
    mount();
    await screen.findByText("Ana Silva");
    // Read-only por decisão, não por omissão: um botão aqui reclamaria uma autoridade
    // que o sistema recusou dar a qualquer uma das duas fontes.
    const acoes = screen.queryAllByRole("button")
      .map((b) => (b.textContent ?? "").toLowerCase())
      .filter((t) => /apply|fix|correct|sync|reconcile|resolve|update/.test(t));
    expect(acoes).toEqual([]);
  });

  it("uma leitura falhada não se lê como as duas fontes a concordarem", async () => {
    failRead = true;
    mount();
    // O estado vazio diz "every board agreed with what the clock recorded". Dizê-lo
    // porque a leitura rebentou seria inventar um acordo.
    await waitFor(() => expect(screen.getByText(/could not be read/i)).toBeTruthy());
    expect(screen.queryByText(/agreed with what the clock recorded/i)).toBeNull();
  });
});
