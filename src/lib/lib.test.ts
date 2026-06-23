import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { formatDuration, formatMinutes } from "@/lib/formatDuration";
import { isWoOpen, countOpenWOs, WO_TERMINAL_STATUSES } from "@/lib/woStatus";
import { formatWONumber } from "@/lib/woFormat";
import {
  isWOAcknowledged,
  acknowledgeWOLocal,
  clearAcknowledgedWOLocal,
} from "@/lib/woAck";
import { getShift, SHIFT_LABEL } from "@/lib/shifts";
import {
  checkPasswordStrength,
  describePasswordError,
  generateStrongPassword,
} from "@/lib/passwordPolicy";

// ─── formatDuration / formatMinutes ─────────────────────────────────────────
describe("formatDuration", () => {
  it("renders Xh Ym from seconds", () => {
    expect(formatDuration(3600)).toBe("1h 0m");
    expect(formatDuration(5100)).toBe("1h 25m");
    expect(formatDuration(7200)).toBe("2h 0m");
    expect(formatDuration(0)).toBe("0h 0m");
  });
  it("rounds sub-minute remainders", () => {
    expect(formatDuration(89)).toBe("0h 1m"); // 1.48 min -> 1
    expect(formatDuration(90)).toBe("0h 2m"); // 1.5 min  -> 2
  });
  it("clamps negative values to zero", () => {
    expect(formatDuration(-500)).toBe("0h 0m");
  });
  it("returns em-dash for null/undefined/NaN", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(undefined)).toBe("—");
    expect(formatDuration(NaN)).toBe("—");
  });
});

describe("formatMinutes", () => {
  it("converts minutes into the Xh Ym format", () => {
    expect(formatMinutes(0)).toBe("0h 0m");
    expect(formatMinutes(45)).toBe("0h 45m");
    expect(formatMinutes(60)).toBe("1h 0m");
    expect(formatMinutes(125)).toBe("2h 5m");
  });
  it("returns em-dash for null/undefined/NaN", () => {
    expect(formatMinutes(null)).toBe("—");
    expect(formatMinutes(undefined)).toBe("—");
    expect(formatMinutes(NaN)).toBe("—");
  });
});

// ─── woStatus ───────────────────────────────────────────────────────────────
describe("isWoOpen", () => {
  it("only counts the literal 'open' status", () => {
    expect(isWoOpen("open")).toBe(true);
    expect(isWoOpen("received")).toBe(false);
    expect(isWoOpen("in_progress")).toBe(false);
    expect(isWoOpen("closed")).toBe(false);
    expect(isWoOpen(null)).toBe(false);
    expect(isWoOpen(undefined)).toBe(false);
  });
});

describe("countOpenWOs", () => {
  it("filters down to only open WOs", () => {
    const wos = [
      { status: "open" },
      { status: "open" },
      { status: "in_progress" },
      { status: "closed" },
    ];
    expect(countOpenWOs(wos)).toBe(2);
  });
  it("handles null / empty arrays", () => {
    expect(countOpenWOs(null)).toBe(0);
    expect(countOpenWOs(undefined)).toBe(0);
    expect(countOpenWOs([])).toBe(0);
  });
});

describe("WO_TERMINAL_STATUSES", () => {
  it("matches the agreed terminal states", () => {
    expect([...WO_TERMINAL_STATUSES].sort()).toEqual(
      ["closed", "completed", "finished", "force_closed"].sort()
    );
  });
});

// ─── woFormat ───────────────────────────────────────────────────────────────
describe("formatWONumber", () => {
  it("renders WO-YYYY-000XXX padded to 6 digits", () => {
    expect(formatWONumber(7, "2026-03-15T10:00:00Z")).toBe("WO-2026-000007");
    expect(formatWONumber(12345, "2025-01-01T00:00:00Z")).toBe("WO-2025-012345");
    expect(formatWONumber(999999, "2026-12-31T23:59:59Z")).toBe("WO-2026-999999");
  });
});

