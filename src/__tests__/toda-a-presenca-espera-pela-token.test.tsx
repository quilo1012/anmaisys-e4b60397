import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

/**
 * A guarda da token vale para a familia toda, e nao so para o batimento.
 *
 * 21/10 fechou-se o `communication_touch_presence` no `PresenceHeartbeat` (#698). Nessa
 * mesma tarde o Root Diagnostics continuou a encher, e a mensagem mudou de nome:
 *
 *     19:15  /dashboard/my-overtime   employee   communication_my_availability   401/42501
 *     19:01  /dashboard/my-overtime   employee   communication_my_availability   401/42501
 *     18:03  /dashboard/my-attendance employee   communication_touch_presence    401/42501
 *
 * A correccao tinha ficado estreita. `useMyAvailability` e `usePresenceOf` vivem no mesmo
 * ficheiro, chamam a mesma familia de funcoes e corriam com `enabled: !!user` — o gate
 * exacto que o #698 tinha acabado de declarar insuficiente, porque o ramo degradado do
 * `AuthContext` repoe `user` E `session` sem haver token.
 *
 * Os dois tem `refetchInterval`, por isso nao era um 401 — era um por minuto, por aba.
 */

const rpc = vi.fn();
const getSession = vi.fn();
let authCallback: (() => void) | null = null;
const unsubscribe = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    auth: {
      getSession: () => getSession(),
      onAuthStateChange: (cb: () => void) => {
        authCallback = cb;
        return { data: { subscription: { unsubscribe } } };
      },
    },
  },
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "cb975de2-0000-4000-8000-000000000000" } }) }));

const { useMyAvailability, usePresenceOf } = await import("@/hooks/useCommunicationPresence");

const secondsFromNow = (s: number) => Math.floor(Date.now() / 1000) + s;
const viva = { data: { session: { access_token: "jwt", expires_at: secondsFromNow(3600) } } };

const wrap = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data: [], error: null });
  getSession.mockReset();
  authCallback = null;
  unsubscribe.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useMyAvailability", () => {
  it("pergunta quando ha token viva", async () => {
    getSession.mockResolvedValue(viva);
    renderHook(() => useMyAvailability(), { wrapper: wrap });
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("communication_my_availability"));
  });

  it("nao pergunta com o utilizador no contexto mas sem token", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    renderHook(() => useMyAvailability(), { wrapper: wrap });
    await new Promise((r) => setTimeout(r, 50));
    expect(rpc).not.toHaveBeenCalled();
  });

  it("nao pergunta com uma token ja expirada", async () => {
    getSession.mockResolvedValue({
      data: { session: { access_token: "velha", expires_at: secondsFromNow(-30) } },
    });
    renderHook(() => useMyAvailability(), { wrapper: wrap });
    await new Promise((r) => setTimeout(r, 50));
    expect(rpc).not.toHaveBeenCalled();
  });

  /** A janela fecha sem evento de auth nenhum, mas abre com um: um refresh que chegou. */
  it("passa a perguntar assim que a token e reposta", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    renderHook(() => useMyAvailability(), { wrapper: wrap });
    await new Promise((r) => setTimeout(r, 50));
    expect(rpc).not.toHaveBeenCalled();

    getSession.mockResolvedValue(viva);
    authCallback?.();
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("communication_my_availability"));
  });
});

describe("usePresenceOf", () => {
  const ids = ["11111111-1111-4111-8111-111111111111"];

  it("pergunta quando ha token viva", async () => {
    getSession.mockResolvedValue(viva);
    renderHook(() => usePresenceOf(ids), { wrapper: wrap });
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("communication_presence_for", { p_user_ids: ids }),
    );
  });

  it("nao pergunta sem token", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    renderHook(() => usePresenceOf(ids), { wrapper: wrap });
    await new Promise((r) => setTimeout(r, 50));
    expect(rpc).not.toHaveBeenCalled();
  });

  /** Continua a nao perguntar por ninguem quando a lista esta vazia, token ou nao. */
  it("nao pergunta por uma lista vazia", async () => {
    getSession.mockResolvedValue(viva);
    renderHook(() => usePresenceOf([]), { wrapper: wrap });
    await new Promise((r) => setTimeout(r, 50));
    expect(rpc).not.toHaveBeenCalled();
  });
});

// 25/10, 07:59 e 14:12, no Headcount board, como admin: `communication_my_availability`
// 42501 outra vez. O portao abre com token e so volta a olhar 30 s depois; um computador
// a acordar perde a token nesse intervalo, e o refetch do minuto saia so com a anon key.
// Agora cada pedido pergunta pela token no momento em que sai.
describe("a token perguntada no momento do pedido", () => {
  it("o portao aberto ha pouco nao chega: sem token agora, nao sai pedido nenhum", async () => {
    getSession.mockResolvedValue(viva);
    const { result } = renderHook(() => useMyAvailability(), { wrapper: wrap });
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    getSession.mockResolvedValue({ data: { session: null } });
    await result.current.refetch();
    expect(rpc).toHaveBeenCalledTimes(1);
    // e o que ja se sabia fica no ecra
    expect(result.current.data).toBeDefined();
  });

  it("o mesmo na presenca dos outros", async () => {
    getSession.mockResolvedValue(viva);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const own = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => usePresenceOf(["11111111-0000-4000-8000-000000000000"]), { wrapper: own });
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    getSession.mockResolvedValue({ data: { session: null } });
    await qc.refetchQueries();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(result.current.statuses).toBeInstanceOf(Map);
  });
});
