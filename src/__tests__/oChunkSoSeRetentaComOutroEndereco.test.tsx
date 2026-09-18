import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { Suspense } from "react";
import { lazyWithReload } from "@/lib/lazyWithReload";

/**
 * Chamar o mesmo `import()` outra vez nao volta a rede.
 *
 * O module map do documento guarda o *resultado* da primeira busca de cada URL,
 * incluindo a falha. Um segundo `import("…/WorkOrdersPage-H-2GQemv.js")` no mesmo
 * documento devolve a mesma rejeicao, de imediato e sem pedido nenhum. Ou seja: as
 * duas retentativas que o `lazyWithReload` gastava — 600ms + 1500ms — nunca podiam
 * dar outro resultado. O teste que as cobria so passava porque substituia o
 * `factory` por uma funcao que decidia sozinha falhar uma vez e acertar a seguir; o
 * `import()` real nao tem essa liberdade.
 *
 * O que o Root Diagnostics registou a 17/09 16:11 diz o resto. Tres REACT_CRASH em
 * catorze segundos, em dois chunks, todos com `chunkStatus: 200` e
 * `entryIsStale: false` — o ficheiro estava servido e o separador corria a build da
 * altura. O que falhou foi a busca daquele momento, e nada a seguir podia desfazer
 * isso enquanto o endereco fosse o mesmo.
 *
 * Um endereco diferente e uma entrada diferente no module map, e portanto um pedido
 * mesmo. A query nao muda o ficheiro que o host serve nem os imports estaticos la
 * dentro (esses continuam sem query, e continuam partilhados), so o obriga a ser
 * pedido outra vez.
 */

const CHUNK = "https://example.lovable.app/assets/WorkOrdersPage-H-2GQemv.js";

const chunkError = () =>
  new TypeError(`Failed to fetch dynamically imported module: ${CHUNK}`);

function Screen() {
  return <div>work orders</div>;
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

describe("uma busca de chunk que falhou", () => {
  it("e retentada por outro endereco, e nao pelo mesmo import", async () => {
    let factoryCalls = 0;
    const asked: string[] = [];

    const Late = lazyWithReload(
      async () => {
        factoryCalls++;
        throw chunkError();
      },
      {
        importUrl: async (url: string) => {
          asked.push(url);
          return { default: Screen };
        },
      },
    );

    render(
      <Suspense fallback={<div>loading</div>}>
        <Late />
      </Suspense>,
    );

    expect(await screen.findByText("work orders")).toBeTruthy();
    // Uma so — repetir o mesmo especificador nao e uma retentativa.
    expect(factoryCalls).toBe(1);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain("/assets/WorkOrdersPage-H-2GQemv.js");
    expect(asked[0]).not.toBe(CHUNK);
    expect(new URL(asked[0]).searchParams.get("reload")).toBeTruthy();
    // O ecra do utilizador nunca foi deitado fora.
    expect(reload).not.toHaveBeenCalled();
  });

  it("pede enderecos distintos em cada tentativa", async () => {
    const asked: string[] = [];

    const Never = lazyWithReload(
      async () => {
        throw chunkError();
      },
      {
        importUrl: async (url: string) => {
          asked.push(url);
          throw chunkError();
        },
      },
    );

    render(
      <Suspense fallback={<div>loading</div>}>
        <Never />
      </Suspense>,
    );

    // Esgotadas as tentativas, resta o reload — e so ai.
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1), { timeout: 5000 });
    expect(asked).toHaveLength(2);
    expect(new Set(asked).size).toBe(2);
  });

  it("nao inventa um endereco quando a mensagem nao traz nenhum", async () => {
    let factoryCalls = 0;
    const asked: string[] = [];

    const Odd = lazyWithReload(
      async () => {
        factoryCalls++;
        if (factoryCalls === 1) throw new TypeError("Importing a module script failed");
        return { default: Screen };
      },
      { importUrl: async (url: string) => { asked.push(url); return { default: Screen }; } },
    );

    render(
      <Suspense fallback={<div>loading</div>}>
        <Odd />
      </Suspense>,
    );

    expect(await screen.findByText("work orders")).toBeTruthy();
    expect(asked).toHaveLength(0);
    expect(factoryCalls).toBe(2);
  });
});
