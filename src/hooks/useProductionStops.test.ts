import { describe, it, expect, vi, afterAll } from "vitest";

/**
 * O ecrã de Stop Analysis dizia "last 30 days" por cima de cinco dias.
 *
 * Duas falhas, uma em cima da outra. O `.limit(20 000)` não levanta o tecto de 1 000
 * linhas que o PostgREST impõe do lado do servidor: a resposta chegava cortada, sem
 * erro nenhum, e o sinal de truncagem comparava o que recebeu com 20 000 — por isso o
 * aviso que está escrito no ecrã nunca chegou a aparecer. 226h34 onde a fábrica parou
 * 2 679h, 1 000 paragens onde houve 7 352, e nada a dizer que faltava alguma coisa.
 *
 * E o início do intervalo era a meia-noite local passada por `toISOString()`, que em
 * BST é as 23:00 do dia anterior. `.slice(0, 10)` lia daí o dia errado e "hoje" trazia
 * dois dias. A Line 1 aparecia com 2h53m de pausas num turno em que fez 1h22m: as três
 * de ontem somadas às três de hoje, todas DAY, nenhuma removida pelo filtro de turno.
 *
 * O fuso fica preso a Londres de propósito. A fábrica é lá e o erro só se vê quando o
 * relógio está à frente do UTC — num `TZ=UTC` as duas implementações concordam, e um
 * teste que passa por estar no fuso certo não guarda nada.
 */

const TZ_ORIGINAL = process.env.TZ;
process.env.TZ = "Europe/London";
afterAll(() => {
  process.env.TZ = TZ_ORIGINAL;
});

const espia = vi.hoisted(() => ({
  filtros: {} as Record<string, string>,
  paginas: [] as Array<[number, number]>,
  linhasNaBase: 0,
}));

type QueryOpts = { queryKey: unknown[]; queryFn: () => Promise<unknown> };
const useQuery = vi.fn((_opts: QueryOpts) => ({ data: undefined, isLoading: false }));
vi.mock("@tanstack/react-query", () => ({ useQuery: (opts: QueryOpts) => useQuery(opts) }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      const b: Record<string, unknown> = {};
      return Object.assign(b, {
        select: () => b,
        gte: (col: string, v: string) => {
          espia.filtros[`gte:${col}`] = v;
          return b;
        },
        lte: (col: string, v: string) => {
          espia.filtros[`lte:${col}`] = v;
          return b;
        },
        order: () => b,
        range: (lo: number, hi: number) => {
          espia.paginas.push([lo, hi]);
          const data: Array<{ id: string }> = [];
          for (let i = lo; i <= Math.min(hi, espia.linhasNaBase - 1); i++) data.push({ id: `r${i}` });
          return Promise.resolve({ data, error: null });
        },
        // O servidor corta a resposta às 1 000 linhas e não diz nada. Pedir mais pelo
        // `.limit()` não muda isso — quem lá chegar está a repetir o erro.
        limit: () => {
          throw new Error("`.limit()` não levanta o tecto de 1 000 linhas do PostgREST — pagina");
        },
      });
    },
  },
}));

import { useProductionStops, STOPS_ROW_LIMIT, type ProductionStopsResult } from "./useProductionStops";

async function ler(from: Date, to: Date): Promise<ProductionStopsResult> {
  useQuery.mockClear();
  espia.filtros = {};
  espia.paginas = [];
  useProductionStops(from, to);
  const opts = useQuery.mock.calls[0][0];
  return (await opts.queryFn()) as ProductionStopsResult;
}

const HOJE = new Date(2026, 9, 4, 9, 30, 0);
const INICIO_DE_HOJE = new Date(2026, 9, 4, 0, 0, 0);

describe("useProductionStops — as mil linhas que o servidor devolve não são o total", () => {
  it("lê as 2 500 linhas do período, não as primeiras 1 000", async () => {
    espia.linhasNaBase = 2_500;
    const { stops } = await ler(INICIO_DE_HOJE, HOJE);
    expect(stops).toHaveLength(2_500);
    expect(espia.paginas).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("2 500 linhas lidas inteiras não são um período truncado", async () => {
    espia.linhasNaBase = 2_500;
    const { truncated } = await ler(INICIO_DE_HOJE, HOJE);
    expect(truncated).toBe(false);
  });

  it("o tecto, quando é mesmo atingido, acende o aviso", async () => {
    espia.linhasNaBase = STOPS_ROW_LIMIT + 5_000;
    const { stops, truncated } = await ler(INICIO_DE_HOJE, HOJE);
    expect(stops).toHaveLength(STOPS_ROW_LIMIT);
    expect(truncated).toBe(true);
  });
});

describe("useProductionStops — o dia operacional é um dia local, não um instante", () => {
  it("'hoje' pergunta pelo dia de hoje, e não também pelo de ontem", async () => {
    espia.linhasNaBase = 10;
    await ler(INICIO_DE_HOJE, HOJE);
    // Em BST, `startOfDay(hoje).toISOString().slice(0, 10)` dava "2026-10-03".
    expect(espia.filtros["gte:occurred_date"]).toBe("2026-10-04");
    expect(espia.filtros["lte:occurred_date"]).toBe("2026-10-04");
  });

  it("um período de 30 dias pede 30 dias", async () => {
    espia.linhasNaBase = 10;
    await ler(new Date(2026, 8, 5, 0, 0, 0), HOJE);
    expect(espia.filtros["gte:occurred_date"]).toBe("2026-09-05");
    expect(espia.filtros["lte:occurred_date"]).toBe("2026-10-04");
  });

  it("a chave da consulta assenta entre renders", async () => {
    espia.linhasNaBase = 10;
    useQuery.mockClear();
    useProductionStops(INICIO_DE_HOJE, HOJE);
    useProductionStops(INICIO_DE_HOJE, HOJE);
    expect(useQuery.mock.calls[0][0].queryKey).toEqual(useQuery.mock.calls[1][0].queryKey);
  });
});
