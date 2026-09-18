import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

/**
 * Um heartbeat sem token viva nao e inofensivo — e um RLS_ERROR de hora a hora.
 *
 * `touch_last_seen()` tem EXECUTE so para `authenticated`; `anon` foi revogado de
 * proposito (20260916090000). Quando o pedido chega ao PostgREST sem JWT valido,
 * o papel resolvido e `anon`, o Postgres devolve 42501 e o PostgREST embrulha-o
 * em **401** — e nao 403, que e o que devolveria a um utilizador autenticado sem
 * privilegio. Os cinco registos de 17/09 (09:32, 14:21, 16:19, 19:16, 23:11, todos
 * do mesmo engineer) trazem exactamente `{"code":"42501","status":401}`: nao e a
 * concessao que falta, e a token que ja tinha expirado quando o intervalo de 30
 * segundos disparou.
 *
 * Esparsos e nao continuos porque a janela e curta: o auto-refresh do supabase-js
 * chega logo a seguir e a batida seguinte passa. Por isso ninguem perde o
 * `last_seen_at` — perde-se so o silencio do Root Diagnostics.
 *
 * O `logAuditEvent` ja resolvia isto assim, pela mesma razao, e e esse o molde:
 * pedir a sessao antes (o supabase-js renova-a aqui se conseguir) e nao bater
 * quando nao ha nenhuma, ou quando a que devolve ja expirou.
 */

const rpc = vi.fn();
const getSession = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    auth: { getSession: () => getSession() },
  },
}));

let auth: { user: { id: string } | null; role: string | null } = {
  user: { id: "0ef22aa0-a83c-48bc-8256-b65a03851fec" },
  role: "engineer",
};
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));

const { useHeartbeat } = await import("@/hooks/useHeartbeat");

const secondsFromNow = (s: number) => Math.floor(Date.now() / 1000) + s;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  rpc.mockReset().mockResolvedValue({ data: null, error: null });
  getSession.mockReset();
  auth = { user: { id: "0ef22aa0-a83c-48bc-8256-b65a03851fec" }, role: "engineer" };
});

afterEach(() => {
  vi.useRealTimers();
});

describe("o heartbeat do engineer", () => {
  it("bate quando a sessao esta viva", async () => {
    getSession.mockResolvedValue({
      data: { session: { access_token: "jwt", expires_at: secondsFromNow(3600) } },
    });

    renderHook(() => useHeartbeat());

    await waitFor(() => expect(rpc).toHaveBeenCalledWith("touch_last_seen"));
  });

  it("nao bate quando ja nao ha sessao nenhuma", async () => {
    getSession.mockResolvedValue({ data: { session: null } });

    renderHook(() => useHeartbeat());

    await vi.advanceTimersByTimeAsync(100);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("nao bate com uma token ja expirada — e dai que vinha o 42501/401", async () => {
    // O que o supabase-js devolve quando o refresh ainda nao chegou: a sessao
    // guardada, com `expires_at` no passado. Enviada, volta como `anon`.
    getSession.mockResolvedValue({
      data: { session: { access_token: "jwt-velha", expires_at: secondsFromNow(-30) } },
    });

    renderHook(() => useHeartbeat());

    await vi.advanceTimersByTimeAsync(100);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("nao pergunta sequer pela sessao a quem nao e engineer", async () => {
    auth = { user: { id: "u" }, role: "admin" };
    getSession.mockResolvedValue({
      data: { session: { access_token: "jwt", expires_at: secondsFromNow(3600) } },
    });

    renderHook(() => useHeartbeat());

    await vi.advanceTimersByTimeAsync(100);
    expect(getSession).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});
