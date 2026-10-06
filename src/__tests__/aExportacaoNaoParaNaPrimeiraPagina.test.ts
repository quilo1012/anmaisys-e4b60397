import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// @ts-expect-error — script .mjs sem tipos, importado de propósito
import { exportarTabela, listarRecursivo } from "../../scripts/exportar-tudo.mjs";

/**
 * A exportação que tira os dados do Lovable tem de os tirar **todos**.
 *
 * O `scripts/exportar-tudo.mjs` existe porque a base de produção é o Lovable Cloud e,
 * sem créditos, a documentação do Lovable diz que os serviços pausam e que "you cannot
 * access or export it until the services run again". É a porta de saída, e corre uma
 * vez, possivelmente com a janela a fechar. Se truncar, ninguém dá por isso até ser
 * tarde.
 *
 * E truncar é precisamente o que já aconteceu neste projecto: o PostgREST devolve 1000
 * linhas por omissão, e uma leitura escrita sem paginar perdeu um mês de produção sem
 * dar erro nenhum — ver `claude/leituras-a-1000-linhas-2026-10-03.md`.
 *
 * Por isso este teste não verifica que a exportação "corre". Verifica que ela atravessa
 * a fronteira das 1000 linhas, que **confere o que escreveu contra a contagem da base**,
 * e que grita quando não bate — que é a única defesa contra uma exportação silenciosa e
 * incompleta.
 *
 * O cliente é falso de propósito: o contentor não alcança a Supabase, e um teste que
 * precisasse de rede não correria no CI.
 */

/**
 * O mínimo do supabase-js que o script usa.
 *
 * Detalhe que importa: no supabase-js `.range()` e `.order()` devolvem **o construtor**,
 * que só é resolvido quando alguém faz `await`. Um duplo que devolvesse uma promessa de
 * `.range()` partia-se no `.order()` a seguir — e seria o duplo a estar errado, não o
 * script. Daí o objecto ser *thenable* em vez de assíncrono a cada passo.
 */
function clienteFalso(linhas: Record<string, unknown>[], opcoes: { comId?: boolean } = {}) {
  const comId = opcoes.comId ?? true;

  const construtor = () => {
    const estado: { inicio: number; fim: number; erro: { message: string } | null } = {
      inicio: 0,
      fim: linhas.length - 1,
      erro: null,
    };
    const b = {
      select(_cols: string, cfg?: { count?: string; head?: boolean }) {
        if (cfg?.head) return Promise.resolve({ count: linhas.length, error: null });
        return b;
      },
      order(_coluna: string) {
        // Uma tabela sem `id` faz o PostgREST recusar a ordenação. O script tem de
        // reagir a isso e tentar outra vez sem ordem, em vez de desistir da tabela.
        if (!comId) estado.erro = { message: "column id does not exist" };
        return b;
      },
      range(inicio: number, fim: number) {
        estado.inicio = inicio;
        estado.fim = fim;
        return b;
      },
      then(aceita: (v: unknown) => unknown, rejeita?: (e: unknown) => unknown) {
        const r = estado.erro
          ? { data: null, error: estado.erro }
          : { data: linhas.slice(estado.inicio, estado.fim + 1), error: null };
        return Promise.resolve(r).then(aceita, rejeita);
      },
    };
    return b;
  };

  return { from: (_tabela: string) => construtor() };
}

let destino: string;

beforeEach(() => {
  destino = mkdtempSync(join(tmpdir(), "export-teste-"));
});
afterEach(() => {
  rmSync(destino, { recursive: true, force: true });
});

function lerNdjson(tabela: string) {
  const bruto = readFileSync(join(destino, "tabelas", `${tabela}.ndjson`), "utf8");
  return bruto.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

describe("a exportação não pára na primeira página", () => {
  it("atravessa as 1000 linhas em vez de parar lá", async () => {
    const linhas = Array.from({ length: 2500 }, (_, i) => ({ id: i + 1, valor: `linha ${i + 1}` }));

    const r = await exportarTabela(clienteFalso(linhas), "work_orders", destino);

    expect(r.estado).toBe("ok");
    expect(r.linhas).toBe(2500);

    const escritas = lerNdjson("work_orders");
    expect(escritas).toHaveLength(2500);
    // O primeiro e o último: se parasse na página um, o último seria o 1000.
    expect(escritas[0].id).toBe(1);
    expect(escritas[2499].id).toBe(2500);
  });

  it("acerta no limite exacto, onde um off-by-one se esconde", async () => {
    const linhas = Array.from({ length: 1000 }, (_, i) => ({ id: i + 1 }));
    const r = await exportarTabela(clienteFalso(linhas), "employees", destino);
    expect(r.linhas).toBe(1000);
    expect(lerNdjson("employees")).toHaveLength(1000);
  });

  it("diz INCOMPLETA quando o que saiu não bate com a contagem da base", async () => {
    const linhas = Array.from({ length: 10 }, (_, i) => ({ id: i + 1 }));
    const cliente = clienteFalso(linhas);
    // A base diz 50; só se conseguem ler 10. Sem esta verificação a exportação
    // terminava a dizer "ok" e faltavam 40 registos.
    const original = cliente.from;
    cliente.from = (tabela: string) => {
      const c = original(tabela);
      const selectOriginal = c.select.bind(c);
      c.select = (cols: string, cfg?: { count?: string; head?: boolean }) =>
        cfg?.head ? Promise.resolve({ count: 50, error: null }) : selectOriginal(cols, cfg);
      return c;
    };

    const r = await exportarTabela(cliente, "attendance_days", destino);

    expect(r.estado).toBe("INCOMPLETA");
    expect(r.linhas).toBe(10);
    expect(r.esperado).toBe(50);
  });

  it("não desiste de uma tabela só por não ter coluna id", async () => {
    const linhas = Array.from({ length: 1500 }, (_, i) => ({ chave: `k${i}` }));

    const r = await exportarTabela(clienteFalso(linhas, { comId: false }), "_rls_snapshot", destino);

    expect(r.estado).toBe("ok");
    expect(r.linhas).toBe(1500);
    // Fica assinalado, para quem lê o manifesto saber que a ordem não é garantida.
    expect(r.ordenada).toBe(false);
  });

  it("distingue uma tabela vazia de uma que o RLS escondeu, sem inventar", async () => {
    const r = await exportarTabela(clienteFalso([]), "audit_logs", destino);
    expect(r.estado).toBe("rls_ou_vazia");
    expect(r.linhas).toBe(0);
  });
});

describe("os ficheiros também saem todos", () => {
  it("entra nas pastas em vez de levar só o primeiro nível", async () => {
    const porPrefixo: Record<string, Array<{ name: string; id: string | null }>> = {
      "": [
        { name: "2026", id: null }, // pasta
        { name: "solto.png", id: "f1" },
      ],
      "2026": [{ name: "10", id: null }],
      "2026/10": [
        { name: "a.jpg", id: "f2" },
        { name: "b.jpg", id: "f3" },
      ],
    };

    const sb = {
      storage: {
        from: () => ({
          list: (prefixo: string, { offset }: { limit: number; offset: number }) =>
            Promise.resolve({ data: offset === 0 ? (porPrefixo[prefixo] ?? []) : [], error: null }),
        }),
      },
    };

    const caminhos = await listarRecursivo(sb, "wo-photos");

    expect(caminhos.sort()).toEqual(["2026/10/a.jpg", "2026/10/b.jpg", "solto.png"]);
  });
});
