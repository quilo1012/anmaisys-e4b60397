import { describe, it, expect } from "vitest";
import { cyclesToFix, explainTarget, familyFromName, fixSuggestion, FAMILY_SOURCE, isEstimateRate, isSampleProduct, lastShiftsRates, NO_HISTORY_SOURCE, planRates, productsWithoutCode, SAMPLE_BATCH_MINUTES, SAMPLE_SOURCE, type HistoryShift } from "./smartTargetRates";
import { lineCautions, SHOW_MIN_SCORED, type LineAccuracy } from "./smartTargetAccuracy";
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

describe("cautions beside a line's number", () => {
  const acc = (line: 1 | 2, scored: number, median: number | null): LineAccuracy => ({
    line, scored, frozenLate: 0, noNumber: 0, noActual: 0, oldMethod: 0, estimated: 0, endedEarly: 0, medianAbsPctError: median, within10: 0, within20: 0, recent: [],
  });

  it("uses the tested margin until a line has 10 measured shifts", () => {
    const c = lineCautions([acc(1, SHOW_MIN_SCORED - 1, 5), acc(2, 3, 40)], { 1: 22 });
    expect(c.find((x) => x.line === 1)?.caution).toMatch(/missed by a median 22%.*\(9 of 10 shifts measured so far\)/);
    expect(c.find((x) => x.line === 2)?.caution).toBeNull();
  });

  it("then lets each line's own record decide, both ways, and 15% exactly needs none", () => {
    const c = lineCautions([acc(1, 12, 15), acc(2, 20, 18)], { 1: 22 });
    expect(c.find((x) => x.line === 1)?.caution).toBeNull();
    expect(c.find((x) => x.line === 2)?.caution).toMatch(/last 20 measured shifts Line 2 missed by a median 18%/);
  });
});

