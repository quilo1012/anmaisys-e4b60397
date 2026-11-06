import { describe, it, expect } from "vitest";
import { ESTIMATED_SOURCE, withEstimates, BASE_SOURCE, baseRates, cyclesToFix, lineRates, observedRates, productsWithoutCode, OBSERVED_SOURCE, type HistoryShift } from "./smartTargetRates";
import { lineVisibility, SHOW_MIN_SCORED, type LineAccuracy } from "./smartTargetAccuracy";
import { historyFromSessions } from "./smartTargetHistory";
import { buildSkuCatalogue } from "./lineSku";

/** One shift of a line: net 645 min, 0 setup unless given. */
const shift = (n: number, line: 4 | 2, made: [string | null, number][], over: Partial<HistoryShift> = {}): HistoryShift => ({
  key: `2026-10-${String(n).padStart(2, "0")}|DAY|${line}`,
  line,
  made: made.map(([sku, qty]) => ({ sku, qty })),
  netMinutes: 645,
  setupMinutes: 0,
  ...over,
});

describe("observed rates (Q43a): the line's own speed where iTouch has no usable cycle", () => {
  // Line 4, measured 05/11: PERUCRE500 filled alone about 7,530 a shift.
  const history = [
    shift(1, 4, [["PERUCRE500", 7530]]),
    shift(2, 4, [["PERUCRE500", 7400]]),
    shift(3, 4, [["PERUCRE500", 7700]], { setupMinutes: 25 }),
    shift(4, 4, [["PERUCRE500", 3000], ["CRE250", 5000]]), // two products: not used
    shift(5, 4, [["CRE500", 7651]]),
  ];

  it("is the median of shifts that filled only that product, net of setup, and says where it came from", () => {
    const [r, ...rest] = observedRates(4, history);
    expect(rest).toEqual([]); // CRE500 has one shift, 3 needed
    expect(r.sku).toBe("PERUCRE500");
    // 7530 / 645 min × 60 = 700.5/h is the median of 688.4, 700.5 and 745.2.
    expect(r.value).toBe(700.5);
    expect(r).toMatchObject({ unit: "containers/hour", status: "provisional", sampleShifts: 3 });
    expect(r.source.startsWith(OBSERVED_SOURCE)).toBe(true);
  });

  it("never replaces iTouch: it only fills products iTouch has no usable cycle for", () => {
    // Line 5 has no base, so only these two sources answer there.
    const line5 = history.map((h) => ({ ...h, line: 5 as const }));
    const cycles = [{ line: 5 as const, sku: "PERUCRE500", idealPerHour: 1161, cycleSeconds: 3.1, source: "iTouch" }];
    const factor = { line: 5 as const, factor: 0.62, shiftsUsed: 66, excluded: [] };
    const rates = lineRates(5, cycles, factor, line5);
    expect(rates).toHaveLength(1);
    expect(rates[0].source.startsWith("iTouch")).toBe(true);
    expect(lineRates(5, [], factor, line5)[0].source.startsWith(OBSERVED_SOURCE)).toBe(true);
    // A line with no factor still gets its observed rates.
    expect(lineRates(5, [], null, line5)).toHaveLength(1);
  });
});

describe("the line base", () => {
  it("comes first on the lines it improved, and carries where it came from", () => {
    const cycles = [{ line: 4 as const, sku: "PERUCRE500", idealPerHour: 923, cycleSeconds: 3.9, source: "iTouch" }];
    const [r] = lineRates(4, cycles, { line: 4, factor: 0.65, shiftsUsed: 66, excluded: [] }, []).filter((x) => x.sku === "PERUCRE500");
    expect(r.value).toBe(787);
    expect(r.source.startsWith(BASE_SOURCE)).toBe(true);
    expect(r.sampleShifts).toBe(25);
  });

  it("leaves Line 5 on iTouch × factor, where it did not improve", () => {
    expect(baseRates(5)).toEqual([]);
    expect(baseRates(4).length).toBeGreaterThan(50);
  });

  it("holds plausible rates only, with no product twice on a line", () => {
    for (const line of [1, 2, 3, 4, 6] as const) {
      const rows = baseRates(line);
      expect(new Set(rows.map((r) => r.sku)).size).toBe(rows.length);
      for (const r of rows) expect(r.value).toBeGreaterThan(0);
    }
  });

  it("does not hide a product it does not know: iTouch × factor and observed still answer", () => {
    const cycles = [{ line: 4 as const, sku: "NOSUCHSKU2", idealPerHour: 1000, cycleSeconds: 3.6, source: "iTouch" }];
    const r = lineRates(4, cycles, { line: 4, factor: 0.5, shiftsUsed: 9, excluded: [] }, []).find((x) => x.sku === "NOSUCHSKU2");
    expect(r?.value).toBe(500);
  });
});

