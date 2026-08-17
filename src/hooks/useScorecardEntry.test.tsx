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
import { emptyDraft } from "@/lib/scorecardEntry";

/**
 * A row as `v_leader_weekly_scorecard` actually returns one: the writable
 * columns AND everything the view adds on top of them — names, labels, RAGs,
 * drivers, flags — plus the two GENERATED ALWAYS columns of the base table.
 */
function fullViewRow() {
  return {
    id: "row-1",
    leader_id: "leader-1", line_id: "line-1", week_ending: "2026-07-05",
    planned_volume: 1000, actual_volume: 950, unplanned_downtime_minutes: 30,
    downtime_reason: "Quebra", volume_source: "derivado",
    ccp_check_status: "Pass", starter_check_status: "Pass", volume_weight_check_status: "Pass",
    lost_time_injuries: 0, reportable_accidents: 0, first_aid_cases: 0,
    near_misses_reported: 3, safety_observations_done: 4, toolbox_talks_done: 2,
    ppe_compliance_pct: 0.95, hs_training_compliance_pct: 0.9, overdue_hs_actions: 0,
    leader_attendance_pct: 1, team_attendance_pct: 0.92,
    leader_lateness_incidents: 0, team_lateness_incidents: 1,
    root_cause: null, corrective_action: null, capa_owner: null,
    capa_due_date: null, capa_status: null,
    submitted_by: null, submitted_at: null, approved_by: null, approved_at: null,
    created_at: "2026-07-05T08:00:00Z", updated_at: "2026-07-05T08:00:00Z",
    month_start: "2026-07-01", quarter_start: "2026-07-01",
    leader_name: "M. Silva", line_name: "Line 3", month: "jul-2026", quarter: "Q3-2026",
    volume_pct: 95, volume_pct_adjusted: 97, volume_rag: "Amber",
    quality_rag: "Green", quality_fail_type: null, capa_required: false,
    hs_rag: "Green", hs_driver: [], missing_hs_data: false,
    leader_attendance_below_target: false,
    overall_rag: "Amber", rag_driver: "Volume 95%.", pending_approval: true,
  };
}

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

    // "Concluida", not "submitted": capa_status is the enum
    // public.scorecard_capa_status, whose four values are Portuguese. The old
    // fixtures used words the database would have rejected outright, which is
    // exactly the class of mistake the narrowed type now makes impossible.
    await act(async () => {
      await result.current.saveNow({ capa_status: "Concluida" });
    });
    expect(upsertCalls.length).toBe(1);
    expect((upsertCalls[0] as { capa_status: string }).capa_status).toBe("Concluida");
  });

  it("never sends a view column back to the base table — the second save must be as writable as the first", async () => {
    // The whole view row is what a refetch returns after the first successful
    // save. Merging it into the draft unfiltered and upserting that is what made
    // every later save fail: PGRST204 for leader_name/volume_rag/pending_approval,
    // 428C9 for month_start/quarter_start. The row would be writable exactly once.
    mockVerdictRow = fullViewRow();
    const { result } = renderHook(
      () => useScorecardEntry("leader-1", "line-1", "2026-07-05"),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.verdict).not.toBeNull());
    // The fetched row did reach the draft — this is not a test of merging nothing.
    await waitFor(() => expect(result.current.draft.planned_volume).toBe(1000));

    await act(async () => {
      await result.current.saveNow({ submitted_by: "user-9", submitted_at: "2026-07-06T08:00:00Z" });
    });

    expect(upsertCalls.length).toBe(1);
    const sent = upsertCalls[0] as Record<string, unknown>;
    const writable = Object.keys(emptyDraft("leader-1", "line-1", "2026-07-05"));
    expect(Object.keys(sent).sort()).toEqual([...writable].sort());
    for (const forbidden of [
      "leader_name", "line_name", "month", "quarter", "volume_pct", "volume_pct_adjusted",
      "volume_rag", "quality_rag", "quality_fail_type", "capa_required", "hs_rag",
      "hs_driver", "missing_hs_data", "leader_attendance_below_target", "overall_rag",
      "rag_driver", "pending_approval", "month_start", "quarter_start",
    ]) {
      expect(`${forbidden}: ${forbidden in sent}`).toBe(`${forbidden}: false`);
    }
    // And the write still carries what it is for.
    expect(sent.submitted_by).toBe("user-9");
    expect(sent.planned_volume).toBe(1000);
  });

  it("a loaded week's volume_source survives the next save — the stamp is not wiped by reopening it", async () => {
    // The regression, end to end. `volume_source` was not a column of
    // v_leader_weekly_scorecard, so the fetched row did not carry it, pickWritable had
    // nothing to restore, the draft held null, and the very next save wrote null over
    // the derivado/manual stamp. It was invisible while only the first save ever
    // succeeded; the moment saves started working, reopening a week and touching one
    // field erased the audit column. The fixture below is the view row as it is AFTER
    // 20260818090000 adds s.volume_source to the select list.
    mockVerdictRow = fullViewRow();
    const { result } = renderHook(
      () => useScorecardEntry("leader-1", "line-1", "2026-07-05"),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.draft.volume_source).toBe("derivado"));

    // Touch something else entirely — the case that used to wipe it.
    act(() => result.current.setField("near_misses_reported", 5));
    await act(async () => { vi.advanceTimersByTime(500); });
    await waitFor(() => expect(upsertCalls.length).toBe(1));

    const sent = upsertCalls[0] as Record<string, unknown>;
    expect(sent.near_misses_reported).toBe(5);
    expect(sent.volume_source).toBe("derivado");
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
      saveNowPromise = result.current.saveNow({ capa_status: "Verificada" });
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    // saveNow's own write must not have been sent yet — it is queued behind
    // the debounced write already in flight, not racing it.
    expect(upsertCalls.length).toBe(1);

    // Let the debounced write settle; only then does saveNow's write fire.
    await act(async () => { upsertResolvers![0](); await Promise.resolve(); await Promise.resolve(); });
    await waitFor(() => expect(upsertCalls.length).toBe(2));
    expect((upsertCalls[1] as { capa_status: string; planned_volume: number }).capa_status).toBe("Verificada");
    // saveNow's write carries the field edit too — it merges onto the current
    // draft, it does not resurrect an older one.
    expect((upsertCalls[1] as { capa_status: string; planned_volume: number }).planned_volume).toBe(300);

    await act(async () => { upsertResolvers![1](); });
    await saveNowPromise;
  });
});
