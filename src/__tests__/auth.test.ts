import { describe, it, expect } from "vitest";
import { currentShift, withTimeout } from "@/contexts/AuthContext";

describe("currentShift", () => {
  it("returns Day or Night", () => {
    const s = currentShift();
    expect(["Day", "Night"]).toContain(s);
  });
  it("10:00 London → Day", () => {
    // Pick a UTC instant guaranteed to be 10:00 in London (works year-round).
    const d = new Date("2025-06-15T09:00:00Z"); // 10:00 BST
    expect(currentShift(d)).toBe("Day");
  });
  it("22:00 London → Night", () => {
    const d = new Date("2025-06-15T21:00:00Z"); // 22:00 BST
    expect(currentShift(d)).toBe("Night");
  });
});

describe("withTimeout", () => {
  it("resolves when the promise settles first", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 5000)).resolves.toBe("ok");
  });
  it("rejects when the timeout fires first", async () => {
    await expect(withTimeout(new Promise(() => {}), 50)).rejects.toThrow("timeout");
  });
  it("forwards underlying rejection", async () => {
    await expect(withTimeout(Promise.reject(new Error("boom")), 5000)).rejects.toThrow("boom");
  });
});
