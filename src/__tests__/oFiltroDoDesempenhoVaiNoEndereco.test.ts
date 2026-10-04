import { describe, expect, it } from "vitest";
import {
  PERF_ALL,
  parsePerfFilters,
  perfFiltersToParams,
  resolvePerfRange,
  withAnchor,
  withFarEnd,
  withPeriod,
  type PerfFilters,
} from "@/lib/performanceFilters";

/**
 * The two defects this closes arrived from opposite ends and were the same thing.
 *
 * "O filtro some quando aperta Back": the plate's six controls were `useState` seeded
 * from the factory clock, so leaving for a leader's scorecard and coming back rebuilt
 * them on today, on the running shift, on All leaders.
 *
 * "A AC-6776 aparecendo em setembro": AC-6776 is Filipi's, raised 03/10 at 04:09 on
 * the night shift, so its session date is 02/10 and a September card is right to leave
 * it out. What put it on screen was the period having quietly run to today — moving
 * "From" to 01/09 set `period` to `custom` and left the far end where it was.
 *
 * One is the period not surviving the journey; the other is the period not being what
 * was asked for. Both are about the plate not holding the answer it is showing.
 */

const DEFAULTS = { date: "2026-10-04", shift: "DAY" as const };

const base = (over: Partial<PerfFilters> = {}): PerfFilters => ({
  date: DEFAULTS.date,
  endDate: DEFAULTS.date,
  period: "day",
  shift: DEFAULTS.shift,
  line: PERF_ALL,
  leader: PERF_ALL,
  ...over,
});

const roundTrip = (f: PerfFilters) =>
  parsePerfFilters(perfFiltersToParams(f, DEFAULTS), DEFAULTS);

describe("the plate survives the walk to a scorecard and back", () => {
  it("brings every control back through the address", () => {
    const set = base({
      date: "2026-09-01", period: "month", shift: "NIGHT", line: "Line 2", leader: "Filipi",
    });
    expect(roundTrip(set)).toEqual({ ...set, endDate: "2026-09-01" });
  });

  it("writes nothing for the state the screen opens in", () => {
    // A short link, and — the reason that matters — an address carrying no shift
    // cannot be read as a shift having been chosen. Same rule as scorecardLinkPeriod.
    expect(perfFiltersToParams(base(), DEFAULTS).toString()).toBe("");
  });

  it("says ALL explicitly, because it is not the default the clock gives", () => {
    const q = perfFiltersToParams(base({ shift: "all" }), DEFAULTS);
    expect(q.get("shift")).toBe("ALL");
    expect(parsePerfFilters(q, DEFAULTS).shift).toBe("all");
  });

  it("keeps a custom period's far end, and only a custom period's", () => {
    const custom = base({ period: "custom", date: "2026-09-01", endDate: "2026-09-30" });
    expect(roundTrip(custom).endDate).toBe("2026-09-30");
    // `?to=` left over from a custom period somebody then switched to Month must not
    // survive as a narrowing nobody can see on the plate.
    const stale = new URLSearchParams({ from: "2026-09-01", period: "month", to: "2026-09-10" });
    expect(parsePerfFilters(stale, DEFAULTS).endDate).toBe("2026-09-01");
  });
});

describe("a hand-edited address gets a defensible answer, never a wrong one", () => {
  it("falls back to the day the screen opens on, never to everything", () => {
    for (const bad of ["", "today", "2026-02-31", "01/09/2026", "2026-9-1"]) {
      expect(parsePerfFilters(new URLSearchParams({ from: bad }), DEFAULTS).date).toBe(DEFAULTS.date);
    }
  });

  it("falls back to Day for a period it does not know", () => {
    expect(parsePerfFilters(new URLSearchParams({ period: "fortnight" }), DEFAULTS).period).toBe("day");
  });

  it("swaps a range typed backwards instead of drawing an empty board", () => {
    const q = new URLSearchParams({ from: "2026-09-30", to: "2026-09-01", period: "custom" });
    expect(parsePerfFilters(q, DEFAULTS)).toMatchObject({ date: "2026-09-01", endDate: "2026-09-30" });
  });

  it("reads a blank line or leader as no filter", () => {
    const q = new URLSearchParams({ line: "   ", leader: "" });
    expect(parsePerfFilters(q, DEFAULTS)).toMatchObject({ line: PERF_ALL, leader: PERF_ALL });
  });
});

