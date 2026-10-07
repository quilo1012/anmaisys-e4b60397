import { describe, it, expect } from "vitest";
import { expiryFromChoice, isExpired, expiryLabel } from "./inviteExpiry";

const now = new Date("2026-10-06T20:00:00Z");

describe("expiryFromChoice", () => {
  it("counts whole days from now, and never is null", () => {
    expect(expiryFromChoice("1d", now)).toBe("2026-10-07T20:00:00.000Z");
    expect(expiryFromChoice("7d", now)).toBe("2026-10-13T20:00:00.000Z");
    expect(expiryFromChoice("30d", now)).toBe("2026-11-05T20:00:00.000Z");
    expect(expiryFromChoice("never", now)).toBeNull();
  });
});

describe("isExpired", () => {
  it("agrees with the database: null never expires, the instant itself is expired", () => {
    expect(isExpired(null, now)).toBe(false);
    expect(isExpired("2026-10-06T20:00:00Z", now)).toBe(true);
    expect(isExpired("2026-10-06T20:00:01Z", now)).toBe(false);
    expect(isExpired("2026-10-01T00:00:00Z", now)).toBe(true);
  });
});

describe("expiryLabel", () => {
  it("says it the way a person would", () => {
    expect(expiryLabel(null, now)).toBe("never expires");
    expect(expiryLabel("2026-10-12T20:00:00Z", now)).toBe("expires in 6 days");
    expect(expiryLabel("2026-10-07T20:00:00Z", now)).toBe("expires in 1 day");
    expect(expiryLabel("2026-10-06T23:00:00Z", now)).toBe("expires in 3 hours");
    expect(expiryLabel("2026-10-06T20:20:00Z", now)).toBe("expires in 20 min");
    expect(expiryLabel("2026-10-04T20:00:00Z", now)).toBe("expired 2 days ago");
  });
});