describe("a product with no rate anywhere (Q56a)", () => {
  const rate = (sku: string, value: number) => ({ line: 2 as const, sku, value, unit: "containers/hour", status: "provisional" as const, sampleShifts: 9, source: "x" });

  it("gets the median of the line's rates, marked as an estimate, and known rates stay", () => {
    const out = withEstimates(2, ["A", "BLENDEDCOLX", "blendedcolx", null], [rate("A", 100), rate("B", 300), rate("C", 900)]);
    expect(out).toHaveLength(4);
    expect(out[3]).toMatchObject({ sku: "BLENDEDCOLX", value: 300, sampleShifts: 0 });
    expect(out[3].source.startsWith(ESTIMATED_SOURCE)).toBe(true);
    expect(out[0].value).toBe(100);
  });

  it("makes nothing up for a line with no rates at all", () => {
    expect(withEstimates(2, ["BLENDEDCOLX"], [])).toEqual([]);
  });
});

describe("Fix in iTouch (Q44a): only what the lines actually filled", () => {
  const history = [
    shift(1, 4, [["PERUCRE500", 7530]]),
    shift(2, 4, [["PERUCRE500", 7400]]),
    shift(3, 4, [["PERUCRE500", 7700]]),
    shift(4, 4, [["CRE250", 11345]]),
    shift(5, 2, [["NOSUCHSKU1", 900]], { unidentified: [{ text: "BODY FUEL WATERMELON 320G", qty: 400 }] }),
  ];
  const cycles = [{ line: 4 as const, sku: "CRE250", idealPerHour: 1714, cycleSeconds: 2.1, source: "iTouch" }];
  const rejected = [
    { line: "Filler Line 4", sku: "PERUCRE500", cycleSeconds: 0.31, reason: "Cycle of 0.31 s is below 1.5 s, which is not plausible." },
    { line: "Filler Line 6", sku: "NEVERMADE", cycleSeconds: 0.2, reason: "x" },
  ];

  it("lists the rejected and missing cycles of products made, biggest first, and whether a rate covers them meanwhile", () => {
    expect(cyclesToFix(history, cycles, rejected)).toEqual([
      { line: 4, sku: "PERUCRE500", itouchSeconds: 0.31, problem: rejected[0].reason, madeQty: 22630, shifts: 3, coveredMeanwhile: true },
      { line: 2, sku: "NOSUCHSKU1", itouchSeconds: null, problem: "No cycle time for this product on this line in iTouch.", madeQty: 900, shifts: 1, coveredMeanwhile: false },
    ]);
  });

  it("lists names logged instead of a product code", () => {
    expect(productsWithoutCode(history)).toEqual([{ line: 2, text: "BODY FUEL WATERMELON 320G", qty: 400 }]);
  });

  it("history lists the typed text of an item that is not in the product list", () => {
    const catalogue = buildSkuCatalogue([{ id: "k1", code: "CRE250", name: "Creatine 250", target_per_hour: 0 }]);
    const [h] = historyFromSessions(
      [{ id: "s1", line: "Line 4", session_date: "2026-10-01", shift: "DAY", started_at: "2026-10-01T06:00:00Z" }],
      [
        { session_id: "s1", display_order: 1, sku_id: "k1", sku_code_text: null, actual_qty: 100 },
        { session_id: "s1", display_order: 2, sku_id: null, sku_code_text: "  Body  Fuel 320G ", actual_qty: 40 },
      ],
      catalogue,
    );
    expect(h.unidentified).toEqual([{ text: "Body Fuel 320G", qty: 40 }]);
    // Still in what was made, under its typed text, as before.
    expect(h.made).toEqual([{ sku: "CRE250", qty: 100 }, { sku: "Body Fuel 320G", qty: 40 }]);
  });
});

describe("which lines are shown (Q45a)", () => {
  const acc = (line: 1 | 2, scored: number, median: number | null): LineAccuracy => ({
    line, scored, frozenLate: 0, noNumber: 0, noActual: 0, medianAbsPctError: median, within10: 0, within20: 0, recent: [],
  });
  const reasons = { 1: "Line 1 varied in October." };

  it("keeps the starting choice until a line has 10 measured shifts", () => {
    const v = lineVisibility([acc(1, SHOW_MIN_SCORED - 1, 5), acc(2, 3, 40)], [2, 4, 5], reasons);
    expect(v.find((x) => x.line === 1)).toMatchObject({ shown: false });
    expect(v.find((x) => x.line === 1)?.heldBack).toMatch(/Line 1 varied in October\. On the tablet once 10 measured shifts .* \(9 of 10 shifts measured so far\)/);
    expect(v.find((x) => x.line === 2)).toMatchObject({ shown: true, heldBack: null });
  });

  it("then lets each line's own record decide, both ways", () => {
    const v = lineVisibility([acc(1, 12, 14.5), acc(2, 20, 18)], [2, 4, 5], reasons);
    expect(v.find((x) => x.line === 1)).toMatchObject({ shown: true, heldBack: null });
    expect(v.find((x) => x.line === 2)).toMatchObject({ shown: false });
    expect(v.find((x) => x.line === 2)?.heldBack).toBe("Over its last 20 measured shifts Line 2 missed by a median 18%. Back on the tablet once that is 15% or less.");
  });

  it("15% exactly is shown, and with no accuracy at all the starting choice stands", () => {
    expect(lineVisibility([acc(1, 10, 15)], [], {})[0].shown).toBe(true);
    expect(lineVisibility(null, [2, 4, 5], {}).filter((v) => v.shown).map((v) => v.line)).toEqual([2, 4, 5]);
  });
});
