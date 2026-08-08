import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * The two writes that move somebody's position, and the record they have to leave.
 *
 * A crew and a rota are read back through `employee_shift_history` — `resolveShiftOn`
 * asks it for every date-aware question, including the one that decides whether today
 * is an ordinary day or overtime. Both of these hooks used to write only the columns
 * on `employees`, so a rota changed on the board was invisible to the rule it governs:
 * Josiley Rocon was moved to Fri–Mon days, his only history row still said Mon–Thu,
 * and his Saturday was saved as overtime while the dialog showed the new rota back to
 * the person who had just set it.
 */

// ── Mocks ───────────────────────────────────────────────────────────────────
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));

type Call = { table: string; op: "read" | "update" | "upsert"; payload: unknown; filters: Record<string, unknown> };
let calls: Call[] = [];
let employeeRow: { shift_group: string | null; shift_pattern_id: string | null } = {
  shift_group: "Day",
  shift_pattern_id: "mon-thu",
};

vi.mock("@/integrations/supabase/client", () => {
  function makeBuilder(table: string) {
    const filters: Record<string, unknown> = {};
    let op: Call["op"] = "read";
    let payload: unknown = null;
    const record = () => calls.push({ table, op, payload, filters });
    const builder: Record<string, unknown> = {};
    Object.assign(builder, {
      select: () => builder,
      eq: (c: string, v: unknown) => { filters[c] = v; return builder; },
      gte: (c: string, v: unknown) => { filters[`gte:${c}`] = v; return builder; },
      update: (p: unknown) => { op = "update"; payload = p; return builder; },
      upsert: (p: unknown) => { op = "upsert"; payload = p; return builder; },
      single: async () => { record(); return { data: employeeRow, error: null }; },
      maybeSingle: async () => { record(); return { data: employeeRow, error: null }; },
      then: (resolve: (r: unknown) => unknown) => { record(); return resolve({ data: [], error: null }); },
    });
    return builder;
  }
  return { supabase: { from: (t: string) => makeBuilder(t) } };
});

import { useSetShiftPattern, useChangeShift } from "./useHeadcount";

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const history = () => calls.filter((c) => c.table === "employee_shift_history" && c.op === "upsert");

beforeEach(() => {
  calls = [];
  employeeRow = { shift_group: "Day", shift_pattern_id: "mon-thu" };
});

describe("useSetShiftPattern", () => {
  it("records the new rota in the history the rota check reads", async () => {
    const { result } = renderHook(() => useSetShiftPattern("2026-08-08"), { wrapper: wrapper() });
    result.current.mutate({ employeeId: "josiley", patternId: "fri-mon" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(calls.some((c) => c.table === "employees" && c.op === "update")).toBe(true);
    expect(history()).toHaveLength(1);
    expect(history()[0].payload).toMatchObject({
      employee_id: "josiley",
      shift_pattern_id: "fri-mon",
      effective_from: "2026-08-08",
    });
  });

  it("carries the crew through, so the row does not blank it", () => {
    // The history row holds both halves of a position. Writing one and leaving the
    // other null would move the person to no crew at all on that date.
    return (async () => {
      employeeRow = { shift_group: "Night", shift_pattern_id: "mon-thu" };
      const { result } = renderHook(() => useSetShiftPattern("2026-08-08"), { wrapper: wrapper() });
      result.current.mutate({ employeeId: "josiley", patternId: "fri-mon" });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(history()[0].payload).toMatchObject({ shift_group: "Night" });
    })();
  });
});

describe("useChangeShift", () => {
  it("records the new crew in the history too", async () => {
    const { result } = renderHook(() => useChangeShift("2026-08-08"), { wrapper: wrapper() });
    result.current.mutate({ employeeId: "josiley", shiftGroup: "Night" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(history()).toHaveLength(1);
    expect(history()[0].payload).toMatchObject({
      employee_id: "josiley",
      shift_group: "Night",
      // The rota is untouched by a crew move, and has to survive the row.
      shift_pattern_id: "mon-thu",
      effective_from: "2026-08-08",
    });
  });

  it("still moves the days ahead onto the new board", async () => {
    const { result } = renderHook(() => useChangeShift("2026-08-08"), { wrapper: wrapper() });
    result.current.mutate({ employeeId: "josiley", shiftGroup: "Night" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const moved = calls.find((c) => c.table === "daily_allocations" && c.op === "update");
    expect(moved?.payload).toMatchObject({ shift: "Night" });
    expect(moved?.filters).toMatchObject({ "gte:on_date": "2026-08-08" });
  });
});
