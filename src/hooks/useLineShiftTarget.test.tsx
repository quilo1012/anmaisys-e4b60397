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

// ── Shift-boundary tests ────────────────────────────────────────────────────
// Reproduce the "night → morning" turn-over: NIGHT rows for a date must not
// bleed into the DAY calculation for the same date, and NIGHT rows dated on
// the previous calendar day must not appear in the morning DAY query.
describe("useLineShiftTarget — shift boundary", () => {
  it("isolates DAY and NIGHT totals for the same date and line", async () => {
    mockRows = [
      { id: "n1", line: "Line 1", plan_qty: 500, actual_qty: 480, entry_date: "2026-07-16", shift: "NIGHT" },
      { id: "n2", line: "Line 1", plan_qty: 500, actual_qty: 400, entry_date: "2026-07-16", shift: "NIGHT" },
      { id: "d1", line: "Line 1", plan_qty: 300, actual_qty: 120, entry_date: "2026-07-16", shift: "DAY" },
    ];

    const day = renderHook(
      () => useLineShiftTarget({ line: "Line 1", date: "2026-07-16", shift: "DAY" }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(day.result.current.isLoading).toBe(false));
    expect(day.result.current.target).toBe(300);
    expect(day.result.current.actual).toBe(120);
    expect(day.result.current.gap).toBe(180);
    expect(day.result.current.rowId).toBe("d1");

    const night = renderHook(
      () => useLineShiftTarget({ line: "Line 1", date: "2026-07-16", shift: "NIGHT" }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(night.result.current.isLoading).toBe(false));
    expect(night.result.current.target).toBe(1000);
    expect(night.result.current.actual).toBe(880);
    expect(night.result.current.gap).toBe(120);
    expect(night.result.current.rowId).toBeNull(); // 2 rows aggregated
  });

  it("does not pull the previous day's NIGHT into the next morning's DAY", async () => {
    // Night shift crossing midnight is logged under 2026-07-15 (NIGHT).
    // Morning query for 2026-07-16 DAY must ignore it.
    mockRows = [
      { id: "prev-night", line: "Line 2", plan_qty: 900, actual_qty: 700, entry_date: "2026-07-15", shift: "NIGHT" },
      { id: "morning", line: "Line 2", plan_qty: 250, actual_qty: 100, entry_date: "2026-07-16", shift: "DAY" },
    ];

    const morning = renderHook(
      () => useLineShiftTarget({ line: "Line 2", date: "2026-07-16", shift: "DAY" }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(morning.result.current.isLoading).toBe(false));
    expect(morning.result.current.target).toBe(250);
    expect(morning.result.current.actual).toBe(100);
    expect(morning.result.current.gap).toBe(150);
    expect(morning.result.current.rowId).toBe("morning");
  });

  it("recomputes cleanly when shift flips from NIGHT to DAY (rerender)", async () => {
    mockRows = [
      { id: "n", line: "Line 3", plan_qty: 400, actual_qty: 400, entry_date: "2026-07-16", shift: "NIGHT" },
      { id: "d", line: "Line 3", plan_qty: 100, actual_qty: 25,  entry_date: "2026-07-16", shift: "DAY" },
    ];

    const { result, rerender } = renderHook(
      ({ shift }: { shift: "DAY" | "NIGHT" }) =>
        useLineShiftTarget({ line: "Line 3", date: "2026-07-16", shift }),
      { wrapper: wrapper(), initialProps: { shift: "NIGHT" as const } },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.target).toBe(400);
    expect(result.current.actual).toBe(400);
    expect(result.current.gap).toBe(0);

    rerender({ shift: "DAY" });
    await waitFor(() => expect(result.current.target).toBe(100));
    expect(result.current.actual).toBe(25);
    expect(result.current.gap).toBe(75);
    expect(lastFilters.shift).toBe("DAY");
    expect(lastFilters.entry_date).toBe("2026-07-16");
  });

  it("returns zeros at the boundary when the new shift has no rows yet", async () => {
    // Just after midnight: NIGHT rows exist, but the fresh DAY row hasn't been entered yet.
    mockRows = [
      { id: "n", line: "Line 4", plan_qty: 800, actual_qty: 800, entry_date: "2026-07-16", shift: "NIGHT" },
    ];
    const { result } = renderHook(
      () => useLineShiftTarget({ line: "Line 4", date: "2026-07-16", shift: "DAY" }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.target).toBe(0);
    expect(result.current.actual).toBe(0);
    expect(result.current.gap).toBe(0);
    expect(result.current.rowId).toBeNull();
  });
});

// ── Partial-data tests: target without actual (and vice-versa) ──────────────
// Around the shift turn-over the target is often published before any actual
// output is recorded (and, less commonly, actual is logged before the plan is
// finalized). Both branches must produce a sensible gap and rowId.
describe("useLineShiftTarget — partial rows across the shift turn-over", () => {
  it("target present, actual missing (actual_qty = 0) → gap equals target, single rowId", async () => {
    // Fresh DAY shift right after NIGHT ended: plan published, no output yet.
    mockRows = [
      { id: "n", line: "Line 5", plan_qty: 500, actual_qty: 500, entry_date: "2026-07-16", shift: "NIGHT" },
      { id: "d", line: "Line 5", plan_qty: 400, actual_qty: 0,   entry_date: "2026-07-16", shift: "DAY" },
    ];
    const { result } = renderHook(
      () => useLineShiftTarget({ line: "Line 5", date: "2026-07-16", shift: "DAY" }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.target).toBe(400);
    expect(result.current.actual).toBe(0);
    expect(result.current.gap).toBe(400);
    expect(result.current.rowId).toBe("d");
  });

  it("treats null plan_qty / actual_qty as 0 without crashing", async () => {
    mockRows = [
      // Plan is set but actual hasn't been logged (null instead of 0).
      { id: "p", line: "Line 6", plan_qty: 250, actual_qty: null as any, entry_date: "2026-07-16", shift: "DAY" },
    ];
    const { result } = renderHook(
      () => useLineShiftTarget({ line: "Line 6", date: "2026-07-16", shift: "DAY" }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.target).toBe(250);
    expect(result.current.actual).toBe(0);
    expect(result.current.gap).toBe(250);
    expect(result.current.rowId).toBe("p");
  });

  it("actual present, target missing → gap clamps to 0, rowId still returned", async () => {
    // NIGHT rows exist for the previous day; the DAY row was created for
    // actual logging before the plan was published (plan_qty = 0).
    mockRows = [
      { id: "prev-night", line: "Line 7", plan_qty: 600, actual_qty: 550, entry_date: "2026-07-15", shift: "NIGHT" },
      { id: "d", line: "Line 7", plan_qty: 0, actual_qty: 180, entry_date: "2026-07-16", shift: "DAY" },
    ];
    const { result } = renderHook(
      () => useLineShiftTarget({ line: "Line 7", date: "2026-07-16", shift: "DAY" }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.target).toBe(0);
    expect(result.current.actual).toBe(180);
    expect(result.current.gap).toBe(0); // clamped
    expect(result.current.rowId).toBe("d");
  });

  it("aggregates target when NIGHT has multiple rows with only some actuals filled → rowId is null", async () => {
    // Mid-shift on NIGHT: two entries planned, only the first has actual output.
    mockRows = [
      { id: "n1", line: "Line 8", plan_qty: 300, actual_qty: 120, entry_date: "2026-07-16", shift: "NIGHT" },
      { id: "n2", line: "Line 8", plan_qty: 300, actual_qty: 0,   entry_date: "2026-07-16", shift: "NIGHT" },
      // DAY row for the same date must NOT be counted.
      { id: "d",  line: "Line 8", plan_qty: 999, actual_qty: 999, entry_date: "2026-07-16", shift: "DAY" },
    ];
    const { result } = renderHook(
      () => useLineShiftTarget({ line: "Line 8", date: "2026-07-16", shift: "NIGHT" }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.target).toBe(600);
    expect(result.current.actual).toBe(120);
    expect(result.current.gap).toBe(480);
    expect(result.current.rowId).toBeNull(); // >1 row → no single edit target
  });
});

// ── Concurrency: multiple lines & machines in the same period ───────────────
// The hook is shared by DailyTargetCard, MyProductionPage and LineProductionScreen,
// which run side-by-side for different lines/machines at the same (date, shift).
// Each hook instance MUST see only its own line's totals and its own rowId,
// even when many other lines/machines have rows for the exact same period.
describe("useLineShiftTarget — multiple lines & machines in the same period", () => {
  it("isolates target/actual/gap per line when many lines share (date, shift)", async () => {
    // 4 lines running in parallel on the same DAY / same date.
    mockRows = [
      { id: "l1a", line: "Line 1", plan_qty: 400, actual_qty: 150, entry_date: "2026-07-16", shift: "DAY" },
      { id: "l1b", line: "Line 1", plan_qty: 100, actual_qty: 50,  entry_date: "2026-07-16", shift: "DAY" },
      { id: "l2",  line: "Line 2", plan_qty: 300, actual_qty: 300, entry_date: "2026-07-16", shift: "DAY" },
      { id: "l3",  line: "Line 3", plan_qty: 250, actual_qty: 100, entry_date: "2026-07-16", shift: "DAY" },
      { id: "l4",  line: "Line 4", plan_qty: 999, actual_qty: 10,  entry_date: "2026-07-16", shift: "DAY" },
    ];

    const h1 = renderHook(
      () => useLineShiftTarget({ line: "Line 1", date: "2026-07-16", shift: "DAY" }),
      { wrapper: wrapper() },
    );
    const h2 = renderHook(
      () => useLineShiftTarget({ line: "Line 2", date: "2026-07-16", shift: "DAY" }),
      { wrapper: wrapper() },
    );
    const h3 = renderHook(
      () => useLineShiftTarget({ line: "Line 3", date: "2026-07-16", shift: "DAY" }),
      { wrapper: wrapper() },
    );

    await waitFor(() => expect(h1.result.current.isLoading).toBe(false));
    await waitFor(() => expect(h2.result.current.isLoading).toBe(false));
    await waitFor(() => expect(h3.result.current.isLoading).toBe(false));

    // Line 1: two rows aggregated → rowId null
    expect(h1.result.current.target).toBe(500);
    expect(h1.result.current.actual).toBe(200);
    expect(h1.result.current.gap).toBe(300);
    expect(h1.result.current.rowId).toBeNull();

    // Line 2: single row, actual meets target → gap 0, rowId set
    expect(h2.result.current.target).toBe(300);
    expect(h2.result.current.actual).toBe(300);
    expect(h2.result.current.gap).toBe(0);
    expect(h2.result.current.rowId).toBe("l2");

    // Line 3: single row, partial actual
    expect(h3.result.current.target).toBe(250);
    expect(h3.result.current.actual).toBe(100);
    expect(h3.result.current.gap).toBe(150);
    expect(h3.result.current.rowId).toBe("l3");
  });

  it("isolates DAY and NIGHT across multiple lines running simultaneously", async () => {
    // Two lines, both running DAY and NIGHT on the same date.
    mockRows = [
      { id: "l1-day",   line: "Line 1", plan_qty: 200, actual_qty: 80,  entry_date: "2026-07-16", shift: "DAY" },
      { id: "l1-night", line: "Line 1", plan_qty: 500, actual_qty: 450, entry_date: "2026-07-16", shift: "NIGHT" },
      { id: "l2-day",   line: "Line 2", plan_qty: 350, actual_qty: 350, entry_date: "2026-07-16", shift: "DAY" },
      { id: "l2-night", line: "Line 2", plan_qty: 700, actual_qty: 200, entry_date: "2026-07-16", shift: "NIGHT" },
    ];

    const l1Day = renderHook(
      () => useLineShiftTarget({ line: "Line 1", date: "2026-07-16", shift: "DAY" }),
      { wrapper: wrapper() },
    );
    const l2Night = renderHook(
      () => useLineShiftTarget({ line: "Line 2", date: "2026-07-16", shift: "NIGHT" }),
      { wrapper: wrapper() },
    );

    await waitFor(() => expect(l1Day.result.current.isLoading).toBe(false));
    await waitFor(() => expect(l2Night.result.current.isLoading).toBe(false));

    expect(l1Day.result.current.target).toBe(200);
    expect(l1Day.result.current.actual).toBe(80);
    expect(l1Day.result.current.gap).toBe(120);
    expect(l1Day.result.current.rowId).toBe("l1-day");

    expect(l2Night.result.current.target).toBe(700);
    expect(l2Night.result.current.actual).toBe(200);
    expect(l2Night.result.current.gap).toBe(500);
    expect(l2Night.result.current.rowId).toBe("l2-night");
  });

  it("scopes totals per machine via matchLine when several machines share a line label", async () => {
    // Same physical line hosts two machines (e.g. Sealer-A, Sealer-B) that
    // each publish their own RAG rows. The hook must scope by the caller's
    // matcher so machine A ≠ machine B, even at the same date/shift.
    mockRows = [
      { id: "mA1", line: "Line 5 :: Sealer-A", plan_qty: 200, actual_qty: 90,  entry_date: "2026-07-16", shift: "DAY" },
      { id: "mA2", line: "Line 5 :: Sealer-A", plan_qty: 100, actual_qty: 40,  entry_date: "2026-07-16", shift: "DAY" },
      { id: "mB1", line: "Line 5 :: Sealer-B", plan_qty: 400, actual_qty: 400, entry_date: "2026-07-16", shift: "DAY" },
      // Same date/shift, unrelated line — must never leak into either machine.
      { id: "xx",  line: "Line 9 :: Printer",  plan_qty: 999, actual_qty: 999, entry_date: "2026-07-16", shift: "DAY" },
    ];

    const machineA = renderHook(
      () =>
        useLineShiftTarget({
          line: "Sealer-A",
          date: "2026-07-16",
          shift: "DAY",
          matchLine: (rowLine) => (rowLine ?? "").includes("Sealer-A"),
        }),
      { wrapper: wrapper() },
    );
    const machineB = renderHook(
      () =>
        useLineShiftTarget({
          line: "Sealer-B",
          date: "2026-07-16",
          shift: "DAY",
          matchLine: (rowLine) => (rowLine ?? "").includes("Sealer-B"),
        }),
      { wrapper: wrapper() },
    );

    await waitFor(() => expect(machineA.result.current.isLoading).toBe(false));
    await waitFor(() => expect(machineB.result.current.isLoading).toBe(false));

    // Machine A: two rows aggregated
    expect(machineA.result.current.target).toBe(300);
    expect(machineA.result.current.actual).toBe(130);
    expect(machineA.result.current.gap).toBe(170);
    expect(machineA.result.current.rowId).toBeNull();

    // Machine B: single row, target met
    expect(machineB.result.current.target).toBe(400);
    expect(machineB.result.current.actual).toBe(400);
    expect(machineB.result.current.gap).toBe(0);
    expect(machineB.result.current.rowId).toBe("mB1");
  });

  it("a line with no rows returns zeros even when other lines are busy in the same period", async () => {
    mockRows = [
      { id: "busy1", line: "Line 1", plan_qty: 500, actual_qty: 300, entry_date: "2026-07-16", shift: "DAY" },
      { id: "busy2", line: "Line 2", plan_qty: 500, actual_qty: 400, entry_date: "2026-07-16", shift: "DAY" },
    ];
    const idle = renderHook(
      () => useLineShiftTarget({ line: "Line 7", date: "2026-07-16", shift: "DAY" }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(idle.result.current.isLoading).toBe(false));
    expect(idle.result.current.target).toBe(0);
    expect(idle.result.current.actual).toBe(0);
    expect(idle.result.current.gap).toBe(0);
    expect(idle.result.current.rowId).toBeNull();
  });
});




