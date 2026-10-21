import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

/**
 * O botão que pergunta já, em vez de esperar pelo relógio.
 *
 * A deteção automática existe e funciona, mas tem um ritmo: 15 s depois de abrir, depois
 * de 2 em 2 minutos, e quando a app volta ao primeiro plano. Para quem está à espera de
 * uma correcção acabada de publicar, dois minutos é tempo a mais — e sem forma de forçar,
 * a saída era fechar a app e voltar a abrir. Num telemóvel com a app instalada no ecrã
 * inicial não há sequer barra de endereço com que recarregar.
 *
 * O botão faz a MESMA pergunta que o temporizador — o `index.html` servido agora nomeia o
 * mesmo bundle que esta página corre? — só que a pedido, e responde sempre, incluindo
 * quando não ha nada a fazer. Um botão mudo parece avariado e leva a segundo toque.
 */

const reload = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
  },
}));

const { useCheckForUpdates } = await import("@/components/CheckForUpdatesButton");

const ENTRY = "/assets/index-AAAA1111.js";

const serveIndex = (entry: string | null) =>
  vi.fn().mockResolvedValue(
    entry === null
      ? { ok: false, text: async () => "" }
      : { ok: true, text: async () => `<!doctype html><script type="module" crossorigin src="${entry}"></script>` },
  );

beforeEach(() => {
  reload.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  document.head.innerHTML = `<script type="module" src="https://anpmsystem.co.uk${ENTRY}"></script>`;
  Object.defineProperty(window, "location", {
    value: { ...window.location, reload, href: "https://anpmsystem.co.uk/dashboard" },
    writable: true,
  });
});

afterEach(() => {
  document.head.innerHTML = "";
  vi.useRealTimers();
});

/** O hook arranca o `useEffect` que guarda a pergunta; esperar por ele antes de carregar. */
async function ready() {
  const hook = renderHook(() => useCheckForUpdates());
  await act(async () => { await Promise.resolve(); });
  return hook;
}

describe("o botão de verificar actualizações", () => {
  it("recarrega quando o index.html ja nomeia outro bundle", async () => {
    window.fetch = serveIndex("/assets/index-BBBB2222.js") as unknown as typeof fetch;
    const { result } = await ready();

    await act(async () => { await result.current.run(); });

    expect(reload).toHaveBeenCalledTimes(1);
    expect(toastSuccess).toHaveBeenCalledWith("New version found — reloading");
  });

  /** Metade do objectivo: dizer que nao ha nada a fazer, em vez de nao dizer nada. */
  it("diz que ja esta na versao mais recente, e nao recarrega", async () => {
    window.fetch = serveIndex(ENTRY) as unknown as typeof fetch;
    const { result } = await ready();

    await act(async () => { await result.current.run(); });

    expect(reload).not.toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalledWith("You are on the latest version");
  });

  it("diz quando nao conseguiu perguntar, e nao recarrega as cegas", async () => {
    window.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch")) as unknown as typeof fetch;
    const { result } = await ready();

    await act(async () => { await result.current.run(); });

    expect(reload).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalled();
  });

  /** Um tablet de linha leva dois toques antes de a resposta chegar; é um pedido só. */
  it("dois toques seguidos fazem um pedido so", async () => {
    let resolve!: (v: unknown) => void;
    const pending = new Promise((r) => { resolve = r; });
    const fetchMock = vi.fn().mockReturnValue(pending);
    window.fetch = fetchMock as unknown as typeof fetch;
    const { result } = await ready();

    await act(async () => {
      void result.current.run();
      void result.current.run();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolve({ ok: true, text: async () => `<script type="module" src="${ENTRY}"></script>` });
      await pending;
    });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  });

  /** Em dev nao ha `/assets/`, por isso nao ha baseline com que comparar. */
  it("nao recarrega quando nao ha bundle que sirva de referencia", async () => {
    document.head.innerHTML = "";
    window.fetch = serveIndex("/assets/index-BBBB2222.js") as unknown as typeof fetch;
    const { result } = await ready();

    await act(async () => { await result.current.run(); });

    expect(reload).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalled();
  });
});
