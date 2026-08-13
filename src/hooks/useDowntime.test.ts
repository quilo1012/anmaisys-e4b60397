import { describe, it, expect, vi } from "vitest";

type QueryOpts = { queryKey: unknown[] };

const useQuery = vi.fn((_opts: QueryOpts) => ({ data: undefined, isLoading: false }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: QueryOpts) => useQuery(opts),
  useMutation: () => ({ mutate: () => {} }),
  useQueryClient: () => ({ invalidateQueries: () => {} }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { useDowntime } from "./useDowntime";

const keyOf = (call: number) => useQuery.mock.calls[call][0].queryKey;

/**
 * A chave da consulta tem de assentar entre renders.
 *
 * Quando o tecto de noventa dias passou a ser um argumento, o início por defeito
 * ficou a ser calculado com `Date.now()` a cada render. Isso dá um instante
 * diferente a cada milissegundo, e o instante entra na `queryKey` — para o
 * react-query, uma consulta nova de cada vez. Os dois ecrãs que chamam isto sem
 * argumento ficariam a pedir a mesma coisa ao servidor sem parar, e nada no ecrã
 * o denunciaria: os dados até estariam certos.
 *
 * É por isso que o defeito por omissão é truncado ao dia.
 */
describe("useDowntime — a chave não pode mexer-se sozinha", () => {
  it("dois renders seguidos sem argumento pedem a mesma coisa", () => {
    useQuery.mockClear();
    useDowntime();
    useDowntime();
    expect(keyOf(0)).toEqual(keyOf(1));
  });

  it("o início por omissão está truncado ao dia", () => {
    useQuery.mockClear();
    useDowntime();
    const [, since] = keyOf(0) as [string, string];
    expect(since).toMatch(/T\d\d:00:00\.000Z$/);
    // Meia-noite local, que em Londres cai numa hora redonda em UTC nos dois
    // horários. O que se fixa é que não tem minutos, segundos nem milissegundos.
    expect(new Date(since).getMinutes()).toBe(0);
    expect(new Date(since).getSeconds()).toBe(0);
  });

  it("um início pedido pelo chamador manda, e distingue-se do defeito", () => {
    useQuery.mockClear();
    const pedido = new Date("2026-01-01T00:00:00Z");
    useDowntime(pedido);
    useDowntime();
    expect(keyOf(0)).toEqual(["downtime", pedido.toISOString()]);
    expect(keyOf(0)).not.toEqual(keyOf(1));
  });
});
