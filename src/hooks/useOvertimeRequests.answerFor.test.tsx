import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * A yes taken at the desk, on a database without the snapshot columns.
 *
 * `answered_for_*` arrive with block 87. Production did not have them on 18/10, and
 * PostgREST refuses a whole body that names an unknown column (PGRST204), so "Add"
 * failed for every supervisor. The yes is the thing being recorded; it is written
 * again without the snapshot rather than lost.
 */

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));

const upserts: Record<string, unknown>[] = [];
let missingColumns = true;

vi.mock("@/integrations/supabase/client", () => {
  function builder() {
    let result: unknown = { data: [], error: null };
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => b, eq: () => b, gte: () => b, order: () => b, update: () => b, insert: () => b,
      upsert: (row: Record<string, unknown>) => {
        upserts.push(row);
        result = missingColumns && "answered_for_date" in row
          ? { data: null, error: { code: "PGRST204", message: "Could not find the 'answered_for_date' column of 'overtime_responses' in the schema cache" } }
          : { data: null, error: null };
        return b;
      },
      maybeSingle: async () => ({ data: null, error: null }),
      then: (resolve: (r: unknown) => unknown) => resolve(result),
    });
    return b;
  }
  return { supabase: { from: () => builder(), rpc: async () => ({ data: null, error: null }) } };
});

import { useOvertimeMutations } from "./useOvertimeRequests";

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => { upserts.length = 0; missingColumns = true; });

const window = { on_date: "2026-10-20", starts_at: "06:00:00", ends_at: "18:00:00" };

describe("answerFor", () => {
  it("records the yes without the snapshot when the database has no snapshot columns", async () => {
    const { result } = renderHook(() => useOvertimeMutations(), { wrapper: wrapper() });
    result.current.answerFor.mutate({ requestId: "r", employeeId: "e", window });
    await waitFor(() => expect(result.current.answerFor.isSuccess).toBe(true));
    expect(upserts).toHaveLength(2);
    expect(upserts[1]).not.toHaveProperty("answered_for_date");
    expect(upserts[1]).toMatchObject({ request_id: "r", employee_id: "e", answer: "yes" });
  });

  it("writes once, with the snapshot, when the columns are there", async () => {
    missingColumns = false;
    const { result } = renderHook(() => useOvertimeMutations(), { wrapper: wrapper() });
    result.current.answerFor.mutate({ requestId: "r", employeeId: "e", window });
    await waitFor(() => expect(result.current.answerFor.isSuccess).toBe(true));
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({ answered_for_date: "2026-10-20" });
  });
});
