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
  beforeEach(() => { restore = withSearch(""); });
  afterEach(() => { restore?.(); restore = null; });

  it("oferece uma saída a quem não sabe o número do crachá", async () => {
    renderPage();
    // A saída existe e está onde a pessoa encalha, não no fundo da página.
    expect(screen.getByText(/Don't know your ID\?/i)).toBeTruthy();
    expect(screen.getByText(/one to three letters and then the digits/i)).toBeTruthy();
    expect(screen.getByText(/supervisor or the office can look/i)).toBeTruthy();
  });

  it("deixa passar para o email sem obrigar a encontrar o separador", async () => {
    renderPage();
    // Porta do crachá: o campo do ID está lá.
    expect(screen.getByLabelText(/Employee ID/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Register with my email/i }));

    // Porta do email: o ID desaparece e o endereço toma o lugar.
    expect(await screen.findByLabelText(/^Email$/i)).toBeTruthy();
    expect(screen.queryByLabelText(/Employee ID/i)).toBeNull();
  });

  it("diz onde se vai buscar o invite code quando ninguém o deu", () => {
    renderPage();
    expect(screen.getByText(/sign-up sheet where you clock in/i)).toBeTruthy();
    expect(screen.queryByText(/Filled in from the link/i)).toBeNull();
  });

  it("diz o mesmo na porta do email, que estava sem explicação nenhuma", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Register with my email/i }));
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
  it("quando a porta do crachá não responde, diz o que fazer e abre a outra", async () => {
    invoke.mockResolvedValueOnce({
      data: null,
      error: { name: "FunctionsFetchError", message: "Failed to send a request to the Edge Function" },
    });
    renderPage();
    fireEvent.change(screen.getByLabelText(/Employee ID/i), { target: { value: "E151" } });
    fireEvent.change(screen.getByLabelText(/Choose a password/i), { target: { value: "umapalavra" } });
    fireEvent.change(screen.getByLabelText(/Invite code/i), { target: { value: "AN-TESTE" } });
    fireEvent.click(screen.getByRole("button", { name: /Create account and sign in/i }));

    // A mensagem do SDK não chega ao ecrã.
    const aviso = await screen.findByText(/badge number isn't working right now/i);
    expect(aviso).toBeTruthy();
    expect(screen.queryByText(/Failed to send a request/i)).toBeNull();

    // E há uma saída, não só um lamento.
    fireEvent.click(screen.getByRole("button", { name: /Register with my email instead/i }));
    expect(await screen.findByLabelText(/^Email$/i)).toBeTruthy();
  });

  it("uma recusa com corpo passa intacta — não é engolida pela mensagem genérica", async () => {
    invoke.mockResolvedValueOnce({
      data: null,
      error: { message: "That invite code isn't valid any more — it may have expired. Ask your supervisor." },
    });
    renderPage();
    fireEvent.change(screen.getByLabelText(/Employee ID/i), { target: { value: "E151" } });
    fireEvent.change(screen.getByLabelText(/Choose a password/i), { target: { value: "umapalavra" } });
    fireEvent.change(screen.getByLabelText(/Invite code/i), { target: { value: "AN-ERRADO" } });
    fireEvent.click(screen.getByRole("button", { name: /Create account and sign in/i }));

    expect(await screen.findByText(/invite code isn't valid any more/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Register with my email instead/i })).toBeNull();
  });
});
