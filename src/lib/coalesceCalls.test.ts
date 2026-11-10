import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { coalesceCalls } from "./coalesceCalls";

describe("coalesceCalls", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("runs once after a burst, not once per call", () => {
    const fn = vi.fn();
    const call = coalesceCalls(fn, 500);
    for (let i = 0; i < 40; i++) call();
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("runs again for a later, separate burst", () => {
    const fn = vi.fn();
    const call = coalesceCalls(fn, 500);
    call();
    vi.advanceTimersByTime(500);
    call();
    vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("a steady stream still fires by maxWaitMs", () => {
    const fn = vi.fn();
    const call = coalesceCalls(fn, 500, 2_000);
    // A call every 300 ms never leaves a 500 ms gap.
    for (let t = 0; t < 2_000; t += 300) {
      call();
      vi.advanceTimersByTime(300);
    }
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("cancel drops the pending call", () => {
    const fn = vi.fn();
    const call = coalesceCalls(fn, 500);
    call();
    call.cancel();
    vi.advanceTimersByTime(1000);
    expect(fn).not.toHaveBeenCalled();
  });
});
