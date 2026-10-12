/**
 * O tablet da linha mostra um aviso e um código, e mais nada.
 *
 * Listava também os turnos em aberto, por cima de um aviso a dizer que daqui não se
 * responde a nenhum. A pessoa lia "ter., 13/10 · 06:00–18:00 — 5 people needed",
 * procurava o botão, não havia botão. O que fica disso não é "tenho de usar o
 * telemóvel", é que o sistema está avariado.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TabletOvertimeNotice } from "@/components/workforce/TabletOvertimeNotice";

// O cartão do código leva um <Link>, que precisa de um router à volta.
const mostrar = () => render(<MemoryRouter><TabletOvertimeNotice /></MemoryRouter>);

vi.mock("@/hooks/useSignupInvite", () => ({ useSignupInviteCode: () => "AN-TESTE" }));

describe("TabletOvertimeNotice", () => {
  it("diz porque não se responde daqui", () => {
    mostrar();
    expect(screen.getByText(/this is the line's tablet, not your phone/i)).toBeTruthy();
    expect(screen.getByText(/answer on your own phone/i)).toBeTruthy();
  });

  it("leva a pessoa a criar a conta", () => {
    mostrar();
    expect(screen.getByRole("link", { name: /create account/i })).toBeTruthy();
  });

  it("não mostra turno nenhum", () => {
    mostrar();
    expect(screen.queryByText(/people needed/i)).toBeNull();
    expect(screen.queryByText(/\d{2}:\d{2}\s*[–-]\s*\d{2}:\d{2}/)).toBeNull();
    expect(screen.queryByText(/no overtime on offer/i)).toBeNull();
  });

  /**
   * Não desenhar a lista e continuar a ir buscá-la deixava a porta aberta para alguém
   * a repor por engano — e uma conta partilhada por um turno inteiro não tem motivo
   * para ler quem é preciso onde e quando.
   */
  it("nem sequer pede os pedidos à base", () => {
    const fonte = readFileSync(
      resolve(__dirname, "../../components/workforce/TabletOvertimeNotice.tsx"), "utf8");
    expect(fonte).not.toContain("useOvertimeRequests");
  });
});
