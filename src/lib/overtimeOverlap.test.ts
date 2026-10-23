import { describe, it, expect } from "vitest";
import { asksOverlap } from "@/lib/overtimeRequests";

const ask = (on_date: string, starts_at: string, ends_at: string) => ({ on_date, starts_at, ends_at });

describe("asksOverlap", () => {
  it("06:00–18:00 and 06:00–14:00 on the same date overlap", () => {
    expect(asksOverlap(ask("2026-10-27", "06:00", "18:00"), ask("2026-10-27", "06:00", "14:00"))).toBe(true);
  });
  it("back-to-back day shifts do not overlap", () => {
    expect(asksOverlap(ask("2026-10-27", "06:00", "14:00"), ask("2026-10-27", "14:00", "22:00"))).toBe(false);
  });
  it("a night shift running past midnight overlaps the early hours of the next day", () => {
    expect(asksOverlap(ask("2026-10-27", "18:00", "02:00"), ask("2026-10-28", "01:00", "05:00"))).toBe(true);
  });
  it("different days with no overnight spill do not overlap", () => {
    expect(asksOverlap(ask("2026-10-27", "06:00", "14:00"), ask("2026-10-28", "06:00", "14:00"))).toBe(false);
  });
});
