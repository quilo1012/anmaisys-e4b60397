/**
 * O tablet da linha não é uma pessoa, e o ecrã deixou de fingir que é.
 *
 * O `tablet-signin` entra com um `account_id` partilhado por toda a linha, e o
 * overtime pergunta quem tu és através do `my_overtime_identity()`, que lê
 * `employees.user_id = auth.uid()`. Bastou a primeira pessoa a usar o tablet da
 * Linha 1 aceitar o convite "Pick your name once" para a conta partilhada ficar
 * colada à linha dela: a partir daí o tablet do turno do dia dizia "Signed in as
 * Eduardo Luz, Night crew", com a resposta dele já aceite, e a segunda pessoa a
 * tentar batia em "This login is already linked to an employee".
 *
 * Era daí que vinha a queixa de que só um funcionário conseguia confirmar.
 *
 * A recusa definitiva pertence ao `link_me_to_employee`, na base. O que se fixa aqui
 * é o ecrã não voltar a fazer a pergunta a quem não a pode responder.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { TABLET_CRED_KEY } from "@/lib/sharedTabletSession";

vi.mock("@/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/SignupQrCard", () => ({
  SignupQrCard: () => <div data-testid="signup-qr">QR</div>,
}));
vi.mock("@/components/workforce/OvertimePushNudge", () => ({ OvertimePushNudge: () => null }));

/** `vi.mock` é içado para o topo, por isso os duplos nascem aqui dentro. */
const hooks = vi.hoisted(() => {
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const ask = {
    id: "ask-1", on_date: tomorrow, starts_at: "06:00:00", ends_at: "14:00:00",
    status: "open", headcount: 15, department: null, shift_group: "Night",
  };
  /** A identidade que a conta partilhada herdou — o ecrã não pode usá-la. */
  const eduardo = { id: "emp-1", full_name: "Eduardo Luz", department: null, shift_group: "Night" };
  return {
    ask,
    useMyEmployee: vi.fn(() => ({ data: eduardo, isLoading: false })),
    useUnlinkedEmployees: vi.fn(() => ({ data: [], isLoading: false })),
    useOvertimeRequests: vi.fn(() => ({ data: [ask], isLoading: false })),
    useOvertimeResponses: vi.fn(() => ({ data: [] })),
    useMyOvertimeBlock: vi.fn(() => ({ data: null })),
    useOvertimeMutations: vi.fn(() => ({
      answer: { mutate: vi.fn() }, linkMe: { mutate: vi.fn(), isPending: false },
    })),
  };
});
vi.mock("@/hooks/useOvertimeRequests", () => hooks);

import MyOvertimePage from "@/pages/dashboard/MyOvertimePage";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><MyOvertimePage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("My Overtime num tablet partilhado", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  const asTablet = () =>
    localStorage.setItem(TABLET_CRED_KEY, JSON.stringify({ accountId: "line-1", refresh_token: "t" }));

  it("não mostra o nome de quem a conta partilhada herdou", async () => {
    asTablet();
    renderPage();
    await waitFor(() => expect(screen.getByText(/the line's tablet/i)).toBeTruthy());
    expect(screen.queryByText(/Eduardo Luz/)).toBeNull();
    expect(screen.queryByText(/Signed in as/i)).toBeNull();
  });

  it("não oferece botões de resposta nem o \"pick your name\"", async () => {
    asTablet();
    renderPage();
    await waitFor(() => expect(screen.getByText(/the line's tablet/i)).toBeTruthy());
    expect(screen.queryByRole("button", { name: /yes/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^no/i })).toBeNull();
    expect(screen.queryByText(/Who are you\?/i)).toBeNull();
    expect(screen.queryByText(/Pick your name once/i)).toBeNull();
  });

  it("mostra na mesma as horas abertas, porque o tablet é por onde se passa", async () => {
    asTablet();
    renderPage();
    await waitFor(() => expect(screen.getByText(/06:00/)).toBeTruthy());
    expect(screen.getByTestId("signup-qr")).toBeTruthy();
  });

  it("mesmo com a conta por ligar, não pede ao tablet que escolha um nome", async () => {
    // O caso que criou o estrago: sem ninguém ligado, o ecrã convidava a escolher.
    hooks.useMyEmployee.mockReturnValueOnce({ data: null, isLoading: false });
    asTablet();
    renderPage();
    await waitFor(() => expect(screen.getByText(/the line's tablet/i)).toBeTruthy());
    expect(screen.queryByText(/Who are you\?/i)).toBeNull();
  });

  it("no telemóvel de uma pessoa continua a ser o ecrã dela", async () => {
    // Sem `an_tablet_cred` — um login de staff apaga-o — nada disto se aplica.
    renderPage();
    await waitFor(() => expect(screen.getByText(/Signed in as Eduardo Luz/)).toBeTruthy());
    expect(screen.queryByText(/the line's tablet/i)).toBeNull();
  });
});
