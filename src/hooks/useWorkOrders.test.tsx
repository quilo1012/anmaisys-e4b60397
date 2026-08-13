import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * How an engineer's action reaches `work_order_logs`.
 *
 * The same action arriving twice — a double tap, a retry after a slow reply — is one
 * fact, not an error, and `idx_work_order_logs_unique_action` is the partial index that
 * says so for accept/start/finish/machine_back_to_work/started/finished.
 *
 * Two attempts to write through that index failed, and both failed on the wire, which
 * is what the fetch interceptor files as a fault:
 *
 *   - `onConflict: "work_order_id,engineer_id,action"` → 42P10. Postgres cannot infer a
 *     PARTIAL index from a conflict target carrying no matching predicate.
 *   - `.upsert(row, { ignoreDuplicates: true })` with no target → 23505. PostgREST does
 *     not emit a bare `ON CONFLICT DO NOTHING`; it defaults the target to the primary
 *     key and emits `ON CONFLICT("id") DO NOTHING`, which can never fire because `id`
 *     is generated per request. pg_stat_statements has the statement it ran.
 *
 * A conflict target with no predicate cannot name that index, so no table write can be
 * idempotent here. `log_wo_action` is a function, and a function can say
 * `ON CONFLICT DO NOTHING` — no target, satisfied by any constraint, and atomic, so two
 * taps racing each other still cost nothing. These tests hold the write to that route.
 */

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

type TableCall = { table: string; op: "read" | "insert" | "upsert" | "update" | "delete"; payload?: unknown; options?: unknown };
type RpcCall = { fn: string; args: unknown };

let tableCalls: TableCall[] = [];
let rpcCalls: RpcCall[] = [];

vi.mock("@/integrations/supabase/client", () => {
  function makeBuilder(table: string) {
    const rec: TableCall = { table, op: "read" };
    const finish = (single: boolean) => {
      tableCalls.push(rec);
      const row = { id: "wo-1", status: "received", engineer_id: "eng-1" };
      return { data: single ? row : [row], error: null };
    };
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => b,
      eq: () => b,
      in: () => b,
      order: () => b,
      limit: () => b,
      insert: (p: unknown, o?: unknown) => { rec.op = "insert"; rec.payload = p; rec.options = o; return b; },
      upsert: (p: unknown, o?: unknown) => { rec.op = "upsert"; rec.payload = p; rec.options = o; return b; },
      update: (p: unknown) => { rec.op = "update"; rec.payload = p; return b; },
      delete: () => { rec.op = "delete"; return b; },
      maybeSingle: async () => finish(true),
      single: async () => finish(true),
      then: (resolve: (r: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(finish(false)).then(resolve, reject),
    });
    return b;
  }
  return {
    supabase: {
      from: (t: string) => makeBuilder(t),
      rpc: async (fn: string, args: unknown) => {
        rpcCalls.push({ fn, args });
        return { data: null, error: null };
      },
      auth: {
        getUser: async () => ({ data: { user: { id: "auth-uid" } }, error: null }),
        // No session: logAuditEvent returns before reaching the edge function.
        getSession: async () => ({ data: { session: null }, error: null }),
      },
      channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
      removeChannel: () => {},
    },
  };
});

import { useArriveWorkOrder } from "./useWorkOrders";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

async function arrive() {
  const { result } = renderHook(() => useArriveWorkOrder(), { wrapper });
  result.current.mutate({ woId: "wo-1", engineerId: "eng-1", engineerName: "Ana" });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
}

describe("logging a work-order action", () => {
  beforeEach(() => {
    tableCalls = [];
    rpcCalls = [];
  });

  it("writes through log_wo_action, carrying the order, the engineer and the action", async () => {
    await arrive();

    const call = rpcCalls.find((c) => c.fn === "log_wo_action");
    expect(call).toBeDefined();
    expect(call?.args).toMatchObject({
      p_work_order_id: "wo-1",
      p_engineer_id: "eng-1",
      p_engineer_name: "Ana",
      p_action: "arrived",
    });
  });

  it("never POSTs to the work_order_logs table, where no conflict target can name the partial index", async () => {
    await arrive();

    const direct = tableCalls.filter((c) => c.table === "work_order_logs" && c.op !== "read");
    expect(direct).toEqual([]);
  });
});
