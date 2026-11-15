import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { Component, Suspense, type ReactNode } from "react";
import { lazyWithReload } from "@/lib/lazyWithReload";
import { chunkUrlFrom, chunkUrlFromFactory, RELOAD_KEY } from "@/lib/chunkCrashEvidence";

/**
 * O Safari não diz que ficheiro falhou.
 *
 * Chrome: "Failed to fetch dynamically imported module: https://…/X-abc.js".
 * Safari e todos os browsers de iOS: "Importing a module script failed." — e mais nada.
 *
 * Sem endereço, as duas retentativas do `lazyWithReload` chamavam o `factory` outra
 * vez, que o module map responde com a mesma rejeição guardada e sem pedido nenhum; e o
 * crash saía com `chunkUrl: null, chunkStatus: null`. Foi o que aconteceu a 15/11 08:47
 * em /dashboard/my-attendance: build actual (`entryIsStale: false`), online, reload já
 * gasto — e nada que dissesse se o ficheiro estava lá.
 *
 * O endereço está no código do próprio factory. O Vite compila
 * `() => import("./pages/dashboard/MyAttendancePage")` para a forma abaixo — copiada de
 * um build real do `main` a 15/11.
 */

const BUILT_FACTORY =
  '()=>Z(()=>import("./MyAttendancePage-BHr2_L2-.js"),__vite__mapDeps([206,3,4,5,6,7,8,2,9,10]))';
const ENTRY = "https://anpmsystem.co.uk/assets/index-JDvYAOL7.js";
const CHUNK = "https://anpmsystem.co.uk/assets/MyAttendancePage-BHr2_L2-.js";

const safariError = () => new TypeError("Importing a module script failed.");

/** Um factory cujo código-fonte é o do build, e cujo comportamento o teste decide. */
function built<T>(impl: () => Promise<T>): () => Promise<T> {
  const f = impl as (() => Promise<T>) & { toString: () => string };
  f.toString = () => BUILT_FACTORY;
  return f;
}

function Screen() {
  return <div>my attendance</div>;
}

class Catch extends Component<{ onError: (e: unknown) => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    this.props.onError(error);
  }
  render() {
    return this.state.failed ? <div>crashed</div> : this.props.children;
  }
}

let reload: ReturnType<typeof vi.fn>;

beforeEach(() => {
  reload = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, reload },
  });
  sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("chunkUrlFromFactory", () => {
  it("lê o chunk do código que o Vite gera, relativo à pasta /assets/", () => {
    expect(chunkUrlFromFactory(BUILT_FACTORY, ENTRY)).toBe(CHUNK);
  });

  it("aceita o caminho absoluto do servidor de desenvolvimento", () => {
    expect(
      chunkUrlFromFactory('() => import("/src/pages/dashboard/MyAttendancePage.tsx")', "http://localhost:8080/src/lib/lazyWithReload.ts"),
    ).toBe("http://localhost:8080/src/pages/dashboard/MyAttendancePage.tsx");
  });

  it("não inventa um endereço quando o código não traz nenhum", () => {
    expect(chunkUrlFromFactory("async () => { throw new Error('x'); }", ENTRY)).toBeNull();
    expect(chunkUrlFromFactory("() => import(`./${name}.js`)", ENTRY)).toBeNull();
  });
});

describe("um chunk que falha no Safari", () => {
  it("é retentado pelo endereço do factory, e não pelo mesmo import", async () => {
    let factoryCalls = 0;
    const asked: string[] = [];

    const Page = lazyWithReload(
      built(async () => {
        factoryCalls++;
        throw safariError();
      }),
      {
        moduleUrl: ENTRY,
        importUrl: async (url: string) => {
          asked.push(url);
          return { default: Screen };
        },
      },
    );

    render(
      <Suspense fallback={<div>loading</div>}>
        <Page />
      </Suspense>,
    );

    expect(await screen.findByText("my attendance")).toBeTruthy();
    expect(factoryCalls).toBe(1);
    expect(asked).toHaveLength(1);
    expect(asked[0].startsWith(`${CHUNK}?reload=`)).toBe(true);
    expect(reload).not.toHaveBeenCalled();
  });

  it("leva o endereço até ao ErrorBoundary quando nem o reload pode ajudar", async () => {
    // O reload deste minuto já foi gasto, como a 15/11 (`reloadedAlready: true`).
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    let caught: unknown;

    const Page = lazyWithReload(
      built(async () => {
        throw safariError();
      }),
      {
        moduleUrl: ENTRY,
        importUrl: async () => {
          throw safariError();
        },
      },
    );

    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <Catch onError={(e) => (caught = e)}>
        <Suspense fallback={<div>loading</div>}>
          <Page />
        </Suspense>
      </Catch>,
    );

    expect(await screen.findByText("crashed", {}, { timeout: 5000 })).toBeTruthy();
    expect(reload).not.toHaveBeenCalled();
    // A mensagem continua a do Safari; o endereço vai ao lado, onde a evidência o lê.
    expect((caught as Error).message).toBe("Importing a module script failed.");
    expect(chunkUrlFrom(caught)).toBe(CHUNK);
  });
});
