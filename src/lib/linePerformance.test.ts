import { describe, it, expect } from "vitest";
import {
  computePace,
  balanceLabel,
  lastEntryAgeMinutes,
  WARMUP_MINUTES,
  type PaceItem,
} from "./linePerformance";

// A day shift starting at 06:00 London. The tests move `now` around it rather
// than mocking the clock, so they say what hour of the shift they are testing.
const shiftStart = new Date("2026-08-08T06:00:00.000Z");
const at = (hoursIn: number) => new Date(shiftStart.getTime() + hoursIn * 3600_000);

const item = (over: Partial<PaceItem> = {}): PaceItem => ({
  ratePerHour: 1200,
  produced: 0,
  startedAt: null,
  finishedAt: null,
  ...over,
});

const base = { shiftStart, hasSession: true, hasLeader: true };

describe("computePace — the states that are not a percentage", () => {
  it("no session is 'line not started', not zero percent", () => {
    const r = computePace({ ...base, hasSession: false, items: [], now: at(5) });
    expect(r.kind).toBe("NO_SESSION");
  });

  it("a session with no items is 'no order' — the Tablet Line case today", () => {
    const r = computePace({ ...base, items: [], now: at(5) });
    expect(r.kind).toBe("NO_ORDER");
  });

  it("a session nobody logged into is its own state", () => {
    const r = computePace({ ...base, hasLeader: false, items: [item()], now: at(5) });
    expect(r.kind).toBe("NO_LEADER");
  });

  it("a SKU with no standard rate cannot be paced", () => {
    const r = computePace({ ...base, items: [item({ ratePerHour: null, produced: 900 })], now: at(5) });
    expect(r.kind).toBe("NO_RATE");
  });

  it("zero produced and no data are different answers", () => {
    const zero = computePace({ ...base, items: [item({ produced: 0 })], now: at(5) });
    const none = computePace({ ...base, items: [], now: at(5) });
    expect(zero.kind).toBe("PACE");
    expect(none.kind).toBe("NO_ORDER");
  });
});

describe("computePace — a shift that just started", () => {
  it("does not divide by an expectation of nearly zero", () => {
    const r = computePace({ ...base, items: [item({ produced: 5 })], now: at(0.05) }); // 3 min in
    expect(r.kind).toBe("WARMING_UP");
  });

  it("stays in warm-up right up to the threshold, then paces", () => {
    const justBefore = computePace({
      ...base,
      items: [item({ produced: 100 })],
      now: new Date(shiftStart.getTime() + (WARMUP_MINUTES - 1) * 60_000),
    });
    const justAfter = computePace({
      ...base,
      items: [item({ produced: 100 })],
      now: new Date(shiftStart.getTime() + (WARMUP_MINUTES + 1) * 60_000),
    });
    expect(justBefore.kind).toBe("WARMING_UP");
    expect(justAfter.kind).toBe("PACE");
  });

  it("never reports a wild percentage from the first units of the shift", () => {
    // 40 units in the first 2 minutes against 1200/h would be 1000%.
    const r = computePace({ ...base, items: [item({ produced: 40 })], now: at(0.033) });
    expect(r.kind).toBe("WARMING_UP");
  });
});

