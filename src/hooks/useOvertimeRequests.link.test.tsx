/**
 * A janela entre o ecrã novo e a migração colada.
 *
 * Nada neste repositório aplica uma migração — uma pessoa cola-a — por isso as duas
 * metades desta alteração não aterram no mesmo instante. Entre uma e outra o
 * `link_me_by_employee_ref` não existe, e o PostgREST responde `PGRST202` com um texto
 * verdadeiro e inútil para quem está numa fábrica: "Could not find the function
 * public.link_me_by_employee_ref(p_ref) in the schema cache".
 *
 * Qualquer outro erro é da base e passa intacto: ela distingue "não disponível", "mais
 * do que um registo" e "demasiadas tentativas", e cada um manda fazer coisa diferente.
 *
 * Exercita o hook a sério — `renderHook` sobre o `useOvertimeMutations` real, com o
 * cliente Supabase duplicado. Um teste que reescrevesse o corpo da mutação não podia
 * falhar quando o corpo verdadeiro mudasse, que é a única altura em que importa.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc,
    from: () => ({ select: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }),
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
    removeChannel: () => {},
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));

import { useOvertimeMutations } from "@/hooks/useOvertimeRequests";

function linkMe() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useOvertimeMutations(), { wrapper });
  return result;
}

/** O que a mutação rejeitou, esperando que ela termine. */
async function failureOf(result: { current: { linkMe: { mutate: (r: string) => void; isError: boolean; error: unknown } } }, ref: string) {
  result.current.linkMe.mutate(ref);
  await waitFor(() => expect(result.current.linkMe.isError).toBe(true));
  return (result.current.linkMe.error as Error).message;
}

describe("linkMe", () => {
  beforeEach(() => rpc.mockReset());

  it("envia o número do crachá para o parâmetro certo", async () => {
    rpc.mockResolvedValue({ error: null });
    const result = linkMe();
    result.current.linkMe.mutate("E045");
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(rpc).toHaveBeenCalledWith("link_me_by_employee_ref", { p_ref: "E045" });
  });

  it("PGRST202 — a função ainda não existe — vira uma frase que diz o que fazer", async () => {
    rpc.mockResolvedValue({
      error: { code: "PGRST202", message: "Could not find the function public.link_me_by_employee_ref(p_ref) in the schema cache" },
    });
    expect(await failureOf(linkMe(), "E045")).toMatch(/Ask your supervisor to link your account/i);
  });

  it("um erro da base passa com as palavras da base", async () => {
    rpc.mockResolvedValue({
      error: { code: "P0001", message: "That badge number is not available. Check it, or ask your supervisor." },
    });
    expect(await failureOf(linkMe(), "E999")).toMatch(/not available/i);
  });

  it("o crachá ambíguo também passa intacto", async () => {
    rpc.mockResolvedValue({
      error: { code: "P0001", message: "That badge number matches more than one record. Ask your supervisor." },
    });
    expect(await failureOf(linkMe(), "E045")).toMatch(/more than one record/i);
  });
});
