import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ── Mocks ───────────────────────────────────────────────────────────────────
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

type Row = {
  id: string;
  line: string;
  plan_qty: number;
  actual_qty: number;
  entry_date?: string;
  shift?: string;
};
let mockRows: Row[] = [];
let mockError: any = null;
const lastFilters: { entry_date?: string; shift?: string } = {};

vi.mock("@/integrations/supabase/client", () => {
  function makeBuilder() {
    const filters: Record<string, string> = {};
    const builder: any = {
      select: vi.fn(() => builder),
      eq: vi.fn((col: string, val: string) => {
        filters[col] = val;
        if (col === "entry_date") lastFilters.entry_date = val;
        if (col === "shift") lastFilters.shift = val;
        return builder;
      }),
      then: (resolve: any) => {
        if (mockError) return resolve({ data: null, error: mockError });
        // Only apply date/shift filters if the row actually declares them,
        // so pre-existing tests that omit those fields keep working.
        const rows = mockRows.filter((r) => {
          if (r.entry_date != null && filters.entry_date && r.entry_date !== filters.entry_date)
            return false;
          if (r.shift != null && filters.shift && r.shift !== filters.shift) return false;
          return true;
        });
        return resolve({ data: rows, error: null });
      },
    };
    return builder;
  }
  return {
    supabase: {
      from: vi.fn(() => makeBuilder()),
    },
  };
});

import { useLineShiftTarget } from "./useLineShiftTarget";

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  mockRows = [];
  mockError = null;
  lastFilters.entry_date = undefined;
  lastFilters.shift = undefined;
});

describe("useLineShiftTarget", () => {
  it("sums plan_qty/actual_qty across rows matching the line (case/space-insensitive)", async () => {
    mockRows = [
      { id: "r1", line: "Line 1", plan_qty: 100, actual_qty: 40 },
      { id: "r2", line: "line1", plan_qty: 50, actual_qty: 20 },
      { id: "r3", line: "Line 2", plan_qty: 999, actual_qty: 999 },
    ];
    const { result } = renderHook(
      () => useLineShiftTarget({ line: "Line 1", date: "2026-07-16", shift: "DAY" }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.target).toBe(150);
    expect(result.current.actual).toBe(60);
    expect(result.current.gap).toBe(90);
    expect(result.current.rowId).toBeNull(); // >1 match → null
    expect(result.current.data).toBe(150); // alias
  });

  it("returns rowId when exactly one row matches", async () => {
    mockRows = [
      { id: "only", line: "Line 3", plan_qty: 200, actual_qty: 200 },
      { id: "other", line: "Line 9", plan_qty: 1, actual_qty: 1 },
    ];
    const { result } = renderHook(
      () => useLineShiftTarget({ line: "Line 3", date: "2026-07-16", shift: "NIGHT" }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.rowId).toBe("only");
    expect(result.current.target).toBe(200);
    expect(result.current.actual).toBe(200);
    expect(result.current.gap).toBe(0); // clamped, actual >= target
  });

  it("clamps gap to 0 when actual exceeds target", async () => {
    mockRows = [{ id: "r", line: "L1", plan_qty: 10, actual_qty: 25 }];
    const { result } = renderHook(
      () => useLineShiftTarget({ line: "L1", date: "2026-07-16", shift: "DAY" }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.gap).toBe(0);
  });

  it("returns zeros when no rows match the requested line", async () => {
    mockRows = [{ id: "r", line: "Other", plan_qty: 100, actual_qty: 50 }];
    const { result } = renderHook(
      () => useLineShiftTarget({ line: "Line 1", date: "2026-07-16", shift: "DAY" }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.target).toBe(0);
    expect(result.current.actual).toBe(0);
    expect(result.current.gap).toBe(0);
    expect(result.current.rowId).toBeNull();
  });

  it("filters by the requested date and shift", async () => {
    mockRows = [{ id: "r", line: "Line 1", plan_qty: 10, actual_qty: 0 }];
    const { result } = renderHook(
      () => useLineShiftTarget({ line: "Line 1", date: "2026-08-01", shift: "NIGHT" }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(lastFilters.entry_date).toBe("2026-08-01");
    expect(lastFilters.shift).toBe("NIGHT");
  });

  it("honors a custom matchLine predicate", async () => {
    mockRows = [
      { id: "a", line: "L-01 Bakery", plan_qty: 30, actual_qty: 10 },
      { id: "b", line: "L-02 Bakery", plan_qty: 70, actual_qty: 20 },
    ];
    const { result } = renderHook(
      () =>
        useLineShiftTarget({
          line: "L-01",
          date: "2026-07-16",
          shift: "DAY",
          matchLine: (rowLine) => (rowLine ?? "").startsWith("L-01"),
        }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.target).toBe(30);
    expect(result.current.actual).toBe(10);
    expect(result.current.gap).toBe(20);
    expect(result.current.rowId).toBe("a");
  });

  it("does not fire the query when line/date/shift are missing", async () => {
    const { result } = renderHook(
      () => useLineShiftTarget({ line: null, date: "2026-07-16", shift: "DAY" }),
      { wrapper: wrapper() },
    );
    // Still returns safe defaults immediately
    expect(result.current.target).toBe(0);
    expect(result.current.actual).toBe(0);
    expect(result.current.gap).toBe(0);
    expect(result.current.rowId).toBeNull();
    expect(lastFilters.entry_date).toBeUndefined();
  });

  it("surfaces errors and keeps target/actual at 0", async () => {
    mockError = { message: "boom" };
    const { result } = renderHook(
      () => useLineShiftTarget({ line: "Line 1", date: "2026-07-16", shift: "DAY" }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.target).toBe(0);
    expect(result.current.actual).toBe(0);
    expect(result.current.gap).toBe(0);
  });
});
