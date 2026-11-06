/**
 * Um ecrã que não chegou não volta com "Try again".
 *
 * O React.lazy guarda a rejeição do import, por isso voltar a desenhar o mesmo ecrã
 * atira o mesmo erro de imediato, sem pedido nenhum. A 06/11 07:02, um engenheiro na
 * versão atual e online teve várias entradas "Importing a module script failed" em
 * poucos segundos, e o ficheiro já não estava em falta quando o fomos ver.
 * Só um documento novo volta a pedir o ficheiro.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ErrorBoundary } from "@/components/ErrorBoundary";

vi.mock("@/lib/telemetry", () => ({ logSystemError: vi.fn() }));

const reload = vi.fn();

function Throws({ message }: { message: string }): JSX.Element {
  throw new Error(message);
}

describe("Try again no cartão de erro", () => {
  beforeEach(() => {
    reload.mockClear();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("location", { ...window.location, href: "https://x.test/", reload });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 200 })));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it("recarrega a página quando o ecrã não chegou a descarregar", () => {
    render(<ErrorBoundary><Throws message="Importing a module script failed." /></ErrorBoundary>);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("num erro de outro tipo, tenta desenhar outra vez sem recarregar", () => {
    render(<ErrorBoundary><Throws message="Cannot read properties of undefined" /></ErrorBoundary>);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reload).not.toHaveBeenCalled();
  });
});
