import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useOpsShift, OPS_RANGE_KEY } from "@/hooks/useOpsFilters";

describe("useOpsShift", () => {
  beforeEach(() => localStorage.clear());

  it("starts on all shifts", () => {
    const { result } = renderHook(() => useOpsShift());
    expect(result.current[0]).toBe("ALL");
  });

  it("remembers the choice for the next screen", () => {
    const { result } = renderHook(() => useOpsShift());
    act(() => result.current[1]("NIGHT"));
    expect(localStorage.getItem("ops:shift")).toBe("NIGHT");

    // A different screen mounting afterwards reads the same answer.
    const second = renderHook(() => useOpsShift());
    expect(second.result.current[0]).toBe("NIGHT");
  });

  it("moves both screens at once when they are mounted together", () => {
    // The real case this guards: Downtime and Maintenance Orders open side by side.
    // `storage` only fires for OTHER tabs, so without the custom event the second
    // screen would keep showing Day while the first had moved to Night.
    const a = renderHook(() => useOpsShift());
    const b = renderHook(() => useOpsShift());
    act(() => a.result.current[1]("DAY"));
    expect(b.result.current[0]).toBe("DAY");
  });

  it("ignores a stored value that is not a shift", () => {
    localStorage.setItem("ops:shift", "Day (06-18)");
    const { result } = renderHook(() => useOpsShift());
    expect(result.current[0]).toBe("ALL");
  });

  it("still opens when storage is blocked", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { result } = renderHook(() => useOpsShift());
    expect(() => act(() => result.current[1]("NIGHT"))).not.toThrow();
    // The screen keeps working; only the memory of it is lost.
    expect(result.current[0]).toBe("NIGHT");
    spy.mockRestore();
  });

  it("uses one range key for every screen", () => {
    expect(OPS_RANGE_KEY).toBe("ops");
  });
});
