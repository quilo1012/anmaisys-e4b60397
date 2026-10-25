import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

/**
 * Confirmed overtime counts on the board by itself (25/10: the separate "Overtime
 * attendance" confirmation was removed). These pin what "confirmed" means there: an
 * accepted answer, on an ask that is not cancelled, that lands on this board's date and
 * shift, and that the person has not dropped out of. Being on the board is "expected to
 * work"; a recorded "attended" keeps them on it, and nothing else is asked for.
 */
const filters: [string, ...unknown[]][] = [];
let rows: unknown[] = [];
function chain() {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "neq"]) c[m] = (...a: unknown[]) => { filters.push([m, ...a]); return c; };
  (c as { then: unknown }).then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(ok);
  return c;
}
vi.mock("@/integrations/supabase/client", () => {
  const channel = { on: () => channel, subscribe: () => channel };
  return { supabase: { from: () => chain(), channel: () => channel, removeChannel: vi.fn() } };
});

const { useConfirmedOvertime } = await import("./useHeadcount");

const wrap = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);
const ask = (on_date: string, starts_at: string, ends_at: string) => ({ on_date, starts_at, ends_at, status: "open" });
const row = (employee_id: string, q: ReturnType<typeof ask>, outcomes: { outcome: string }[] = []) =>
  ({ request_id: `r-${employee_id}`, employee_id, overtime_requests: q, overtime_outcomes: outcomes });

describe("useConfirmedOvertime: on the board without a second confirmation", () => {
  beforeEach(() => { filters.length = 0; rows = []; });

  it("asks only for accepted answers on asks that are not cancelled", async () => {
    renderHook(() => useConfirmedOvertime("2026-10-25", "Day"), { wrapper: wrap });
    await waitFor(() => expect(filters.length).toBeGreaterThan(0));
    expect(filters).toEqual(expect.arrayContaining([
      ["eq", "decision", "accepted"],
      ["neq", "overtime_requests.status", "cancelled"],
    ]));
  });

  it("counts an accepted booking on this day with no attendance mark at all", async () => {
    rows = [row("a", ask("2026-10-25", "06:00:00", "18:00:00"))];
    const { result } = renderHook(() => useConfirmedOvertime("2026-10-25", "Day"), { wrapper: wrap });
    await waitFor(() => expect(result.current.data?.has("a")).toBe(true));
  });

  it("keeps somebody marked attended, and drops a cancellation or a no-show", async () => {
    const q = ask("2026-10-25", "06:00:00", "18:00:00");
    rows = [
      row("attended", q, [{ outcome: "attended" }]),
      row("cancelled", q, [{ outcome: "cancelled_in_time" }]),
      row("noshow", q, [{ outcome: "no_show" }]),
    ];
    const { result } = renderHook(() => useConfirmedOvertime("2026-10-25", "Day"), { wrapper: wrap });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect([...result.current.data!.keys()]).toEqual(["attended"]);
  });

  it("does not put overtime for another day, or for the night, on the day board", async () => {
    rows = [
      row("tomorrow-day", ask("2026-10-26", "06:00:00", "18:00:00")),
      row("tonight", ask("2026-10-25", "18:00:00", "06:00:00")),
    ];
    const { result } = renderHook(() => useConfirmedOvertime("2026-10-25", "Day"), { wrapper: wrap });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data!.size).toBe(0);
  });
});
