/**
 * O ecrã de registo não pode pedir duas coisas que a pessoa não tem maneira de saber.
 *
 * Pedia. O Employee ID é "o número do teu crachá" — e 51 pessoas da lista não têm
 * `employee_ref` nenhum, por isso para elas aquele campo nunca teve resposta certa, e
 * muitas das outras nunca leram o número. O Invite code chega preenchido a quem abre o
 * link do administrador, mas o QR do tablet leva só `/signup`, por isso quem o lê — o
 * chão de fábrica, exactamente quem precisa — encontra a caixa vazia com "From your
 * supervisor" escrito dentro e nenhum supervisor por perto.
 *
 * O que se fixa aqui: os dois becos passam a ter saída escrita no sítio onde a pessoa
 * encalha, e nenhuma delas depende de alguém adivinhar.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn(async () => ({ data: null, error: null })),
    auth: { setSession: vi.fn(async () => ({ error: null })) },
  },
}));
const invoke = vi.hoisted(() => vi.fn(async () => ({ data: null, error: null })));
vi.mock("@/lib/invokeFunction", () => ({ invokeFunction: invoke }));

import SignUp from "@/pages/SignUp";
import { supabase } from "@/integrations/supabase/client";

/** O ecrã lê `?code=` do endereço ao montar, por isso o teste tem de o pôr lá antes. */
function withSearch(search: string) {
  const original = window.location;
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...original, search, href: original.href, origin: original.origin },
  });
  return () => Object.defineProperty(window, "location", { configurable: true, value: original });
}

const renderPage = () => render(<MemoryRouter><SignUp /></MemoryRouter>);

describe("Create account — o que a pessoa à frente do ecrã pode saber", () => {
  let restore: (() => void) | null = null;
  beforeEach(() => {
    sessionStorage.clear();
    vi.mocked(supabase.rpc).mockReset();
    vi.mocked(supabase.rpc).mockImplementation((async () => ({ data: null, error: null })) as never);
    restore = withSearch("");
  });
  afterEach(() => { restore?.(); restore = null; });

  it("diz onde se vai buscar o invite code quando ninguém o deu", () => {
    renderPage();
    expect(screen.getByText(/sign-up sheet where you clock in/i)).toBeTruthy();
    expect(screen.queryByText(/Filled in from the link/i)).toBeNull();
  });

  it("diz o mesmo na porta do email, que estava sem explicação nenhuma", async () => {
    renderPage();
    // Quem foge de um número que não sabe não pode cair numa segunda caixa pior.
    expect(await screen.findByLabelText(/^Email$/i)).toBeTruthy();
    expect(screen.getByText(/sign-up sheet where you clock in/i)).toBeTruthy();
    expect(screen.queryByPlaceholderText(/Ask your administrator/i)).toBeNull();
  });

  it("diz que o código veio do link quando veio, em vez de o deixar sem explicação", () => {
    restore?.();
    restore = withSearch("?code=AN-2026");
    renderPage();

    const field = screen.getByLabelText(/Invite code/i) as HTMLInputElement;
    expect(field.value).toBe("AN-2026");
    expect(screen.getByText(/Filled in from the link/i)).toBeTruthy();
    expect(screen.queryByText(/sign-up sheet where you clock in/i)).toBeNull();
  });

  it("verifica o código do QR ao abrir e diz que serve, sem a pessoa escrever nada", async () => {
    vi.mocked(supabase.rpc).mockImplementation((async (fn: string) =>
      ({ data: fn === "check_invite_code" ? true : null, error: null })) as never);
    restore?.();
    restore = withSearch("?code=AN-2026");
    renderPage();

    expect((screen.getByLabelText(/Invite code/i) as HTMLInputElement).value).toBe("AN-2026");
    expect(await screen.findByText(/It's valid/i)).toBeTruthy();
    expect(supabase.rpc).toHaveBeenCalledWith("check_invite_code", { code: "AN-2026" });
  });

  it("um código do QR que já não serve é dito logo, antes da palavra-passe", async () => {
    vi.mocked(supabase.rpc).mockImplementation((async (fn: string) =>
      ({ data: fn === "check_invite_code" ? false : null, error: null })) as never);
    restore?.();
    restore = withSearch("?code=AN-OLD");
    renderPage();

    expect((await screen.findByRole("alert")).textContent).toMatch(/isn't valid any more/i);
  });

  it("o código sobrevive a ir ao Sign in e voltar sem ele no endereço", () => {
    restore?.();
    restore = withSearch("?code=AN-2026");
    renderPage().unmount();

    restore();
    restore = withSearch("");
    renderPage();
    expect((screen.getByLabelText(/Invite code/i) as HTMLInputElement).value).toBe("AN-2026");
    expect(screen.getByText(/Filled in from the link/i)).toBeTruthy();
  });

  /**
   * A porta do crachá quando a função não responde.
   *
   * O `employee-signin` não está publicada, e o gateway responde ao **preflight** de
   * um nome desconhecido com 404 e cabeçalhos incompletos — sem
   * `access-control-allow-methods` e sem `content-type` nos permitidos. O browser
   * desiste antes do POST, por isso nada volta para mostrar e o SDK só tem
   * "Failed to send a request to the Edge Function". Medido contra a `tablet-signin`,
   * que é publicada e responde 200 ao mesmo preflight.
   *
   * A porta do email não passa por aqui e funciona.
   */
  /**
   * The tablet's own "Create account" button opens this with `?tablet=1`.
   *
   * The badge door hands back tokens for the new account. Using them would sign the
   * line's shared tablet in as one person — the Eduardo Luz failure again, by another
   * route. On a tablet the account is made and the tokens are left alone.
   */
  /**
   * "AbortError: Fetch is aborted" era o que o ecrã mostrava: o texto do WebKit para
   * um pedido cortado, devolvido pelo postgrest-js como `{ message }`. Uma queda é
   * tentada outra vez sozinha; se cair outra vez, a pessoa lê uma frase que pode seguir.
   */
  const fillEmailDoor = async () => {
    fireEvent.change(await screen.findByLabelText(/Full name/i), { target: { value: "Ana Teste" } });
    fireEvent.change(screen.getByLabelText(/^Email$/i), { target: { value: "ana@example.com" } });
    fireEvent.change(screen.getByLabelText(/^Password$/i), { target: { value: "umapalavra" } });
    fireEvent.change(screen.getByLabelText(/Invite code/i), { target: { value: "AN-TESTE" } });
    fireEvent.click(screen.getAllByRole("button", { name: /^Create account$/i }).at(-1)!);
  };

  it("uma ligação que cai duas vezes dá a frase que se pode seguir, não o AbortError", async () => {
    const rpc = vi.mocked(supabase.rpc);
    rpc.mockImplementation((async (fn: string) =>
      fn === "check_invite_code"
        ? { data: null, error: { message: "AbortError: Fetch is aborted", code: "" } }
        : { data: null, error: null }) as never);
    renderPage();
    await fillEmailDoor();

    expect(await screen.findByText(
      "Não foi possível ligar ao servidor. Verifique a ligação e tente novamente.",
      undefined, { timeout: 4000 },
    )).toBeTruthy();
    expect(screen.queryByText(/AbortError|Fetch is aborted/)).toBeNull();
    expect(rpc.mock.calls.filter(([fn]) => fn === "check_invite_code")).toHaveLength(2);
    rpc.mockImplementation((async () => ({ data: null, error: null })) as never);
  });

});
