import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { QueryClient, QueryObserver, focusManager, onlineManager } from "@tanstack/react-query";
import {
  shouldRetry,
  retryDelay,
  isDegradedError,
  noteBackendError,
  isBackendDegraded,
  onDegradedChange,
  allowDegradedReport,
  resetBackendHealth,
  DEGRADED_THRESHOLD,
  DEGRADED_WINDOW_MS,
  DEGRADED_HOLD_MS,
  DEGRADED_POLL_MS,
  pollEvery,
} from "./backendHealth";

/** The shape supabase-js hands to `if (error) throw error` — no `status` on it. */
const pg = (code: string, message = "x") => ({ code, message, details: "", hint: "" });
/** What postgrest-js returns when fetch itself throws. */
const networkError = { message: "TypeError: Failed to fetch", details: "", hint: "", code: "" };

describe("shouldRetry", () => {
  it("retries a statement timeout once, never twice", () => {
    expect(shouldRetry(0, pg("57014"))).toBe(true);
    expect(shouldRetry(1, pg("57014"))).toBe(false);
  });

  it("retries a schema-cache 503 (PGRST002) once", () => {
    expect(shouldRetry(0, pg("PGRST002"))).toBe(true);
    expect(shouldRetry(1, pg("PGRST002"))).toBe(false);
  });

  it("never retries a permission refusal", () => {
    expect(shouldRetry(0, pg("42501"))).toBe(false);
  });

  it("never retries an expired JWT (PGRST303) or the other JWT codes", () => {
    for (const c of ["PGRST301", "PGRST302", "PGRST303", "PGRST116"]) {
      expect(shouldRetry(0, pg(c))).toBe(false);
    }
  });

  it("never retries a constraint violation or bad input", () => {
    expect(shouldRetry(0, pg("23505"))).toBe(false);
    expect(shouldRetry(0, pg("22P02"))).toBe(false);
  });

  it("retries a 503 once, from either shape a status arrives in", () => {
    expect(shouldRetry(0, { status: 503 })).toBe(true);
    expect(shouldRetry(1, { status: 503 })).toBe(false);
    // FunctionsHttpError carries the Response on `context`.
    expect(shouldRetry(0, { name: "FunctionsHttpError", message: "x", context: { status: 503 } })).toBe(true);
  });

  it("never retries a 4xx", () => {
    expect(shouldRetry(0, { status: 400 })).toBe(false);
    expect(shouldRetry(0, { status: 404 })).toBe(false);
    expect(shouldRetry(0, { name: "FunctionsHttpError", message: "x", context: { status: 401 } })).toBe(false);
  });

  it("retries a dropped connection once, raw or wrapped by postgrest-js", () => {
    expect(shouldRetry(0, new TypeError("Failed to fetch"))).toBe(true);
    expect(shouldRetry(1, new TypeError("Failed to fetch"))).toBe(false);
    expect(shouldRetry(0, networkError)).toBe(true);
  });

  it("retries an unrecognised error at most once", () => {
    expect(shouldRetry(0, new Error("something odd"))).toBe(true);
    expect(shouldRetry(1, new Error("something odd"))).toBe(false);
  });
});