describe("the solution and the reason shown for a target", () => {
  const rate = (value: number, source: string, sampleShifts = 25) => ({ line: 4 as const, sku: "CRE500", value, unit: "containers/hour", status: "provisional" as const, sampleShifts, source });

  it("turns the line's rate into the cycle to enter, as for Line 4's CRE500", () => {
    const s = fixSuggestion("CRE500", [rate(720, `${FAMILY_SOURCE}: last 25 shifts`)], 0.62);
    expect(s).toMatchObject({ perHour: 720, cycleSeconds: 3.1 });
    expect(s.why).toMatch(/last 25 shifts of this product.*720\/h at the line's 62% performance is a 3.1 s cycle/);
  });

  it("says to time a run when there is nothing to go on, and never suggests an impossible cycle", () => {
    expect(fixSuggestion("CRE500", [], 0.62)).toMatchObject({ perHour: null, cycleSeconds: null });
    expect(fixSuggestion("CRE500", [rate(5000, "x")], 0.5).cycleSeconds).toBeNull();
    expect(fixSuggestion("CRE500", [rate(720, "x")], null).cycleSeconds).toBeNull();
  });

  it("explains each job's part: a whole order, or the rate over the time left", () => {
    const job = (over: object) => ({ sku: "BEEFXPOM", expectedContainers: 1776, rate: { perHour: 292, sampleShifts: 0, source: "iTouch" }, allocation: { basis: "order_qty_at_rate", completesOrder: true, productiveMinutes: 400 }, ...over });
    const [whole, cut, none] = explainTarget([
      job({}),
      job({ sku: "BEEFXPCA", expectedContainers: 729, allocation: { basis: "order_qty_at_rate", completesOrder: false, productiveMinutes: 150 } }),
      job({ expectedContainers: null }),
    ] as never);
    expect(whole).toBe("BEEFXPOM: 1,776, the whole order, about 365 min at 292/h (an estimate: the line's usual rate).");
    expect(cut).toBe("BEEFXPCA: 729 = 292/h × 150 min left in the shift (an estimate: the line's usual rate).");
    expect(none).toBeUndefined();
  });
});

describe("the rule: the line's last shifts of this product (Q62a)", () => {
  const names: Record<string, string> = { EP16B: "ESSENTIAL PROTEIN 1.6KG BANANA", EP16WCC: "ESSENTIAL PROTEIN 1.6KG WHITE CHOC", CW825V: "CRITICAL WHEY 825G VANILLA" };
  const inputs = {
    cycles: [{ line: 1 as const, sku: "CW825V", idealPerHour: 720, cycleSeconds: 5, source: "iTouch" }],
    factor: { line: 1 as const, factor: 0.5, shiftsUsed: 40, excluded: [] },
    familyOf: (sku: string) => familyFromName(names[sku]),
    isSample: (sku: string) => isSampleProduct(sku, names[sku]),
  };
  const shift = (n: number, made: [string, number][]): HistoryShift => ({
    key: `2026-10-${String(n).padStart(2, "0")}|DAY|1`, line: 1, made: made.map(([sku, qty]) => ({ sku, qty })), netMinutes: 645, setupMinutes: 45,
  });
  const job = (sku: string, orderQty: number | null = 3000, batches = 1) => ({ jobId: sku, sku, sequence: 1, orderQty, batches });

  it("reads the family up to the fill size, without the market", () => {
    expect(familyFromName("ESSENTIAL PROTEIN 1.6KG WHITE CHOCOLATE - PERU")).toBe("ESSENTIAL PROTEIN 1.6KG");
    expect(familyFromName("NO SIZE HERE")).toBeNull();
  });

  it("gives a flavour never run there its family's rate, as EP16WCC on Line 1: about 1,600 a shift, not 3,000", () => {
    const history = [1, 2, 3].map((n) => shift(n, [["EP16B", 1600]]));
    const { rates } = planRates(1, [job("EP16WCC")], { ...inputs, history });
    expect(rates[0]).toMatchObject({ value: 160, sampleShifts: 3 });
    expect(rates[0].source.startsWith(FAMILY_SOURCE)).toBe(true);
    expect(isEstimateRate(rates[0].source)).toBe(false);
  });

  it("uses only the last 5 shifts, oldest dropped", () => {
    const history = [100, 100, 100, 1600, 1600, 1600, 1600, 1600].map((q, i) => shift(i + 1, [["EP16B", q]]));
    expect(lastShiftsRates(1, { ...inputs, history }).get("ESSENTIAL PROTEIN 1.6KG")).toEqual({ perHour: 160, shifts: 5 });
  });

  it("needs 2 shifts, and otherwise marks iTouch × factor as having no history", () => {
    const { rates } = planRates(1, [job("CW825V")], { ...inputs, history: [shift(1, [["CW825V", 1000]])] });
    expect(rates[0].value).toBe(360);
    expect(rates[0].source.startsWith(NO_HISTORY_SOURCE)).toBe(true);
    expect(isEstimateRate(rates[0].source)).toBe(true);
  });

  it("falls back to the line's usual rate, an estimate, and has nothing to say for a line with no shifts", () => {
    const history = [1, 2].map((n) => shift(n, [["EP16B", 1600]]));
    const { rates } = planRates(1, [job("NOSUCH")], { ...inputs, history });
    expect(rates[0]).toMatchObject({ value: 160, sampleShifts: 0 });
    expect(isEstimateRate(rates[0].source)).toBe(true);
    expect(planRates(1, [job("NOSUCH")], { ...inputs, history: [] }).rates).toEqual([]);
  });

  it("does not learn a family's rate from a shift with samples in it", () => {
    const history = [1, 2].map((n) => shift(n, [["EP16B", 1600], ["BLENDEDCOLX", 40]]));
    expect(lastShiftsRates(1, { ...inputs, history }).size).toBe(0);
  });
});

describe("sample bags are timed by the batch (Q63a, Q64a)", () => {
  const inputs = { cycles: [], factor: null, history: [], familyOf: () => null, isSample: (sku: string) => isSampleProduct(sku) };

  it("recognises BLENDED and SAMPLE, in the code or the name", () => {
    expect(isSampleProduct("BLENDEDCOLIMMUNBOG")).toBe(true);
    expect(isSampleProduct("HYDRATION + POWDER TROPICAL SAMPLE BAGS")).toBe(true);
    expect(isSampleProduct("XYZ", "ABE CANDY ICE BLAST SAMPLE")).toBe(true);
    expect(isSampleProduct("CRE500", "CREATINE 500G")).toBe(false);
  });

  it("makes a job take 185 min a batch, with its changeover and mixing inside that", () => {
    const { jobs, rates } = planRates(2, [{ jobId: "a", sku: "BLENDEDCOLX", sequence: 1, orderQty: 100, batches: 2 }], inputs);
    expect(rates[0].source.startsWith(SAMPLE_SOURCE)).toBe(true);
    expect((jobs[0].orderQty! / rates[0].value) * 60).toBeCloseTo(2 * SAMPLE_BATCH_MINUTES, 0);
    expect(jobs[0]).toMatchObject({ changeoverMinutes: 0, mixingMinutes: 0 });
    expect(isEstimateRate(rates[0].source)).toBe(false);
  });

  it("assumes one batch of about 46 bags when no quantity is known", () => {
    const { jobs } = planRates(2, [{ jobId: "a", sku: "BLENDEDCOLX", sequence: 1, orderQty: null }], inputs);
    expect(jobs[0].orderQty).toBe(46);
  });
});