describe("computePace — the verdict", () => {
  it("measures against the time elapsed, not the whole shift", () => {
    // 1200/h for 5h = 6000 expected. The old screen compared 5760 against a
    // 13,200-unit shift plan and called this line BELOW TARGET at 44%.
    const r = computePace({ ...base, items: [item({ produced: 5760 })], now: at(5) });
    expect(r.kind).toBe("PACE");
    if (r.kind !== "PACE") return;
    expect(Math.round(r.expected)).toBe(6000);
    expect(Math.round(r.pct)).toBe(96);
    expect(r.verdict).toBe("ON_TARGET");
  });

  it("uses 95/75, the thresholds already on the floor", () => {
    const pctFor = (produced: number) => {
      const r = computePace({ ...base, items: [item({ produced })], now: at(5) });
      return r.kind === "PACE" ? r.verdict : r.kind;
    };
    expect(pctFor(5700)).toBe("ON_TARGET"); // 95.0%
    expect(pctFor(5699)).toBe("AT_RISK"); // 94.98%
    expect(pctFor(4500)).toBe("AT_RISK"); // 75.0%
    expect(pctFor(4499)).toBe("BELOW_TARGET"); // 74.98%
  });

  it("does not clamp a line running above standard", () => {
    const r = computePace({ ...base, items: [item({ produced: 7800 })], now: at(5) });
    expect(r.kind).toBe("PACE");
    if (r.kind !== "PACE") return;
    expect(Math.round(r.pct)).toBe(130);
  });

  it("measures a finished item over its own run, not the whole shift", () => {
    // Ran 06:00–08:00 at standard, then nothing. Two hours in it is on pace;
    // charging it for the five hours since would read 40%.
    const r = computePace({
      ...base,
      items: [item({ produced: 2400, startedAt: at(0), finishedAt: at(2) })],
      now: at(5),
    });
    expect(r.kind).toBe("PACE");
    if (r.kind !== "PACE") return;
    expect(Math.round(r.expected)).toBe(2400);
    expect(r.verdict).toBe("ON_TARGET");
  });

  it("measures the open item from when it started", () => {
    // The second SKU came on an hour ago. It is judged on that hour.
    const r = computePace({
      ...base,
      items: [
        item({ produced: 2400, startedAt: at(0), finishedAt: at(2) }),
        item({ produced: 1150, startedAt: at(4) }),
      ],
      now: at(5),
    });
    expect(r.kind).toBe("PACE");
    if (r.kind !== "PACE") return;
    expect(Math.round(r.expected)).toBe(3600); // 2400 + 1200
    expect(r.verdict).toBe("ON_TARGET");
  });

  it("falls back to the shift start when nobody recorded one", () => {
    // Line 3 and Line 4 both look like this today: output logged, no start time.
    const r = computePace({ ...base, items: [item({ produced: 853, startedAt: null })], now: at(5) });
    expect(r.kind).toBe("PACE");
    if (r.kind !== "PACE") return;
    expect(Math.round(r.expected)).toBe(6000);
    expect(r.verdict).toBe("BELOW_TARGET");
  });

  it("counts output from an unrated SKU while pacing only the rated one", () => {
    const r = computePace({
      ...base,
      items: [item({ produced: 5760 }), item({ ratePerHour: 0, produced: 400 })],
      now: at(5),
    });
    expect(r.kind).toBe("PACE");
    if (r.kind !== "PACE") return;
    expect(r.produced).toBe(6160);
    expect(Math.round(r.expected)).toBe(6000);
  });
});

describe("computePace — the night shift crossing midnight", () => {
  it("measures from 18:00 through to the small hours without a negative window", () => {
    const nightStart = new Date("2026-08-07T18:00:00.000Z");
    const twoAm = new Date("2026-08-08T02:00:00.000Z"); // 8h in, next calendar day
    const r = computePace({
      ...base,
      shiftStart: nightStart,
      items: [item({ produced: 9600 })],
      now: twoAm,
    });
    expect(r.kind).toBe("PACE");
    if (r.kind !== "PACE") return;
    expect(Math.round(r.expected)).toBe(9600);
    expect(r.verdict).toBe("ON_TARGET");
  });

  it("never returns a negative expectation if a clock skews backwards", () => {
    const r = computePace({
      ...base,
      items: [item({ produced: 100, startedAt: at(6) })],
      now: at(5),
    });
    // The open item's window is clamped at zero, so the only expectation left
    // is none — which is warm-up, not a division by a negative.
    expect(r.kind).toBe("WARMING_UP");
  });
});

describe("balanceLabel", () => {
  it("says COMPLETE instead of a negative balance", () => {
    expect(balanceLabel(5000, 5412)).toBe("COMPLETE");
    expect(balanceLabel(5000, 5000)).toBe("COMPLETE");
  });

  it("shows what is left while the order is open", () => {
    expect(balanceLabel(5000, 4600)).toBe("400");
  });

  it("has nothing to say without a plan", () => {
    expect(balanceLabel(0, 100)).toBe("—");
    expect(balanceLabel(null, 100)).toBe("—");
  });
});

describe("lastEntryAgeMinutes", () => {
  it("reports the age of the most recent entry", () => {
    const now = at(5);
    const age = lastEntryAgeMinutes(
      [at(3).toISOString(), at(4.5).toISOString(), null],
      now,
    );
    expect(age).toBe(30);
  });

  it("is null when nobody has typed anything", () => {
    expect(lastEntryAgeMinutes([null, undefined], at(5))).toBeNull();
  });
});
