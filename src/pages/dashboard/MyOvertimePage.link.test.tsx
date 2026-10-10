/**
 * Quem tem conta deixa de poder ser quem quiser.
 *
 * O ecrã de ligação era um `Select` com **todos** os funcionários activos que ninguém
 * tinha reclamado — nome e departamento — debaixo de "Who are you?" e de um botão
 * "That's me". O `link_me_to_employee` liga o login à linha escolhida, e a sua única
 * guarda de identidade é `(email is null or lower(email) = ...)`, que não morde: quase
 * nenhuma linha de `employees` tem email — é por isso que a porta do crachá existe.
 *
 * Resultado: qualquer conta acabada de criar escolhia de quem era. E uma conta ligada
 * responde a overtime como essa pessoa, com `self_signup_role = 'operator'` a torná-la
 * activa de imediato.
 *
 * O que se fixa aqui: não há lista nenhuma para carregar, a identidade diz-se com o
 * número do crachá, e as palavras do erro são as da base — que distingue "não
 * disponível", "já ligado" e "demasiadas tentativas", cada uma com um passo seguinte
 * diferente.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn() } }));
vi.mock("@/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/SignupQrCard", () => ({ SignupQrCard: () => null }));
vi.mock("@/components/workforce/OvertimePushNudge", () => ({ OvertimePushNudge: () => null }));

const hooks = vi.hoisted(() => ({
  linkMutate: vi.fn(),
  unlinked: vi.fn(() => ({ data: [], isLoading: false })),
}));

vi.mock("@/hooks/useOvertimeRequests", () => ({
  // Sem funcionário ligado — é este o estado que abre o ecrã de ligação.
  useMyEmployee: () => ({ data: null, isLoading: false }),
  useUnlinkedEmployees: hooks.unlinked,
  useOvertimeRequests: () => ({ data: [], isLoading: false }),
  useOvertimeResponses: () => ({ data: [] }),
  useMyOvertimeBlock: () => ({ data: null }),
  useOvertimeMutations: () => ({
    answer: { mutate: vi.fn() },
    linkMe: { mutate: hooks.linkMutate, isPending: false },
  }),
}));

import MyOvertimePage from "@/pages/dashboard/MyOvertimePage";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><MyOvertimePage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

const badgeField = () => screen.getByLabelText(/Employee ID/i);
const claimButton = () => screen.getByRole("button", { name: /That's me/i });

describe("Ligar a conta ao funcionário certo", () => {
  beforeEach(() => { hooks.linkMutate.mockReset(); hooks.unlinked.mockClear(); toastError.mockReset(); });

  it("registo válido: envia o número do crachá, em maiúsculas e sem espaços", () => {
    renderPage();
    fireEvent.change(badgeField(), { target: { value: "  e045 " } });
    fireEvent.click(claimButton());

    expect(hooks.linkMutate).toHaveBeenCalledTimes(1);
    expect(hooks.linkMutate.mock.calls[0][0]).toBe("E045");
  });

  /**
   * A asserção de segurança, e a razão de tudo isto.
   *
   * Nenhuma lista é pedida e nenhum nome aparece no ecrã. Se voltar a aparecer um
   * `Select` de nomes, este teste cai.
   */
  it("identidade não autorizada: não há lista de nomes para escolher", () => {
    renderPage();
    expect(hooks.unlinked).not.toHaveBeenCalled();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByText(/Pick your name/i)).toBeNull();
    expect(screen.queryByText(/Who are you\?/i)).toBeNull();
  });

  it("não envia nada quando o campo está vazio ou só com espaços", () => {
    renderPage();
    fireEvent.click(claimButton());
    expect(hooks.linkMutate).not.toHaveBeenCalled();

    fireEvent.change(badgeField(), { target: { value: "   " } });
    fireEvent.click(claimButton());
    expect(hooks.linkMutate).not.toHaveBeenCalled();
  });

  it("erro de autorização: mostra as palavras da base, não uma genérica", async () => {
    hooks.linkMutate.mockImplementation((_ref: string, opts: { onError: (e: Error) => void }) => {
      opts.onError(new Error("That badge number is not available. Check it, or ask your supervisor."));
    });
    renderPage();
    fireEvent.change(badgeField(), { target: { value: "E999" } });
    fireEvent.click(claimButton());

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(
      "That badge number is not available. Check it, or ask your supervisor.",
    ));
  });

  it("demasiadas tentativas: a mensagem diz quando voltar a tentar", async () => {
    // A contagem corre numa janela de 24h. Sem janela isto era um bloqueio definitivo
    // a mandar a pessoa a um supervisor que não tem ecrã nenhum para a desbloquear.
    hooks.linkMutate.mockImplementation((_ref: string, opts: { onError: (e: Error) => void }) => {
      opts.onError(new Error("Too many wrong tries. Try again tomorrow, or ask your supervisor."));
    });
    renderPage();
    fireEvent.change(badgeField(), { target: { value: "E045" } });
    fireEvent.click(claimButton());

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(
      "Too many wrong tries. Try again tomorrow, or ask your supervisor.",
    ));
  });

  it("crachá ambíguo: ninguém é ligado e a mensagem manda a um humano", async () => {
    // Dois registos activos cujo número normaliza para o mesmo não podem ser os dois
    // a mesma pessoa — e era aqui que o primeiro rascunho ligava ambos ao mesmo login.
    hooks.linkMutate.mockImplementation((_ref: string, opts: { onError: (e: Error) => void }) => {
      opts.onError(new Error("That badge number matches more than one record. Ask your supervisor."));
    });
    renderPage();
    fireEvent.change(badgeField(), { target: { value: "E045" } });
    fireEvent.click(claimButton());

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(
      "That badge number matches more than one record. Ask your supervisor.",
    ));
  });

  it("diz no ecrã o que fazer quando o crachá não tem número", () => {
    // Os 51 sem `employee_ref` não têm resposta certa a dar aqui, e o ecrã diz a quem
    // devem ir em vez de os deixar a tentar.
    renderPage();
    expect(screen.getByText(/supervisor can link your account/i)).toBeTruthy();
  });
});