describe("retryDelay", () => {
  it("waits between one and three seconds, with jitter", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 50; i++) {
      const d = retryDelay(0);
      expect(d).toBeGreaterThanOrEqual(1000);
      expect(d).toBeLessThanOrEqual(3000);
      seen.add(d);
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("isDegradedError", () => {
  it("counts a stalled backend, not a refused request", () => {
    expect(isDegradedError(pg("57014"))).toBe(true);
    expect(isDegradedError(pg("PGRST002"))).toBe(true);
    expect(isDegradedError({ status: 502 })).toBe(true);
    expect(isDegradedError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isDegradedError(pg("42501"))).toBe(false);
    expect(isDegradedError(pg("23505"))).toBe(false);
    expect(isDegradedError({ status: 404 })).toBe(false);
  });
});

describe("degraded mode", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetBackendHealth();
  });
  afterEach(() => {
    resetBackendHealth();
    vi.useRealTimers();
  });

  it("enters after N degraded errors inside the window and leaves after the hold", () => {
    const changes: boolean[] = [];
    const off = onDegradedChange((d) => changes.push(d));
    for (let i = 0; i < DEGRADED_THRESHOLD - 1; i++) noteBackendError(pg("57014"));
    expect(isBackendDegraded()).toBe(false);
    noteBackendError(pg("PGRST002"));
    expect(isBackendDegraded()).toBe(true);
    expect(changes).toEqual([true]);

    vi.advanceTimersByTime(DEGRADED_HOLD_MS - 1);
    expect(isBackendDegraded()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(isBackendDegraded()).toBe(false);
    expect(changes).toEqual([true, false]);
    off();
  });

  it("does not enter when the errors are spread wider than the window", () => {
    for (let i = 0; i < DEGRADED_THRESHOLD; i++) {
      noteBackendError(pg("57014"));
      vi.advanceTimersByTime(DEGRADED_WINDOW_MS / (DEGRADED_THRESHOLD - 1) + 1);
    }
    expect(isBackendDegraded()).toBe(false);
  });

  it("ignores refusals and client errors", () => {
    for (let i = 0; i < DEGRADED_THRESHOLD * 3; i++) {
      noteBackendError(pg("42501"));
      noteBackendError(pg("23505"));
      noteBackendError({ status: 404 });
    }
    expect(isBackendDegraded()).toBe(false);
  });
});

describe("pollEvery", () => {
  beforeEach(() => { vi.useFakeTimers(); resetBackendHealth(); });
  afterEach(() => { resetBackendHealth(); vi.useRealTimers(); });

  it("slows a background poller while degraded and restores it after", () => {
    const interval = pollEvery(20_000);
    expect(interval()).toBe(20_000);
    for (let i = 0; i < DEGRADED_THRESHOLD; i++) noteBackendError(pg("57014"));
    expect(interval()).toBe(DEGRADED_POLL_MS);
    vi.advanceTimersByTime(DEGRADED_HOLD_MS);
    expect(interval()).toBe(20_000);
  });
});

describe("allowDegradedReport", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetBackendHealth();
  });
  afterEach(() => {
    resetBackendHealth();
    vi.useRealTimers();
  });

  const degrade = () => {
    for (let i = 0; i < DEGRADED_THRESHOLD; i++) noteBackendError(pg("57014"));
  };

  it("lets everything through while the backend is healthy", () => {
    expect(allowDegradedReport("telemetry")).toBe(true);
    expect(allowDegradedReport("telemetry")).toBe(true);
  });

  it("keeps the first report and drops the rest for a minute once degraded", () => {
    degrade();
    expect(allowDegradedReport("telemetry")).toBe(true);
    expect(allowDegradedReport("telemetry")).toBe(false);
    vi.advanceTimersByTime(59_000);
    expect(allowDegradedReport("telemetry")).toBe(false);
    vi.advanceTimersByTime(1_000);
    degrade();
    expect(allowDegradedReport("telemetry")).toBe(true);
  });

  it("counts the report made just before tipping over as the first", () => {
    expect(allowDegradedReport("toast")).toBe(true);
    degrade();
    expect(allowDegradedReport("toast")).toBe(false);
  });

  it("throttles telemetry and toasts separately", () => {
    degrade();
    expect(allowDegradedReport("telemetry")).toBe(true);
    expect(allowDegradedReport("toast")).toBe(true);
  });
});

/**
 * The mechanism App.tsx relies on, checked against the installed React Query: an
 * unfocused focusManager stops `refetchInterval`, lets a mutation through, and
 * polling comes back when focus is handed back to the browser. onlineManager is not
 * used because offline would also pause every mutation (see backendHealth.ts).
 */
describe("pausing polling through focusManager (react-query as installed)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    focusManager.setFocused(undefined);
    vi.useRealTimers();
  });

  it("stops refetchInterval while unfocused, keeps mutations, resumes after", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const queryFn = vi.fn(async () => 1);
    const observer = new QueryObserver(client, { queryKey: ["poll"], queryFn, refetchInterval: 1000 });
    const unsub = observer.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(3500);
    const before = queryFn.mock.calls.length;
    expect(before).toBeGreaterThanOrEqual(3);

    focusManager.setFocused(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(queryFn.mock.calls.length).toBe(before);

    const mutationFn = vi.fn(async () => "ok");
    await expect(client.getMutationCache().build(client, { mutationFn }).execute(undefined)).resolves.toBe("ok");
    expect(onlineManager.isOnline()).toBe(true);

    focusManager.setFocused(undefined);
    await vi.advanceTimersByTimeAsync(2500);
    expect(queryFn.mock.calls.length).toBeGreaterThan(before);
    unsub();
    client.clear();
  });
});
