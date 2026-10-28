import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const rpc = vi.fn();
const removeChannel = vi.fn();
let onChange: (() => void) | null = null;
const channelObj: { on: (...a: unknown[]) => typeof channelObj; subscribe: () => typeof channelObj } = {
  on: (_t: unknown, _f: unknown, cb: unknown) => { onChange = cb as () => void; return channelObj; },
  subscribe: () => channelObj,
};
const getSession = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => ({ setHeader: () => rpc(...a) }),
    auth: { getSession: () => getSession() },
    channel: () => channelObj,
    removeChannel: (...a: unknown[]) => removeChannel(...a),
  },
}));
let user: { id: string } | null = { id: "u-me" };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user }) }));
let tablet = false;
vi.mock("@/lib/sharedTabletSession", () => ({ isSharedTabletSession: () => tablet }));

import { PresenceHeartbeat, presenceTabId } from "./PresenceHeartbeat";
import { PRESENCE_HEARTBEAT_MS } from "@/lib/communicationPresence";

const calls = (fn: string) => rpc.mock.calls.filter((c) => c[0] === fn);
const mount = () => {
  const qc = new QueryClient();
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  const view = render(<QueryClientProvider client={qc}><PresenceHeartbeat /></QueryClientProvider>);
  return { ...view, invalidate };
};

beforeEach(() => {
  vi.useFakeTimers();
  rpc.mockReset(); rpc.mockResolvedValue({ data: null, error: null });
  // A presenca so bate com token viva — ver `aPresencaNaoBateSemTokenViva`. Estes
  // testes sao sobre o ritmo e o alcance do batimento, por isso a sessao esta sa.
  getSession.mockReset();
  getSession.mockResolvedValue({
    data: { session: { access_token: "jwt", expires_at: Math.floor(Date.now() / 1000) + 3600 } },
  });
  removeChannel.mockReset(); onChange = null; user = { id: "u-me" }; tablet = false;
  try { sessionStorage.clear(); } catch { /* ignore */ }
});

/** O batimento espera agora pela sessao antes da RPC: mais do que um microtask. */
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
afterEach(() => { vi.useRealTimers(); });

describe("PresenceHeartbeat", () => {
  it("says this tab is open at once, then every 60 seconds, always with the same tab id", async () => {
    mount();
    await act(async () => { await flush(); });
    expect(calls("communication_touch_presence")).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(PRESENCE_HEARTBEAT_MS * 3); });
    const touches = calls("communication_touch_presence");
    expect(touches).toHaveLength(4);
    expect(new Set(touches.map((c) => (c[1] as { p_tab_id: string }).p_tab_id)).size).toBe(1);
    expect(Object.keys(touches[0][1] as object)).toEqual(["p_tab_id"]);   // no user id, no status: only the tab
  });

  it("never sends the person's choice: connecting cannot overwrite it", async () => {
    mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(PRESENCE_HEARTBEAT_MS * 2); });
    expect(calls("communication_set_availability")).toHaveLength(0);
  });

  it("ends only its own tab's lease when the page is hidden for good", async () => {
    mount();
    await act(async () => { await flush(); });
    window.dispatchEvent(new Event("pagehide"));
    // O fim da concessao espera agora pela sessao, por isso ja nao parte no mesmo
    // tick do evento. Ver a nota sobre `pagehide` no componente: e de proposito, e a
    // concessao de 180 s e a rede de seguranca quando o browser nao da tempo.
    await act(async () => { await flush(); });
    const ended = calls("communication_end_presence");
    expect(ended).toHaveLength(1);
    expect((ended[0][1] as { p_tab_id: string }).p_tab_id).toBe(presenceTabId());
  });

  it("beats again at once when the device comes back online", async () => {
    mount();
    await act(async () => { await flush(); });
    window.dispatchEvent(new Event("online"));
    await act(async () => { await flush(); });
    expect(calls("communication_touch_presence")).toHaveLength(2);
  });

  it("keeps going after a failed beat", async () => {
    rpc.mockRejectedValueOnce(new Error("offline"));
    mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(PRESENCE_HEARTBEAT_MS); });
    expect(calls("communication_touch_presence").length).toBeGreaterThanOrEqual(2);
  });

  it("re-reads the list when Realtime says somebody changed, once for a burst", async () => {
    const { invalidate } = mount();
    await act(async () => { await flush(); });
    invalidate.mockClear();
    act(() => { onChange?.(); onChange?.(); onChange?.(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    const keys = invalidate.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown[] }).queryKey));
    expect(keys.filter((k) => k.includes("communication_presence"))).toHaveLength(1);
  });

  it("stops on unmount without ending the lease (a page change is not leaving)", async () => {
    const { unmount } = mount();
    await act(async () => { await flush(); });
    unmount();
    expect(removeChannel).toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(PRESENCE_HEARTBEAT_MS * 2); });
    expect(calls("communication_touch_presence")).toHaveLength(1);
    expect(calls("communication_end_presence")).toHaveLength(0);
  });

  it("does nothing for a shared line tablet, or when nobody is signed in", async () => {
    tablet = true;
    mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(PRESENCE_HEARTBEAT_MS * 2); });
    expect(rpc).not.toHaveBeenCalled();
    tablet = false; user = null;
    mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(PRESENCE_HEARTBEAT_MS * 2); });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("presenceTabId", () => {
  it("is stable inside a tab and a valid uuid", () => {
    const a = presenceTabId(); const b = presenceTabId();
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });
  it("still returns an id when storage is blocked", () => {
    const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(presenceTabId(blocked)).toMatch(/^[0-9a-f-]{36}$/i);
  });
});
