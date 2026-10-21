import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const rpc = vi.fn();
// A presenca so pergunta com token viva (ver `lib/liveSession`), por isso o mock do
// cliente tem de responder a `auth`. Estes testes sao sobre o que o ecra mostra, nao
// sobre a janela sem token: a sessao esta sa.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    auth: {
      getSession: async () => ({
        data: { session: { access_token: "jwt", expires_at: Math.floor(Date.now() / 1000) + 3600 } },
      }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u-me" } }) }));

import { usePresenceOf } from "./useCommunicationPresence";

const wrap = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

beforeEach(() => { rpc.mockReset(); });

describe("usePresenceOf", () => {
  it("asks the server and shows only the six words it understands", async () => {
    rpc.mockResolvedValue({ data: [
      { user_id: "a", status: "busy" }, { user_id: "b", status: "on_break" }, { user_id: "c", status: "offline" },
    ], error: null });
    const { result } = renderHook(() => usePresenceOf(["a", "b", "c"]), { wrapper: wrap() });
    await waitFor(() => expect(result.current.statuses.size).toBe(2));
    expect(result.current.statuses.get("a")).toBe("busy");
    expect(result.current.statuses.get("c")).toBe("offline");
    // A word it does not know is no dot, not a guess.
    expect(result.current.statuses.has("b")).toBe(false);
  });

  it("leaves out anybody the server did not answer for: not seen is not Offline", async () => {
    rpc.mockResolvedValue({ data: [{ user_id: "a", status: "online" }], error: null });
    const { result } = renderHook(() => usePresenceOf(["a", "hidden"]), { wrapper: wrap() });
    await waitFor(() => expect(result.current.statuses.size).toBe(1));
    expect(result.current.statuses.has("hidden")).toBe(false);
  });

  it("splits more than 300 people into several calls, each within the server's limit", async () => {
    rpc.mockImplementation(async (_fn: string, args: { p_user_ids: string[] }) => ({
      data: args.p_user_ids.map((id) => ({ user_id: id, status: "online" })), error: null,
    }));
    const ids = Array.from({ length: 650 }, (_, i) => `u${String(i).padStart(4, "0")}`);
    const { result } = renderHook(() => usePresenceOf(ids), { wrapper: wrap() });
    await waitFor(() => expect(result.current.statuses.size).toBe(650));
    expect(rpc).toHaveBeenCalledTimes(3);
    for (const c of rpc.mock.calls) {
      expect(c[0]).toBe("communication_presence_for");
      expect((c[1] as { p_user_ids: string[] }).p_user_ids.length).toBeLessThanOrEqual(300);
    }
  });

  it("asks nothing when there is nobody to ask about", async () => {
    const { result } = renderHook(() => usePresenceOf([null, undefined, ""]), { wrapper: wrap() });
    await new Promise((r) => setTimeout(r, 20));
    expect(rpc).not.toHaveBeenCalled();
    expect(result.current.statuses.size).toBe(0);
  });

  it("shows nothing, rather than a wrong status, when the server errors", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "nope" } });
    const { result } = renderHook(() => usePresenceOf(["a"]), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.statuses.size).toBe(0);
  });
});
