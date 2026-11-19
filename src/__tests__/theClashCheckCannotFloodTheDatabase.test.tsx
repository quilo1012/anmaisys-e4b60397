import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

/**
 * 19/11/2026, 00:52–00:55: the database stalled for three minutes — statement timeouts on
 * Overtime, Headcount and the engineer's screen, cron jobs that could not even start. One
 * supervisor's browser had been recording outcomes on Overtime and moving to Headcount.
 * Each save restarted the whole `overtime_schedule_clashes` set (11 calls for 102 asks),
 * three at a time, and nothing stopped the sets already running — not a newer one, not
 * leaving the page. ~45 calls in 90 seconds, each 2–7 s of database time.
 *
 * Now: one call at a time; a cancelled run starts no further call; a burst of saves runs
 * the check once, after it settles.
 */

type Pending = { batch: string[]; resolve: (v: { data: unknown[]; error: null }) => void; signal?: AbortSignal };
const pending: Pending[] = [];
let calls = 0;
let inFlight = 0;
let maxInFlight = 0;

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (_fn: string, args: { p_request_ids: string[] }) => {
      const entry: Pending = { batch: args.p_request_ids, resolve: () => {} };
      const promise = new Promise<{ data: unknown[]; error: null }>((resolve) => {
        entry.resolve = (v) => { inFlight--; resolve(v); };
      });
      calls++;
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      pending.push(entry);
      const builder = {
        abortSignal(signal: AbortSignal) { entry.signal = signal; return builder; },
        then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => promise.then(ok, ko),
      };
      return builder;
    },
    from: () => ({}),
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null }) }));

import {
  refreshAfterOvertimeChange,
  SCHEDULE_CLASH_BATCH,
  SCHEDULE_CLASH_SETTLE_MS,
  useOvertimeScheduleClashes,
} from "@/hooks/useOvertimeRequests";

const asks = (n: number) => Array.from({ length: n }, (_, i) => `ask-${String(i).padStart(3, "0")}`);

function setup(ids: string[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const hook = renderHook(() => useOvertimeScheduleClashes(ids), { wrapper });
  return { qc, hook };
}

/** Answer whatever call is waiting, as the database would. */
async function answerNext() {
  await waitFor(() => expect(pending.length).toBeGreaterThan(0));
  pending.shift()!.resolve({ data: [], error: null });
}

beforeEach(() => { pending.length = 0; calls = 0; inFlight = 0; maxInFlight = 0; });
afterEach(() => { vi.useRealTimers(); });

describe("the clash check", () => {
  it("sends one call at a time — never three side by side", async () => {
    const { hook } = setup(asks(102));
    for (let i = 0; i < Math.ceil(102 / SCHEDULE_CLASH_BATCH); i++) await answerNext();
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    expect(maxInFlight).toBe(1);
  });

  it("starts no further call once the screen is left", async () => {
    const { hook } = setup(asks(102));
    await waitFor(() => expect(pending.length).toBe(1));
    hook.unmount();
    // The call already sent is told to stop…
    await waitFor(() => expect(pending[0].signal?.aborted).toBe(true));
    pending.shift()!.resolve({ data: [], error: null });
    // …and nothing follows it.
    await new Promise((r) => setTimeout(r, 30));
    expect(pending.length).toBe(0);
  });

  it("a newer run replaces the old one instead of running beside it", async () => {
    // Loaded once (four calls for 40 asks)…
    const { qc, hook } = setup(asks(40));
    for (let i = 0; i < 4; i++) await answerNext();
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    // …then a save re-reads it, and another save re-reads it again mid-way.
    void qc.refetchQueries({ queryKey: ["overtime_schedule_clashes"] });
    await waitFor(() => expect(pending.length).toBe(1));
    void qc.refetchQueries({ queryKey: ["overtime_schedule_clashes"] });
    await waitFor(() => expect(pending[0].signal?.aborted).toBe(true));
    pending.shift()!.resolve({ data: [], error: null });
    // Only the newest run goes on.
    for (let i = 0; i < 4; i++) await answerNext();
    await waitFor(() => expect(hook.result.current.isFetching).toBe(false));
    await new Promise((r) => setTimeout(r, 30));
    expect(pending.length).toBe(0);
    expect(calls).toBe(4 + 1 + 4);
  });
});

describe("after overtime saves", () => {
  it("five saves in a row run the clash check once, after they settle", async () => {
    vi.useFakeTimers();
    const qc = new QueryClient();
    const refetch = vi.spyOn(qc, "refetchQueries");
    // `invalidateQueries` refetches the other overtime reads through `refetchQueries`
    // too; only the clash check's own re-reads count here.
    const clashRefetches = () =>
      refetch.mock.calls.filter(([f]) => (f as { queryKey?: string[] })?.queryKey?.[0] === "overtime_schedule_clashes");
    qc.setQueryData(["overtime_schedule_clashes", "a"], new Map());

    for (let i = 0; i < 5; i++) {
      refreshAfterOvertimeChange(qc);
      vi.advanceTimersByTime(1_000);
    }
    expect(clashRefetches()).toHaveLength(0);
    // Marked stale straight away, so a screen opened meanwhile reads it fresh.
    expect(qc.getQueryState(["overtime_schedule_clashes", "a"])?.isInvalidated).toBe(true);

    vi.advanceTimersByTime(SCHEDULE_CLASH_SETTLE_MS);
    expect(clashRefetches()).toHaveLength(1);
    expect(clashRefetches()[0][0]).toEqual({ queryKey: ["overtime_schedule_clashes"], type: "active" });
  });

  it("every other overtime read still refreshes at once", () => {
    const qc = new QueryClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    refreshAfterOvertimeChange(qc);
    const calls = invalidate.mock.calls.map(([f]) => f as { queryKey: string[]; refetchType?: string });
    expect(calls.find((c) => c.queryKey[0] === "overtime_requests")?.refetchType).toBeUndefined();
    expect(calls.find((c) => c.queryKey[0] === "overtime_schedule_clashes")?.refetchType).toBe("none");
  });
});
