import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * An update that changes nothing and says it worked.
 *
 * `setRequestStatus` wrote `.update(patch).eq("id", id)` and threw only on `error`.
 * Under RLS that is not enough: `overtime_requests_manage` is gated on
 * `can_manage_overtime`, and a caller without it does not get an error — PostgREST
 * matches no rows, returns 204, and the mutation resolves. `onSuccess` ran, the
 * queries refetched, and the ask came back exactly as it was.
 *
 * So pressing "Cancel ask" looked like a dead button, and the one thing it could not
 * do was tell anybody why. Asking for the row back is what turns silence into an
 * answer: no row means the write did not happen, whatever the status code said.
 */

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));

/** Rows the fake PostgREST hands back from an update. Empty = RLS matched nothing. */
let updateReturns: unknown[] = [];

vi.mock("@/integrations/supabase/client", () => {
  function builder() {
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => b,
      eq: () => b,
      gte: () => b,
      order: () => b,
      update: () => b,
      upsert: () => b,
      insert: () => b,
      maybeSingle: async () => ({ data: null, error: null }),
      // Awaiting the builder is the request. `select()` after `update()` makes the
      // rows the resolved value, which is the whole point of the fix.
      then: (resolve: (r: unknown) => unknown) => resolve({ data: updateReturns, error: null }),
    });
    return b;
  }
  return { supabase: { from: () => builder(), rpc: async () => ({ data: null, error: null }) } };
});

import { useOvertimeMutations } from "./useOvertimeRequests";

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => { updateReturns = []; });

describe("setRequestStatus", () => {
  it("fails when the write changed no row, because RLS says nothing out loud", async () => {
    updateReturns = [];
    const { result } = renderHook(() => useOvertimeMutations(), { wrapper: wrapper() });
    result.current.setRequestStatus.mutate({ id: "ask-1", status: "cancelled" });

    await waitFor(() => expect(result.current.setRequestStatus.isError).toBe(true));
    expect((result.current.setRequestStatus.error as Error).message).toMatch(/permission|not allowed|cannot/i);
  });

  it("succeeds when the row comes back", async () => {
    updateReturns = [{ id: "ask-1" }];
    const { result } = renderHook(() => useOvertimeMutations(), { wrapper: wrapper() });
    result.current.setRequestStatus.mutate({ id: "ask-1", status: "cancelled" });

    await waitFor(() => expect(result.current.setRequestStatus.isSuccess).toBe(true));
  });
});
