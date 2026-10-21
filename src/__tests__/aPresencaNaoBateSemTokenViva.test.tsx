import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

/**
 * A presenca nao bate sem token viva — o mesmo molde do `useHeartbeat`.
 *
 * `communication_touch_presence()` tem EXECUTE so para `authenticated`, e defende-se
 * outra vez por dentro: `raise exception` quando falta o `session_id` no JWT. Uma
 * batida enviada sem token resolve o papel `anon`, apanha 42501, e o PostgREST
 * embrulha-o em **401** — nao 403, que e o que daria a um utilizador autenticado sem
 * privilegio. Chega ao Root Diagnostics como RLS_ERROR sem ter nada de RLS.
 *
 * 21/10 12:08, `/signup`, um admin: `{"code":"42501","status":401}` com `user_id` e
 * `role` conhecidos no registo. O `user` estava preenchido e a token nao existia.
 *
 * E como e que as duas coisas se separam: em `AuthContext`, o ramo de SIGNED_OUT
 * implicito que corre quando o `setSession()` imediatamente acima falhou faz na mesma
 * `setUser(lastSession.user)`. A pessoa fica ligada **so no estado do React** enquanto
 * o cliente ja nao tem token. Gatear por `user` — ou por `session`, que esse ramo
 * tambem repoe — nao chega. So `getSession()` responde, e renova de caminho quando
 * consegue.
 */

const rpc = vi.fn();
const getSession = vi.fn();
const channel = {
  on: () => channel,
  subscribe: () => channel,
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    auth: { getSession: () => getSession() },
    channel: () => channel,
    removeChannel: () => {},
  },
}));

let auth: { user: { id: string } | null } = { user: { id: "c928617c-1321-471b-a734-8d7e3a8204ee" } };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));

vi.mock("@/lib/sharedTabletSession", () => ({ isSharedTabletSession: () => shared }));
let shared = false;

const { PresenceHeartbeat } = await import("@/components/chat/PresenceHeartbeat");

const secondsFromNow = (s: number) => Math.floor(Date.now() / 1000) + s;

const wrap = (children: ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

const touches = () => rpc.mock.calls.filter((c) => c[0] === "communication_touch_presence");

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  rpc.mockReset().mockResolvedValue({ data: null, error: null });
  getSession.mockReset();
  auth = { user: { id: "c928617c-1321-471b-a734-8d7e3a8204ee" } };
  shared = false;
  sessionStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("o batimento de presenca", () => {
  it("bate quando a sessao esta viva", async () => {
    getSession.mockResolvedValue({
      data: { session: { access_token: "jwt", expires_at: secondsFromNow(3600) } },
    });

    render(wrap(<PresenceHeartbeat />));

    await waitFor(() => expect(touches()).toHaveLength(1));
  });

  /**
   * O caso de 21/10: `user` preenchido pelo ramo degradado do AuthContext, e o
   * cliente sem token nenhuma. Antes desta guarda, isto era um 401 por minuto.
   */
  it("nao bate com o utilizador no contexto mas sem sessao no cliente", async () => {
    getSession.mockResolvedValue({ data: { session: null } });

    render(wrap(<PresenceHeartbeat />));

    await vi.advanceTimersByTimeAsync(200);
    expect(touches()).toHaveLength(0);
  });

  it("nao bate com uma token ja expirada — e dai que vinha o 42501/401", async () => {
    // O que o supabase-js devolve quando o refresh ainda nao chegou: a sessao
    // guardada, com `expires_at` no passado. Enviada, volta como `anon`.
    getSession.mockResolvedValue({
      data: { session: { access_token: "jwt-velha", expires_at: secondsFromNow(-30) } },
    });

    render(wrap(<PresenceHeartbeat />));

    await vi.advanceTimersByTimeAsync(200);
    expect(touches()).toHaveLength(0);
  });

  it("volta a bater assim que a token e reposta", async () => {
    getSession.mockResolvedValueOnce({ data: { session: null } }).mockResolvedValue({
      data: { session: { access_token: "jwt-nova", expires_at: secondsFromNow(3600) } },
    });

    render(wrap(<PresenceHeartbeat />));

    await vi.advanceTimersByTimeAsync(200);
    expect(touches()).toHaveLength(0);

    // O intervalo do batimento e de 60 s; a batida seguinte apanha a token nova.
    await vi.advanceTimersByTimeAsync(60_000);
    await waitFor(() => expect(touches()).toHaveLength(1));
  });

  it("nao pergunta sequer pela sessao num tablet partilhado", async () => {
    shared = true;
    getSession.mockResolvedValue({
      data: { session: { access_token: "jwt", expires_at: secondsFromNow(3600) } },
    });

    render(wrap(<PresenceHeartbeat />));

    await vi.advanceTimersByTimeAsync(200);
    expect(getSession).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});
