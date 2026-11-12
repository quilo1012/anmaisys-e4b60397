import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Auditoria 11/11, P0-3 / PERF-005: as duas batidas de escrita continuavam com o
 * separador escondido (telemoveis com a app em segundo plano, separadores esquecidos).
 * A base de producao e uma Micro de 1 GB, e `touch_last_seen` escreve em `profiles`,
 * que esta na publicacao do realtime.
 *
 *  - Escondido: nenhuma batida. A concessao de presenca (180 s no servidor) expira e a
 *    pessoa passa a Offline, que e o significado certo de "online".
 *  - Volta a visivel: uma batida logo.
 *  - `touch_last_seen` passa de 30 s para 3 min.
 */

const rpc = vi.fn();
const getSession = vi.fn();
const channelObj: { on: () => typeof channelObj; subscribe: () => typeof channelObj } = {
  on: () => channelObj,
  subscribe: () => channelObj,
};
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    // PresenceHeartbeat passa por authenticatedRpc (setHeader); useHeartbeat chama rpc direto.
    rpc: (...a: unknown[]) => {
      const p = rpc(...a);
      return Object.assign(Promise.resolve(p), { setHeader: () => p });
    },
    auth: { getSession: () => getSession() },
    channel: () => channelObj,
    removeChannel: () => {},
  },
}));
let auth: { user: { id: string } | null; role: string | null } = { user: { id: "u-me" }, role: "engineer" };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("@/lib/sharedTabletSession", () => ({ isSharedTabletSession: () => false }));

import { PresenceHeartbeat } from "@/components/chat/PresenceHeartbeat";
import { useHeartbeat, LAST_SEEN_HEARTBEAT_MS } from "@/hooks/useHeartbeat";
import { PRESENCE_HEARTBEAT_MS } from "@/lib/communicationPresence";

let visibility: DocumentVisibilityState = "visible";
const setVisibility = (v: DocumentVisibilityState) => {
  visibility = v;
  document.dispatchEvent(new Event("visibilitychange"));
};
const calls = (fn: string) => rpc.mock.calls.filter((c) => c[0] === fn);
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  visibility = "visible";
  rpc.mockReset(); rpc.mockResolvedValue({ data: null, error: null });
  getSession.mockReset();
  getSession.mockResolvedValue({
    data: {
      session: {
        access_token: `header.${btoa(JSON.stringify({ session_id: "real-session" }))}.signature`,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      },
    },
  });
  auth = { user: { id: "u-me" }, role: "engineer" };
  try { sessionStorage.clear(); } catch { /* ignore */ }
});
afterEach(() => { vi.useRealTimers(); });

const mountPresence = () => {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}><PresenceHeartbeat /></QueryClientProvider>);
};

describe("PresenceHeartbeat so bate com o ecra visivel", () => {
  it("nao bate enquanto o separador esta escondido", async () => {
    mountPresence();
    await act(async () => { await flush(); });
    expect(calls("communication_touch_presence")).toHaveLength(1);
    act(() => { setVisibility("hidden"); });
    await act(async () => { await vi.advanceTimersByTimeAsync(PRESENCE_HEARTBEAT_MS * 5); });
    expect(calls("communication_touch_presence")).toHaveLength(1);
  });

  it("nao bate ao montar num separador ja escondido, nem com 'online'/'pageshow'", async () => {
    visibility = "hidden";
    mountPresence();
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("pageshow"));
    await act(async () => { await vi.advanceTimersByTimeAsync(PRESENCE_HEARTBEAT_MS * 3); });
    expect(calls("communication_touch_presence")).toHaveLength(0);
  });

  it("bate uma vez logo ao voltar a visivel, e retoma o ritmo", async () => {
    visibility = "hidden";
    mountPresence();
    await act(async () => { await vi.advanceTimersByTimeAsync(PRESENCE_HEARTBEAT_MS * 2); });
    expect(calls("communication_touch_presence")).toHaveLength(0);
    act(() => { setVisibility("visible"); });
    await act(async () => { await flush(); });
    expect(calls("communication_touch_presence")).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(PRESENCE_HEARTBEAT_MS); });
    expect(calls("communication_touch_presence")).toHaveLength(2);
  });
});

describe("touch_last_seen: de 3 em 3 minutos, so com o ecra visivel", () => {
  it("o ritmo e 3 minutos", async () => {
    expect(LAST_SEEN_HEARTBEAT_MS).toBe(180_000);
    renderHook(() => useHeartbeat());
    await act(async () => { await flush(); });
    expect(calls("touch_last_seen")).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(179_000); });
    expect(calls("touch_last_seen")).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(calls("touch_last_seen")).toHaveLength(2);
  });

  it("nao bate escondido; bate uma vez ao voltar a visivel", async () => {
    visibility = "hidden";
    renderHook(() => useHeartbeat());
    await act(async () => { await vi.advanceTimersByTimeAsync(LAST_SEEN_HEARTBEAT_MS * 4); });
    expect(calls("touch_last_seen")).toHaveLength(0);
    act(() => { setVisibility("visible"); });
    await act(async () => { await flush(); });
    expect(calls("touch_last_seen")).toHaveLength(1);
    act(() => { setVisibility("hidden"); });
    await act(async () => { await vi.advanceTimersByTimeAsync(LAST_SEEN_HEARTBEAT_MS * 2); });
    expect(calls("touch_last_seen")).toHaveLength(1);
  });
});
