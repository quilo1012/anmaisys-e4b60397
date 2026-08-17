import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

let mockVerdictRow: Record<string, unknown> | null = null;
let mockVerdictError: { message: string } | null = null;
const upsertCalls: unknown[] = [];
let upsertError: { message: string } | null = null;
// null (the default) => each upsert resolves immediately, as in every test that
// doesn't care about ordering. Set to [] to hold every upsert open until the
// test explicitly resolves it via `upsertResolvers[i]()`, in call order — used
// by the race test below to prove writes are sent one at a time, in order.
let upsertResolvers: Array<() => void> | null = null;

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
              if (upsertResolvers) {
                await new Promise<void>((resolve) => { upsertResolvers!.push(resolve); });
              }
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
  upsertResolvers = null;
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

  it("does not send a newer debounced write until an older one in flight has settled — the database ends up with the LAST draft, not an arbitrary one", async () => {
    upsertResolvers = [];
    const { result } = renderHook(
      () => useScorecardEntry("leader-1", "line-1", "2026-07-05"),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Edit A. Its debounce fires and the write goes in flight — held open by
    // the gated mock, simulating a slow request.
    act(() => result.current.setField("planned_volume", 100));
    await act(async () => { vi.advanceTimersByTime(500); });
    await waitFor(() => expect(upsertCalls.length).toBe(1));
    expect((upsertCalls[0] as { planned_volume: number }).planned_volume).toBe(100);

    // Edit B, while A is still unresolved. Its debounce also fires. Under the
    // bug this fired a second, independent upsert immediately — the two
    // requests would then be in flight together and could complete in either
    // order. The fix must not let B's write reach the database yet.
    act(() => result.current.setField("planned_volume", 200));
    await act(async () => { vi.advanceTimersByTime(500); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(upsertCalls.length).toBe(1); // B is queued, not yet sent

    // A (the older, slower request) resolves first.
    await act(async () => {
      upsertResolvers![0]();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Only now does B's write actually reach the database.
    await waitFor(() => expect(upsertCalls.length).toBe(2));
    expect((upsertCalls[1] as { planned_volume: number }).planned_volume).toBe(200);

    // Resolve B, and the last write standing carries the LAST draft (200),
    // never A's stale one (100) — impossible for it to be overwritten, because
    // it was never allowed to start until A had already finished.
    await act(async () => { upsertResolvers![1](); });
    await waitFor(() => expect(result.current.isSaving).toBe(false));
    expect((upsertCalls[upsertCalls.length - 1] as { planned_volume: number }).planned_volume).toBe(200);
  });

  it("queues saveNow behind an already in-flight debounced write, so an audit stamp cannot be overwritten by a stale save", async () => {
    upsertResolvers = [];
    const { result } = renderHook(
      () => useScorecardEntry("leader-1", "line-1", "2026-07-05"),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // A field edit's debounce fires and its write is in flight (held open).
    act(() => result.current.setField("planned_volume", 300));
    await act(async () => { vi.advanceTimersByTime(500); });
    await waitFor(() => expect(upsertCalls.length).toBe(1));

    // saveNow is called while that write is still unresolved — e.g. approving
    // the week the instant after a field was last touched. Invoked inside a
    // synchronous `act` so its own `setDraft` call (which runs before the
    // first `await` inside `saveNow`) is flushed; the returned promise itself
    // is awaited later, once the queued writes below have been let through.
    let saveNowPromise!: Promise<void>;
    act(() => {
      saveNowPromise = result.current.saveNow({ capa_status: "approved" });
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    // saveNow's own write must not have been sent yet — it is queued behind
    // the debounced write already in flight, not racing it.
    expect(upsertCalls.length).toBe(1);

    // Let the debounced write settle; only then does saveNow's write fire.
    await act(async () => { upsertResolvers![0](); await Promise.resolve(); await Promise.resolve(); });
    await waitFor(() => expect(upsertCalls.length).toBe(2));
    expect((upsertCalls[1] as { capa_status: string; planned_volume: number }).capa_status).toBe("approved");
    // saveNow's write carries the field edit too — it merges onto the current
    // draft, it does not resurrect an older one.
    expect((upsertCalls[1] as { capa_status: string; planned_volume: number }).planned_volume).toBe(300);

    await act(async () => { upsertResolvers![1](); });
    await saveNowPromise;
  });
});
