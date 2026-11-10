import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * What one open work-order screen costs the database.
 *
 * Every refetch used to re-read both name lists, and every mount of useWorkOrders
 * opened its own unfiltered realtime channel on `work_orders`. These tests hold the
 * read count: the names once per five minutes, one channel however many mounts, and
 * one invalidation per burst of realtime events.
 */

let rpcCalls: string[] = [];
let woReads = 0;
let channelsOpened = 0;
let channelsRemoved = 0;
let handlers: Array<() => void> = [];

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u-1" } }) }));

vi.mock("@/lib/authenticatedRpc", () => ({
  authenticatedRpc: async (fn: string) => {
    rpcCalls.push(fn);
    return { data: [{ id: "eng-1", name: "Engineer One" }], error: null };
  },
}));

vi.mock("@/integrations/supabase/client", () => {
  const builder = () => {
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => b, order: () => b, neq: () => b, eq: () => b, in: () => b, gte: () => b, lte: () => b,
      limit: () => b, range: () => b,
      then: (resolve: (r: unknown) => unknown) => {
        woReads += 1;
        return Promise.resolve({
          data: [{ id: "wo-1", operator_id: "op-1", engineer_id: "eng-1", engineer_name: null, closed_by: null, requester_name: "R" }],
          error: null,
        }).then(resolve);
      },
    });
    return b;
  };
  return {
    supabase: {
      from: () => builder(),
      rpc: async (fn: string) => {
        rpcCalls.push(fn);
        return { data: [{ id: "op-1", name: "Operator One" }], error: null };
      },
      channel: () => {
        channelsOpened += 1;
        const ch = {
          on: (_e: string, _f: unknown, cb: () => void) => { handlers.push(cb); return ch; },
          subscribe: () => ch,
        };
        return ch;
      },
      removeChannel: () => { channelsRemoved += 1; },
    },
  };
});

import { useWorkOrders } from "./useWorkOrders";

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

beforeEach(() => {
  rpcCalls = [];
  woReads = 0;
  channelsOpened = 0;
  channelsRemoved = 0;
  handlers = [];
});
afterEach(() => vi.useRealTimers());

describe("useWorkOrders load", () => {
  it("resolves names, and a refetch does not read the name lists again", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useWorkOrders(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].operator?.name).toBe("Operator One");
    expect(result.current.data?.[0].engineer?.name).toBe("Engineer One");

    await act(async () => { await result.current.refetch(); });
    expect(woReads).toBe(2);
    expect(rpcCalls.filter((f) => f === "list_active_profile_names")).toHaveLength(1);
    expect(rpcCalls.filter((f) => f === "list_engineer_names")).toHaveLength(1);
  });

  it("opens one channel for several mounts and closes it with the last", () => {
    const { wrapper } = setup();
    const a = renderHook(() => useWorkOrders(), { wrapper });
    const b = renderHook(() => useWorkOrders({ statusIn: ["open"] }), { wrapper });
    const c = renderHook(() => useWorkOrders({ lineId: "l-1" }), { wrapper });
    expect(channelsOpened).toBe(1);
    a.unmount();
    b.unmount();
    expect(channelsRemoved).toBe(0);
    c.unmount();
    expect(channelsRemoved).toBe(1);
  });

  it("folds a burst of realtime events into one invalidation", async () => {
    const { qc, wrapper } = setup();
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { unmount } = renderHook(() => useWorkOrders(), { wrapper });
    vi.useFakeTimers();
    for (let i = 0; i < 25; i++) handlers.forEach((h) => h());
    expect(spy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ queryKey: ["work_orders"] });
    unmount();
  });
});
