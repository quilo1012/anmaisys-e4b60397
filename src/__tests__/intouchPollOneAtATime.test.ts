import { describe, it, expect, vi } from "vitest";
// Fora de `src` de propósito, como os outros testes do poller: a regra vive com ele.
import {
  tryStartPoll,
  finishPoll,
  isMissingFunction,
  LEASE_SECONDS,
  START_RPC,
  FINISH_RPC,
  type Rpc,
} from "../../supabase/functions/intouch-poll/pollLease";
import { readingChanged } from "../../supabase/functions/intouch-poll/machineSnapshot";

const answering = (data: unknown, error: { code?: string; message?: string } | null = null) =>
  vi.fn<Rpc>(async () => ({ data, error }));

describe("the poll lease", () => {
  it("runs, guarded, when the lease is free, and clears it at the end", async () => {
    const rpc = answering(true);
    const d = await tryStartPoll(rpc);
    expect(d).toEqual({ run: true, guarded: true });
    expect(rpc).toHaveBeenCalledWith(START_RPC, { p_lease_seconds: LEASE_SECONDS });
    await finishPoll(rpc, d);
    expect(rpc).toHaveBeenLastCalledWith(FINISH_RPC);
  });

  it("skips the run when another one holds the lease, and does not clear that one's lease", async () => {
    const rpc = answering(false);
    const d = await tryStartPoll(rpc);
    expect(d.run).toBe(false);
    await finishPoll(rpc, d);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  // Deploying the function before BLOCO 162 is pasted must not stop the polling.
  it("runs without the guard when the functions are not in the database yet", async () => {
    for (const error of [
      { code: "PGRST202", message: "Could not find the function public.intouch_poll_try_start(p_lease_seconds) in the schema cache" },
      { code: "42883", message: "function public.intouch_poll_try_start(integer) does not exist" },
    ]) {
      const rpc = answering(null, error);
      const d = await tryStartPoll(rpc);
      expect(d).toMatchObject({ run: true, guarded: false, reason: "lease_rpc_missing" });
      await finishPoll(rpc, d);
      expect(rpc).toHaveBeenCalledTimes(1);
    }
  });

  it("runs as before the guard existed when the lease cannot be read", async () => {
    expect(await tryStartPoll(answering(null, { code: "57014", message: "statement timeout" })))
      .toMatchObject({ run: true, guarded: false, reason: "lease_check_failed" });
    const throwing = vi.fn<Rpc>(async () => { throw new Error("fetch failed"); });
    expect(await tryStartPoll(throwing)).toMatchObject({ run: true, guarded: false, reason: "lease_check_failed" });
  });

  it("never lets clearing the lease throw", async () => {
    const throwing = vi.fn<Rpc>(async () => { throw new Error("fetch failed"); });
    await expect(finishPoll(throwing, { run: true, guarded: true })).resolves.toBeUndefined();
  });

  it("outlives an edge function, so a run only ever clears its own lease", () => {
    expect(LEASE_SECONDS).toBeGreaterThan(150);
  });

  it("knows a missing function from any other error", () => {
    expect(isMissingFunction(null)).toBe(false);
    expect(isMissingFunction({ code: "42501", message: "permission denied" })).toBe(false);
    expect(isMissingFunction({ message: "Could not find the function public.x" })).toBe(true);
  });
});

describe("a machine's reading is written only when it changed", () => {
  const seen = "2026-11-11T10:00:00+00:00";
  const prev = { last_status: 4, last_downtime_code: "", stop_since_at: null, last_seen_at: seen };

  it("leaves an unchanged running machine to the batched last_seen_at", () => {
    expect(readingChanged(prev, { last_status: 4, last_downtime_code: "", stop_since_at: null })).toBe(false);
  });

  it("does not mistake the database's timestamp text for a change", () => {
    const stopped = { ...prev, last_status: 7, last_downtime_code: "ABC", stop_since_at: "2026-11-11T09:00:00+00:00" };
    expect(readingChanged(stopped, { last_status: 7, last_downtime_code: "ABC", stop_since_at: "2026-11-11T09:00:00.000Z" }))
      .toBe(false);
  });

  it("writes a new status, a new code, a new stop clock, and a first reading", () => {
    expect(readingChanged(prev, { last_status: 7, last_downtime_code: "", stop_since_at: null })).toBe(true);
    expect(readingChanged(prev, { last_status: 4, last_downtime_code: "ABC", stop_since_at: seen })).toBe(true);
    // "" and null are different facts to the poll (see stopReading.ts), so a change between them is written.
    expect(readingChanged(prev, { last_status: 4, last_downtime_code: null, stop_since_at: null })).toBe(true);
    expect(readingChanged({ ...prev, last_seen_at: null }, { last_status: 4, last_downtime_code: "", stop_since_at: null }))
      .toBe(true);
  });
});
