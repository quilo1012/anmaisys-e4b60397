import { describe, it, expect } from "vitest";
import { cleanCycles, lineFactors, ratesForLine, type CycleRecord, type HistoryShift } from "./smartTargetRates";
import { forecastShift } from "./smartTargetEngine";

const rec = (line: string, sku: string, cycleSeconds: number | null, over: Partial<CycleRecord> = {}): CycleRecord => ({
  line, sku, cycleSeconds, cavities: 1, source: "iTouch Product Details 02/11/2026", ...over,
});

describe("cleanCycles", () => {
  it("turns seconds per container into an ideal hourly rate", () => {
    const { cycles } = cleanCycles([rec("Filler Line 1", "ABEENG", 3.6)]);
    expect(cycles).toEqual([expect.objectContaining({ line: 1, sku: "ABEENG", idealPerHour: 1000 })]);
  });

  it("leaves tablet, capsule and gel machines out without calling them faults", () => {
    const r = cleanCycles([rec("Tablet Line", "AAKG", 1), rec("Capsules MC 1", "AAKG", 1), rec("GEL Machine", "X", 3.5)]);
    expect(r.cycles).toEqual([]);
    expect(r.rejected).toEqual([]);
  });

  it("lists missing and implausible cycles for Production instead of using them", () => {
    const { cycles, rejected } = cleanCycles([
      rec("Filler Line 5", "AAKG300", null),
      rec("Filler Line 4", "FAST", 0.31),
      rec("Filler Line 2", "SLOW", 64.125),
    ]);
    expect(cycles).toEqual([]);
    expect(rejected.map((r) => r.reason)).toEqual([
      "No standard cycle time in iTouch.",
      "Cycle of 0.31 s is below 1.5 s, which is not plausible.",
      "Cycle of 64.125 s is above 20 s, which looks like a data-entry error.",
    ]);
  });

  it("refuses to pick between two cycle times for the same product and line", () => {
    const { cycles, rejected } = cleanCycles([rec("Filler Line 1", "ABEENG", 3.5), rec("Line 1", "ABEENG-B2", 3.2)]);
    expect(cycles).toEqual([]);
    expect(rejected[0].reason).toMatch(/2 different cycle times/);
  });
});

describe("lineFactors", () => {
  const cycles = cleanCycles([rec("Filler Line 1", "ABEENG", 3.6), rec("Filler Line 1", "COL", 6)]).cycles;
  // Available = 645 − 45 = 600 min. ABEENG ideal is 3.6 s, so qty = ratio × 10 000.
  const shift = (key: string, qty: number, over: Partial<HistoryShift> = {}): HistoryShift => ({
    key, line: 1, made: [{ sku: "ABEENG", qty }], netMinutes: 645, setupMinutes: 45, ...over,
  });

  it("takes the median of (made × ideal seconds) ÷ time left after setup", () => {
    const [l1] = lineFactors([5000, 6000, 5500, 4000, 7000].map((q, i) => shift(`s${i}`, q)), cycles);
    expect(l1).toMatchObject({ line: 1, factor: 0.55, shiftsUsed: 5, excluded: [] });
  });

  it("gives no factor below the minimum number of shifts", () => {
    const [l1] = lineFactors([shift("a", 5000), shift("b", 6000)], cycles);
    expect(l1.factor).toBeNull();
    expect(l1.shiftsUsed).toBe(2);
  });

  it("leaves out a shift it cannot measure, and says why", () => {
    const [l1] = lineFactors([
      shift("empty", 0),
      shift("unknown", 0, { made: [{ sku: "NOCYCLE", qty: 100 }] }),
      shift("too-fast", 20000), // 200% of ideal: the record is wrong
      shift("all-setup", 100, { setupMinutes: 700 }),
    ], cycles);
    expect(l1.excluded.map((e) => [e.key, e.reason])).toEqual([
      ["empty", "Nothing logged as made."],
      ["unknown", "No usable cycle time for NOCYCLE."],
      ["too-fast", "Would mean 200% of ideal speed; the record is wrong."],
      ["all-setup", "Setup takes the whole shift."],
    ]);
  });

  it("adds the ideal time of every SKU made in a shift", () => {
    // 3000 ABEENG × 3.6 s = 180 min, 1800 COL × 6 s = 180 min → 360 of 600 = 0.6.
    const mixed = Array.from({ length: 5 }, (_, i) => shift(`m${i}`, 0, { made: [{ sku: "ABEENG", qty: 3000 }, { sku: "COL", qty: 1800 }] }));
    expect(lineFactors(mixed, cycles)[0].factor).toBe(0.6);
  });
});

describe("ratesForLine into the engine", () => {
  it("feeds provisional rates that give a number with low confidence", () => {
    const cycles = cleanCycles([rec("Filler Line 1", "ABEENG", 3.6)]).cycles;
    const factor = { line: 1 as const, factor: 0.55, shiftsUsed: 5, excluded: [] };
    const rates = ratesForLine(1, cycles, factor);
    expect(rates).toEqual([expect.objectContaining({ sku: "ABEENG", value: 550, status: "provisional", sampleShifts: 5 })]);
    expect(rates[0].source).toMatch(/3.6 s ideal × Line 1 performance 55% \(5 shifts\)/);

    const r = forecastShift({
      date: "2026-11-03", shift: "DAY", line: "Line 1", previousSku: "ABEENG",
      jobs: [{ jobId: "J1", sku: "ABEENG", sequence: 1, plannedStart: "2026-11-03T06:00:00Z", plannedEnd: "2026-11-03T18:00:00Z" }],
      breaks: [{ start: "2026-11-03T12:00:00Z", end: "2026-11-03T13:15:00Z" }],
      rates,
    });
    expect(r.expectedTotal).toBe(5913); // 550/h × 645 min
    expect(r.confidence).toBe("low");
  });

  it("gives no rates to a line without a factor", () => {
    const cycles = cleanCycles([rec("Filler Line 1", "ABEENG", 3.6)]).cycles;
    expect(ratesForLine(1, cycles, { line: 1, factor: null, shiftsUsed: 2, excluded: [] })).toEqual([]);
  });
});
