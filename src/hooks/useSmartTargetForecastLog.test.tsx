import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getCurrentFactoryShift } from "@/lib/shifts";
import { useFreezeSmartTargetForecasts, type LineToFreeze } from "./useSmartTargetForecastLog";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));

const now = getCurrentFactoryShift();
const shift = now.shiftCode === "day" ? "DAY" : "NIGHT";
const line = (n: number): LineToFreeze =>
  ({ line: n, shown: true, factor: null, forecast: { expectedTotal: 100, expectedPerHour: 10, status: "ok", confidence: "low", jobs: [{ sku: "A" }] } }) as unknown as LineToFreeze;
const log = { data: { installed: true, rows: [] } } as never;
const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: new QueryClient() }, children);
const savedLines = () => rpc.mock.calls.map((c) => c[1].p_rows.map((r: { line: number }) => r.line));

describe("freezing the running shift's forecasts", () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ error: null });
  });

  it("saves a line that gets its plan while the page stays open, and the first only once", async () => {
    const { rerender } = renderHook(({ lines }) => useFreezeSmartTargetForecasts(now.sessionDate, shift, lines, true, log), {
      wrapper,
      initialProps: { lines: [line(1)] },
    });
    await waitFor(() => expect(savedLines()).toEqual([[1]]));
    rerender({ lines: [line(1), line(4)] });
    await waitFor(() => expect(savedLines()).toEqual([[1], [4]]));
    rerender({ lines: [line(1), line(4)] });
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("tries a line again if the save failed", async () => {
    rpc.mockResolvedValueOnce({ error: { message: "offline" } });
    const { rerender } = renderHook(({ lines }) => useFreezeSmartTargetForecasts(now.sessionDate, shift, lines, true, log), {
      wrapper,
      initialProps: { lines: [line(2)] },
    });
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    rerender({ lines: [line(2)] });
    await waitFor(() => expect(savedLines()).toEqual([[2], [2]]));
  });

  it("replaces a saved forecast only when it had no number and the new one has", async () => {
    const saved = (line: number, expected_total: number | null) => ({ session_date: now.sessionDate, shift, line, shown: true, expected_total, frozen_at: "x" });
    const logWith = { data: { installed: true, rows: [saved(1, 500), saved(2, null), saved(3, null)] } } as never;
    const empty = { ...line(3), forecast: { ...line(3).forecast, expectedTotal: null } } as LineToFreeze;
    renderHook(() => useFreezeSmartTargetForecasts(now.sessionDate, shift, [line(1), line(2), empty], true, logWith), { wrapper });
    await waitFor(() => expect(savedLines()).toEqual([[2]]));
  });
});
