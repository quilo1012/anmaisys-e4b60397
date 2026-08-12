import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * The period report, and the two reads nobody was checking.
 *
 * The summary asks five questions in two rounds: the first round — RAG, orders,
 * quality — has its errors read and thrown. The second round does not. `totals` and
 * `metrics` come back from two views, and the code went straight to `totals.data ?? []`
 * without ever looking at `totals.error`.
 *
 * A failed read and an empty view are the same empty array, so a downtime read that
 * errors is reported as a period with no downtime in it: zero minutes, zero stoppages,
 * no worst line, and a dash where the average response time should be. The page then
 * prints, under those figures, that a dash means nothing was recorded — which is the
 * one thing it does not mean here.
 *
 * Zero is an answer. It has to be earned.
 */

type Read = { table: string; filters: Record<string, unknown> };

let reads: Read[] = [];
let fail = new Set<string>();

vi.mock("@/integrations/supabase/client", () => {
  function makeBuilder(table: string) {
    const rec: Read = { table, filters: {} };
    const finish = () => {
      reads.push(rec);
      if (fail.has(table)) {
        return { data: null, error: { message: `permission denied for ${table}`, code: "42501" } };
      }
      return { data: ROWS[table] ?? [], error: null };
    };
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => b,
      eq: () => b,
      neq: (c: string, v: unknown) => { rec.filters[`neq:${c}`] = v; return b; },
      gte: (c: string, v: unknown) => { rec.filters[`gte:${c}`] = v; return b; },
      lte: (c: string, v: unknown) => { rec.filters[`lte:${c}`] = v; return b; },
      in: (c: string, v: unknown) => { rec.filters[`in:${c}`] = v; return b; },
      limit: () => b,
      then: (resolve: (r: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(finish()).then(resolve, reject),
    });
    return b;
  }
  return { supabase: { from: (t: string) => makeBuilder(t) } };
});

import { useReportSummary } from "./useReportSummary";

const DAY = "2026-08-10";
/** 11:00 London on the day under test — inside the day shift, on that session date. */
const ANCHOR = "2026-08-10T10:00:00.000Z";

/** One planned day, one order that stopped a line, one downtime total, one metric. */
const ROWS: Record<string, unknown[]> = {
  rag_weekly_entries: [
    { entry_date: DAY, line: "Line 1", shift: "DAY", plan_qty: 1000, actual_qty: 900 },
  ],
  work_orders: [
    {
      id: "wo-1", wo_number: "WO-1", status: "closed",
      created_at: ANCHOR, closed_at: ANCHOR, line_stopped_at: ANCHOR,
      line_at_time: "Line 1", line: { name: "Line 1" },
    },
  ],
  quality_actions: [],
  v_wo_downtime_total: [{ work_order_id: "wo-1", total_minutes: 45, stop_count: 2 }],
  v_wo_metrics: [{ id: "wo-1", response_time_sec: 600, active_repair_sec: 1800, status: "closed" }],
};

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const summary = () => renderHook(() => useReportSummary(DAY, DAY, "ALL"), { wrapper: wrapper() });

beforeEach(() => {
  reads = [];
  fail = new Set();
});

describe("useReportSummary", () => {
  it("reads the period when every table answers", async () => {
    const { result } = summary();
    // `isSuccess` means the answer arrived. It only means that since the placeholder
    // was dropped: with one, this query reported success on its first render while
    // holding a report of zeros, and waiting here would have asserted the placeholder.
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.isPlaceholderData).toBe(false);

    expect(result.current.data).toMatchObject({
      production: { plan: 1000, actual: 900, efficiencyPct: 90, days: 1 },
      downtime: { minutes: 45, stops: 2, worstLine: "Line 1", worstMinutes: 45 },
      maintenance: { raised: 1, closed: 1, avgResponseMin: 10, avgRepairMin: 30 },
    });
  });

  it("fails loudly when the downtime view cannot be read, instead of reporting no downtime", async () => {
    fail.add("v_wo_downtime_total");
    const { result } = summary();

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(String(result.current.error?.message)).toContain("v_wo_downtime_total");
  });

  it("fails loudly when the metrics view cannot be read, instead of reporting no response time", async () => {
    fail.add("v_wo_metrics");
    const { result } = summary();

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(String(result.current.error?.message)).toContain("v_wo_metrics");
  });
});