describe("the period owns the dates", () => {
  it.each([
    ["day", "2026-09-15", "2026-09-15", "2026-09-15"],
    // 15/09/2026 is a Tuesday; the factory week starts Monday.
    ["week", "2026-09-15", "2026-09-14", "2026-09-20"],
    ["month", "2026-09-15", "2026-09-01", "2026-09-30"],
    ["quarter", "2026-09-15", "2026-07-01", "2026-09-30"],
    ["year", "2026-09-15", "2026-01-01", "2026-12-31"],
  ] as const)("%s anchored on %s covers %s → %s", (period, date, from, to) => {
    expect(resolvePerfRange({ period, date, endDate: date })).toEqual({ from, to });
  });

  it("gives custom the two ends it was given, in order", () => {
    expect(resolvePerfRange({ period: "custom", date: "2026-09-30", endDate: "2026-09-01" }))
      .toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });
});

describe("typing a From re-anchors the period instead of discarding it", () => {
  it("asks for September when September is picked on a monthly board", () => {
    // The defect, stated as the number it produced: this used to resolve to
    // 01/09 → 04/10, which is where AC-6776 (02/10, night) came from.
    const after = withAnchor(base({ period: "month" }), "2026-09-01");
    expect(after.period).toBe("month");
    expect(resolvePerfRange(after)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });

  it("stays on one day when the board is a day", () => {
    const after = withAnchor(base(), "2026-09-01");
    expect(resolvePerfRange(after)).toEqual({ from: "2026-09-01", to: "2026-09-01" });
  });

  it("leaves AC-6776's own night outside a September month", () => {
    // Raised 2026-10-03 04:09 Europe/London on NIGHT, so it belongs to 02/10.
    const { from, to } = resolvePerfRange(withAnchor(base({ period: "month" }), "2026-09-01"));
    expect("2026-10-02" > to).toBe(true);
    expect(from).toBe("2026-09-01");
  });

  it("only pushes the far end on a custom period, and only when overtaken", () => {
    const wide = base({ period: "custom", date: "2026-09-01", endDate: "2026-09-30" });
    expect(withAnchor(wide, "2026-09-10").endDate).toBe("2026-09-30");
    expect(withAnchor(wide, "2026-10-05").endDate).toBe("2026-10-05");
  });
});

describe("the far box and the Period select", () => {
  it("makes the period custom, because two independent ends is what custom means", () => {
    const after = withFarEnd(base({ period: "month", date: "2026-09-01" }), "2026-09-30");
    expect(after).toMatchObject({ period: "custom", date: "2026-09-01", endDate: "2026-09-30" });
  });

  it("pulls the near end back rather than refusing a far end before it", () => {
    // Only reachable from a hand-edited address — the To box carries `min={date}` — and
    // the answer has to be a period somebody can read off the plate. One day, named
    // twice, is that; a range running backwards is not, and nor is a silent refusal of
    // the date that was just typed.
    const after = withFarEnd(base({ date: "2026-10-04" }), "2026-09-30");
    expect(resolvePerfRange(after)).toEqual({ from: "2026-09-30", to: "2026-09-30" });
  });

  it("re-derives the far end when a calendar period is chosen", () => {
    const after = withPeriod(base({ period: "custom", endDate: "2026-12-31" }), "month");
    expect(after.endDate).toBe(after.date);
    expect(resolvePerfRange(after)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
  });

  it("keeps a far end worth keeping when custom is chosen", () => {
    const after = withPeriod(base({ date: "2026-09-01", endDate: "2026-09-30" }), "custom");
    expect(after.endDate).toBe("2026-09-30");
  });
});
