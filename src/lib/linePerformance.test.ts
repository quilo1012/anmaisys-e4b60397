import { describe, it, expect } from "vitest";
import {
  computePace,
  lineScore,
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
    expect(zero.kind).toBe("NOTHING_LOGGED");
    expect(none.kind).toBe("NO_ORDER");
  });

  /**
   * Line 1, night shift, 08/08. A session, a leader (Cainan), an open COLPEP
   * order at 720/h, and `actual_qty` still 0 at 21:46 — while iTouching had the
   * machine in "Filling Blender/ Blending" seconds earlier. The board scored
   * that line 0%, painted the rail red and captioned it CRITICAL.
   *
   * Nothing on this system can tell "made nothing" from "typed nothing", and
   * the page knew it: it carried a banner underneath explaining that the 0% was
   * "not necessarily because nothing was made". A verdict that needs a footnote
   * retracting it is not a verdict. Zero entries is an absence of measurement,
   * and it belongs with the other states that say so.
   */
  it("a line with nothing typed is not a line running at zero percent", () => {
    const r = computePace({ ...base, items: [item({ produced: 0 })], now: at(3.77) });
    expect(r.kind).toBe("NOTHING_LOGGED");
  });

  it("one unit typed is a measurement, and is paced", () => {
    const r = computePace({ ...base, items: [item({ produced: 1 })], now: at(5) });
    expect(r.kind).toBe("PACE");
  });

  it("counts the whole line, not one empty order, before saying nothing was logged", () => {
    // Two SKUs on the line: the second has not started. The first was typed.
    const r = computePace({
      ...base,
      items: [item({ produced: 4800 }), item({ produced: 0 })],
      now: at(5),
    });
    expect(r.kind).toBe("PACE");
  });

  it("stays in warm-up rather than scolding a shift that opened ten minutes ago", () => {
    // Nothing typed yet at 06:10 is a shift starting, not a shift failing.
    const r = computePace({ ...base, items: [item({ produced: 0 })], now: at(0.16) });
    expect(r.kind).toBe("WARMING_UP");
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

  /** The item's own run, with the idle charge taken back off the expectation. */
  const ownRun = (expected: number, idleMinutes: number) =>
    Math.round(expected - (1200 / 60) * idleMinutes);

  it("measures a finished item over its own run, and charges the hours after it as idle", () => {
    // Ran 06:00–08:00 at standard, then nothing. Its own two hours are still
    // measured over its own window and worth 2,400 — not over the whole shift.
    //
    // What the three hours after it closed are worth is what changed. They used
    // to be worth nothing, so a line that finished at 08:00 and then stood still
    // read ON TARGET all afternoon — the SOLGUT case of 09/08, which printed
    // 115% for an idle line. They are now charged at the rate of the last
    // product the line was set up for, and 2,400 against 6,000 is the 40% this
    // line actually ran.
    const r = computePace({
      ...base,
      items: [item({ produced: 2400, startedAt: at(0), finishedAt: at(2) })],
      now: at(5),
    });
    expect(r.kind).toBe("PACE");
    if (r.kind !== "PACE") return;
    expect(r.idleMinutes).toBe(180);
    expect(ownRun(r.expected, r.idleMinutes)).toBe(2400);
    expect(Math.round(r.expected)).toBe(6000);
    expect(r.ordersOpen).toBe(0); // nothing open — the expectation is idle alone
    expect(r.verdict).toBe("BELOW_TARGET");
  });

  it("measures the open item from when it started, and the gap before it as idle", () => {
    // 06:00–08:00, then two hours with no order open, then a second SKU from
    // 10:00. The two runs are worth 2,400 + 1,200; the gap between them is
    // worth 2,400 more, and is the whole point of charging it.
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
    expect(r.idleMinutes).toBe(120);
    expect(ownRun(r.expected, r.idleMinutes)).toBe(3600); // 2400 + 1200
    expect(Math.round(r.expected)).toBe(6000);
    expect(r.ordersOpen).toBe(1);
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
    // The guarantee this test exists for is the one in its name: the window
    // collapses to nothing rather than to a negative, and `minutesBetween`
    // floors it at zero, so no expectation can ever come back below it.
    //
    // What it resolves to did change. It used to be warm-up: nothing covered
    // meant nothing to expect. An item that has not started is not covering the
    // shift, so since the idle charge all five hours are idle and the line is
    // paced against them — a reading, not a division by a negative.
    expect(r.kind).toBe("PACE");
    if (r.kind !== "PACE") return;
    expect(r.expected).toBeGreaterThanOrEqual(0);
    expect(r.idleMinutes).toBe(300);
    expect(Math.round(r.expected)).toBe(6000);
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

describe("lineScore — the card colours the figure it prints", () => {
  const paced = (produced: number) =>
    computePace({ ...base, items: [item({ produced })], now: at(5) }); // 6000 expected

  /**
   * Line 3, day shift, 09/08. 4,799 made against a 3,338 plan — 144% — and the
   * card printed it in grey, because `UAEABECIB` has no `target_per_hour` and so
   * `computePace` returned NO_RATE. The line had beaten its plan by 1,461 units
   * and the board would not say so.
   */
  it("a line that beat its plan is green even when its SKU cannot be paced", () => {
    const noRate = computePace({ ...base, items: [item({ ratePerHour: null, produced: 4799 })], now: at(5) });
    expect(noRate.kind).toBe("NO_RATE");

    const s = lineScore(noRate, 3338, 4799);
    expect(s).not.toBeNull();
    expect(s!.basis).toBe("PLAN");
    expect(Math.round(s!.pct)).toBe(144);
    expect(s!.band).toBe("GO");
  });

  it("prefers the pace when there is one, on the pace's own thresholds", () => {
    expect(lineScore(paced(5760), 13200, 5760)).toEqual({ basis: "PACE", pct: 96, band: "GO", attainedPct: (5760 / 13200) * 100 });
    expect(lineScore(paced(5400), 13200, 5400)?.band).toBe("HOLD"); // 90% of pace
    expect(lineScore(paced(4200), 13200, 4200)?.band).toBe("STOP"); // 70% of pace
  });

  it("uses 100/80 for a share of the plan, the same pair the status plate reads", () => {
    const noRate = (produced: number) =>
      computePace({ ...base, items: [item({ ratePerHour: null, produced })], now: at(5) });
    expect(lineScore(noRate(1000), 1000, 1000)?.band).toBe("GO");
    expect(lineScore(noRate(999), 1000, 999)?.band).toBe("HOLD");
    expect(lineScore(noRate(800), 1000, 800)?.band).toBe("HOLD");
    expect(lineScore(noRate(799), 1000, 799)?.band).toBe("STOP");
  });

  /**
   * The grey stays where it was invented for. Nothing here can tell a line that
   * made nothing from a line whose output nobody has typed, and a red 0% asserts
   * the first.
   */
  it("has nothing to colour when a line that cannot be paced has nothing logged", () => {
    const nothing = computePace({ ...base, items: [item({ produced: 0 })], now: at(5) });
    expect(nothing.kind).toBe("NOTHING_LOGGED");
    expect(lineScore(nothing, 13200, 0)).toBeNull();
  });

  it("has nothing to colour when a line that cannot be paced has no plan either", () => {
    const noOrder = computePace({ ...base, items: [], now: at(5) });
    expect(lineScore(noOrder, 0, 0)).toBeNull();
  });

  /**
   * Line 1, day shift: 299 made against a 3,233 plan, five hours in. The card
   * printed a single big figure — 60%, the pace — over a bar filled to 9% and a
   * plan of 3,233 written beside it. Two denominators on one card and only the
   * quiet one was labelled, so the number the supervisor could check against the
   * sheet was the one the card would not print.
   *
   * The share of the plan is now carried alongside the pace, so the card can
   * print "how much of the shift is done" without giving up the colour, which
   * still comes from the pace: at five hours into twelve, 9% of a plan is not a
   * verdict, and 60% of what was due is.
   */
  it("carries the share of the plan next to the pace, on the same result", () => {
    const s = lineScore(paced(299), 3233, 299);
    expect(s!.basis).toBe("PACE");
    expect(Math.round(s!.attainedPct)).toBe(9); // 299 / 3,233 — the bar and the plan beside it
    expect(s!.band).toBe("STOP"); // still judged on the pace, not on the 9%
  });

  it("gives the same figure twice when the plan IS the basis", () => {
    const closed = lineScore(undefined, 13200, 6600);
    expect(closed!.pct).toBe(50);
    expect(closed!.attainedPct).toBe(50);
  });

  it("has no share of a plan that does not exist", () => {
    const noPlan = computePace({ ...base, items: [item({ produced: 500 })], now: at(5) });
    expect(lineScore(noPlan, 0, 500)?.attainedPct).toBe(0);
  });

  /**
   * A week or a month asks no pace at all — "by now" is not a question once the
   * period is over — so the plan comparison is the only reading, including the
   * zero that a planned line with nothing logged deserves to be shown in red.
   */
  it("scores a closed period against the plan, zeroes included", () => {
    expect(lineScore(undefined, 13200, 13500)?.band).toBe("GO");
    expect(lineScore(undefined, 13200, 0)).toEqual({ basis: "PLAN", pct: 0, band: "STOP", attainedPct: 0 });
  });
});