// ─── woAck (localStorage dedup) ─────────────────────────────────────────────
describe("woAck local acknowledgement tracker", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("acknowledges and reads back", () => {
    expect(isWOAcknowledged("wo-1")).toBe(false);
    acknowledgeWOLocal("wo-1");
    expect(isWOAcknowledged("wo-1")).toBe(true);
  });

  it("dedupes repeated acknowledgements", () => {
    acknowledgeWOLocal("wo-2");
    acknowledgeWOLocal("wo-2");
    acknowledgeWOLocal("wo-2");
    const stored = JSON.parse(localStorage.getItem("engineer_acknowledged_wos")!);
    expect(stored.filter((id: string) => id === "wo-2")).toHaveLength(1);
  });

  it("clears a single acknowledgement without touching others", () => {
    acknowledgeWOLocal("wo-a");
    acknowledgeWOLocal("wo-b");
    clearAcknowledgedWOLocal("wo-a");
    expect(isWOAcknowledged("wo-a")).toBe(false);
    expect(isWOAcknowledged("wo-b")).toBe(true);
  });

  it("survives corrupt localStorage payloads", () => {
    localStorage.setItem("engineer_acknowledged_wos", "{not json");
    expect(isWOAcknowledged("wo-x")).toBe(false);
    acknowledgeWOLocal("wo-x");
    expect(isWOAcknowledged("wo-x")).toBe(true);
  });
});

// ─── shifts ────────────────────────────────────────────────────────────────
describe("getShift", () => {
  function at(hour: number, minute = 0): Date {
    const d = new Date();
    d.setHours(hour, minute, 0, 0);
    return d;
  }
  it("classifies the day-shift window 06:00–17:59 as 'day'", () => {
    expect(getShift(at(6, 0))).toBe("day");
    expect(getShift(at(12, 30))).toBe("day");
    expect(getShift(at(17, 59))).toBe("day");
  });
  it("classifies the night-shift window 18:00–05:59 as 'night'", () => {
    expect(getShift(at(18, 0))).toBe("night");
    expect(getShift(at(23, 59))).toBe("night");
    expect(getShift(at(0, 0))).toBe("night");
    expect(getShift(at(5, 59))).toBe("night");
  });
  it("accepts ISO strings as well as Date", () => {
    expect(getShift("2026-03-15T10:00:00")).toBe("day");
    expect(getShift("2026-03-15T22:00:00")).toBe("night");
  });
  it("exposes human labels for both shifts", () => {
    expect(SHIFT_LABEL.day).toMatch(/Day/);
    expect(SHIFT_LABEL.night).toMatch(/Night/);
  });
});

// ─── passwordPolicy ─────────────────────────────────────────────────────────
describe("checkPasswordStrength", () => {
  it("rejects passwords shorter than 8 characters", () => {
    expect(checkPasswordStrength("short1").ok).toBe(false);
  });
  it("rejects obvious common passwords", () => {
    expect(checkPasswordStrength("password123").ok).toBe(false);
    expect(checkPasswordStrength("qwerty123").ok).toBe(false);
    expect(checkPasswordStrength("operator1234").ok).toBe(false);
  });
  it("rejects single repeated characters", () => {
    expect(checkPasswordStrength("aaaaaaaa").ok).toBe(false);
  });
  it("rejects company-name + obvious-word combos", () => {
    expect(checkPasswordStrength("AppliedTablet123").ok).toBe(false);
  });
  it("requires a mix of letters and numbers", () => {
    expect(checkPasswordStrength("abcdefgh").ok).toBe(false);
    expect(checkPasswordStrength("12345abc").ok).toBe(false); // sequence trap
  });
  it("accepts a reasonable mixed password", () => {
    expect(checkPasswordStrength("Maint3nance!Day").ok).toBe(true);
  });
});

describe("describePasswordError", () => {
  it("translates HIBP / breach errors", () => {
    expect(describePasswordError("Password is pwned")).toMatch(/data breach/i);
    expect(describePasswordError("compromised credential")).toMatch(/data breach/i);
  });
  it("translates weak-password errors", () => {
    expect(describePasswordError("weak_password")).toMatch(/too weak/i);
  });
  it("falls back to the original message", () => {
    expect(describePasswordError("Custom error")).toBe("Custom error");
  });
  it("handles empty input", () => {
    expect(describePasswordError(undefined)).toMatch(/failed/i);
    expect(describePasswordError(null)).toMatch(/failed/i);
  });
});

describe("generateStrongPassword", () => {
  it("respects the requested length within bounds", () => {
    expect(generateStrongPassword(16)).toHaveLength(16);
    expect(generateStrongPassword(8).length).toBeGreaterThanOrEqual(12); // floor
    expect(generateStrongPassword(64).length).toBeLessThanOrEqual(32); // ceiling
  });
  it("always contains a digit and a letter", () => {
    for (let i = 0; i < 20; i += 1) {
      const pwd = generateStrongPassword();
      expect(pwd).toMatch(/[A-Za-z]/);
      expect(pwd).toMatch(/\d/);
    }
  });
});
