import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

let mockVerdictRow: Record<string, unknown> | null = null;
let mockVerdictError: { message: string } | null = null;
const upsertCalls: unknown[] = [];
let upsertError: { message: string } | null = null;

vi.mock("@/integrations/supabase/client", () => {
  function selectBuilder() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock builder
    const builder: any = {
      eq: vi.fn(() => builder),
      maybeSingle: vi.fn(async () => {
        if (mockVerdictError) return { data: null, error: mockVerdictError };
        return { data: mockVerdictRow, error: null };
      }),
    };
    return builder;
  }
  return {
    supabase: {
      from: vi.fn((table: string) => {
        if (table === "v_leader_weekly_scorecard") {
          return { select: vi.fn(() => selectBuilder()) };
        }
        if (table === "leader_weekly_scorecard") {
          return {
            upsert: vi.fn(async (row: unknown) => {
              upsertCalls.push(row);
              return { error: upsertError };
            }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      }),
    },
  };
});

import { useScorecardEntry } from "./useScorecardEntry";

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  mockVerdictRow = null;
  mockVerdictError = null;
  upsertCalls.length = 0;
  upsertError = null;
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useScorecardEntry", () => {
  it("starts with a blank draft — nothing recorded is not zero", () => {
    const { result } = renderHook(
      () => useScorecardEntry("leader-1", "line-1", "2026-07-05"),
      { wrapper: wrapper() },
    );
    expect(result.current.draft.near_misses_reported).toBeNull();
    expect(result.current.draft.planned_volume).toBeNull();
    expect(result.current.verdict).toBeNull();
  });

  it("surfaces a query failure as isError, never as a quietly-blank week", async () => {
    mockVerdictError = { message: 'relation "v_leader_weekly_scorecard" does not exist' };
    const { result } = renderHook(
      () => useScorecardEntry("leader-1", "line-1", "2026-07-05"),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeTruthy();
    expect(result.current.verdict).toBeNull();
  });

  it("carries the database's verdict fields into the draft and verdict, untouched", async () => {
    mockVerdictRow = {
      leader_id: "leader-1",
      line_id: "line-1",
      week_ending: "2026-07-05",
      planned_volume: 1000,
      overall_rag: "Amber",
      rag_driver: "Volume missed target",
      quality_fail_type: null,
    };
    const { result } = renderHook(
      () => useScorecardEntry("leader-1", "line-1", "2026-07-05"),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.verdict).not.toBeNull());
    expect(result.current.verdict?.overall_rag).toBe("Amber");
    expect(result.current.verdict?.rag_driver).toBe("Volume missed target");
    expect(result.current.draft.planned_volume).toBe(1000);
  });

  it("debounces setField into a single upsert", async () => {
    const { result } = renderHook(
      () => useScorecardEntry("leader-1", "line-1", "2026-07-05"),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.setField("planned_volume", 500));
    act(() => result.current.setField("planned_volume", 600));
    expect(upsertCalls.length).toBe(0);

    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    await waitFor(() => expect(upsertCalls.length).toBe(1));
    expect((upsertCalls[0] as { planned_volume: number }).planned_volume).toBe(600);
  });

  it("saveNow writes immediately, bypassing the debounce", async () => {
    const { result } = renderHook(
      () => useScorecardEntry("leader-1", "line-1", "2026-07-05"),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.saveNow({ capa_status: "submitted" });
    });
    expect(upsertCalls.length).toBe(1);
    expect((upsertCalls[0] as { capa_status: string }).capa_status).toBe("submitted");
  });
});
