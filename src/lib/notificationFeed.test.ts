import { describe, it, expect } from "vitest";
import { askAvailability, notificationTarget } from "./notificationFeed";

const NOW = new Date("2026-10-24T05:00:00");
const ask = (over: Partial<{ status: string; on_date: string; starts_at: string }> = {}) => ({
  id: "a1", status: "open", on_date: "2026-10-24", starts_at: "06:00:00", ...over,
});

describe("askAvailability", () => {
  it("is open while the ask is open and has not started", () => {
    expect(askAvailability(ask(), NOW)).toBe("open");
  });

  it("is unavailable once it has started", () => {
    expect(askAvailability(ask({ starts_at: "04:00:00" }), NOW)).toBe("unavailable");
  });

  it("is unavailable when cancelled or closed", () => {
    expect(askAvailability(ask({ status: "cancelled" }), NOW)).toBe("unavailable");
    expect(askAvailability(ask({ status: "closed" }), NOW)).toBe("unavailable");
  });

  it("is unavailable when the ask is gone", () => {
    expect(askAvailability(undefined, NOW)).toBe("unavailable");
  });

  it("handles a night ask whose date is tomorrow", () => {
    expect(askAvailability(ask({ on_date: "2026-10-24", starts_at: "18:00:00" }), NOW)).toBe("open");
  });
});

describe("notificationTarget", () => {
  it("follows a path inside the app", () => {
    expect(notificationTarget({ action_url: "/dashboard/my-overtime?ask=a1", wo_id: null }))
      .toBe("/dashboard/my-overtime?ask=a1");
  });

  it("never follows an address outside it", () => {
    expect(notificationTarget({ action_url: "https://evil.example", wo_id: null })).toBeNull();
    expect(notificationTarget({ action_url: "//evil.example", wo_id: null })).toBeNull();
  });

  it("falls back to the work order", () => {
    expect(notificationTarget({ action_url: null, wo_id: "w1" })).toBe("/dashboard/wo/w1");
  });
});
