import { describe, it, expect } from "vitest";
import { blendOf, cleanMinutesByLine, cleaningRule, isPlainProduct, suggestAllergens, type CleanProduct } from "./smartTargetCleaning";
import { forecastShift, type PlannedJob, type RateRecord } from "./smartTargetEngine";
import { previewShifts } from "./smartTargetAhead";

// Pairs the L1–L3 PLAN sheets of "Time and motion studies New.xlsx" clean between.
const names: Record<string, string> = {
  CORTB1: "CREAM OF RICE TOFFEE BISCUIT 1KG",
  CORTB2: "CREAM OF RICE TOFFEE BISCUIT 2KG",
  AAKG: "AAKG 300G",
  BFWDC: "BODY FUEL WHEY DOUBLE CHOCOLATE 900G",
  BFWWCP: "BODY FUEL WHEY WHITE CHOC. PISTACHIO 900G",
  CMB: "CRITICAL MASS BANANA 2.4KG",
  CORAC: "CREAM OF RICE APPLE CRUMBLE 1KG",
  CWV: "CRITICAL WHEY VANILLA 2KG",
  BEEF: "BEEF-XP PINK MOJITO 900G",
  CRE: "CREATINE MONOHYDRATE 500G",
  CREHB: "CREATINE + HYDRATION BERRY SLUSH 360G",
};
const product = (confirmed: Record<string, string[]> = {}) => (sku: string): CleanProduct | null =>
  names[sku] ? { name: names[sku], allergens: confirmed[sku] ?? null } : null;
const noHistory = new Map();

describe("the cleaning rule from the plan sheet", () => {
  const rule = cleaningRule(1, product(), noHistory);

  it("needs nothing between batches of one blend, whatever the pack", () => {
    expect(blendOf(names.CORTB1)).toBe(blendOf(names.CORTB2));
    expect(rule("CORTB1", "CORTB2")).toBeNull();
  });

  it("drill cleans for a change of flavour", () => {
    expect(rule("BFWDC", "BFWWCP")).toMatchObject({ kind: "drill", minutes: 120, minutesFrom: "plan_sheet" });
  });

  it("deep cleans before a plain product, as Cream of Rice → AAKG", () => {
    expect(isPlainProduct(names.AAKG)).toBe(true);
    expect(isPlainProduct(names.CRE)).toBe(true);
    expect(isPlainProduct(names.CREHB)).toBe(false);
    expect(rule("CORTB2", "AAKG")).toMatchObject({ kind: "full", minutes: 240 });
  });

  it("deep cleans from milk to a product without it, as Critical Mass → Cream of Rice, and says when it is only suggested", () => {
    expect(suggestAllergens(names.CMB)).toEqual(["Milk"]);
    expect(suggestAllergens(names.BEEF)).toEqual([]);
    expect(rule("CMB", "CORAC")).toMatchObject({ kind: "full", reason: "from milk to a product without it (allergens not confirmed)" });
    // Confirmed on SKU Products, the note goes.
    const sure = cleaningRule(1, product({ CMB: ["Milk"], CORAC: [] }), noHistory);
    expect(sure("CMB", "CORAC")?.reason).toBe("from milk to a product without it");
    // Into milk is a drill clean, not a deep one.
    expect(rule("CORAC", "CWV")).toMatchObject({ kind: "drill" });
  });

  it("says nothing about a product it does not know", () => {
    expect(rule("CORTB1", "UNKNOWN")).toBeNull();
  });
});

describe("corrections from Production, 12/11", () => {
  const more: Record<string, string> = {
    BEEFGAINER3BM: "BEEF GAINER 3KG BLUEBERRY MUFFIN",
    BFBP500BR: "BODY FUEL BEEF PROTEIN 500G BLUE RASPBERRY",
    NEUMMWPV: "NOT FOR EU MUSCLE MOOSE WHEY PROTEIN 900G - VANILLA",
    MMWPS: "MUSCLE MOOSE WHEY PROTEIN 900G - STRAWBERRY",
  };
  const productOf = (sku: string): CleanProduct | null => (more[sku] ? { name: more[sku], allergens: null } : null);

  it("Line 5: Beef Gainer to Beef Protein is a drill clean, as neither has milk", () => {
    expect(suggestAllergens(more.BEEFGAINER3BM)).toEqual([]);
    expect(cleaningRule(5, productOf, noHistory)("BEEFGAINER3BM", "BFBP500BR")).toMatchObject({ kind: "drill" });
  });

  it("Line 6 does not drill clean: a flavour change there is an ordinary changeover", () => {
    expect(cleaningRule(6, productOf, noHistory)("NEUMMWPV", "MMWPS")).toBeNull();
    expect(cleaningRule(5, productOf, noHistory)("NEUMMWPV", "MMWPS")).toMatchObject({ kind: "drill" });
  });
});

describe("how long each line's cleans take", () => {
  const row = (line: string, date: string, reason: string, duration_minutes: number, shift = "DAY") => ({ line, date, shift, reason, duration_minutes });
  it("takes the median per clean, adding a clean's rows in one shift, leaving out overruns", () => {
    const m = cleanMinutesByLine([
      row("Line 1", "2026-11-01", "Drill Cleaning", 30), row("Line 1", "2026-11-01", "Drill Cleaning", 30),
      row("Line 1", "2026-11-02", "Drill Cleaning", 58), row("Line 1", "2026-11-03", "Drill Cleaning", 70),
      row("Line 1", "2026-11-03", "Over ran on drill clean", 40, "NIGHT"),
      row("Line 1", "2026-11-04", "Deep Clean", 90), row("Line 1", "2026-11-05", "Deep Clean", 95),
    ]);
    expect(m.get(1)).toEqual({ drill: { minutes: 60, cleans: 3 } });
    const rule = cleaningRule(1, product(), m);
    expect(rule("BFWDC", "BFWWCP")).toMatchObject({ kind: "drill", minutes: 60, minutesFrom: "line_history" });
    // Two deep cleans are too few: the plan's 240 stands.
    expect(rule("CORTB2", "AAKG")).toMatchObject({ kind: "full", minutes: 240, minutesFrom: "plan_sheet" });
  });
});

const rate = (sku: string, perHour: number): RateRecord => ({ line: 1, sku, value: perHour, unit: "containers/hour", status: "provisional", sampleShifts: 5, source: "test" });

describe("the engine charges the clean", () => {
  it("takes the clean's minutes in place of the changeover, and the target drops", () => {
    const jobs: PlannedJob[] = [
      { jobId: "a", sku: "CMB", sequence: 1, orderQty: 500 },
      { jobId: "b", sku: "CORAC", sequence: 2 },
    ];
    const base = { date: "2026-11-10", shift: "DAY" as const, line: 1, jobs, previousSku: "CMB", rates: [rate("CMB", 300), rate("CORAC", 300)] };
    const plain = forecastShift(base);
    const cleaned = forecastShift({ ...base, cleaning: cleaningRule(1, product(), noHistory) });
    expect(cleaned.jobs[1]).toMatchObject({ cleaning: { kind: "full", minutes: 240 }, changeoverMinutes: 240 });
    expect(plain.jobs[1].cleaning).toBeNull();
    expect(cleaned.expectedTotal!).toBeLessThan(plain.expectedTotal!);
  });
});

describe("the next shifts ahead of time", () => {
  // 600 an hour on Line 1 for both products: an ideal of 1,200 at a factor of 0.5.
  const cycles = ["CMB", "CORAC"].map((sku) => ({ line: 1 as const, sku, idealPerHour: 1200, cycleSeconds: 3, source: "test" }));
  const factors = [{ line: 1 as const, factor: 0.5, shiftsUsed: 30, excluded: [] }];
  const queue = [
    { line: "Line 1", seq: 1, sku: "CMB", order_qty: 6000, done_qty: 1000, status: "Running" },
    { line: "Line 1", seq: 2, sku: "CORAC", order_qty: 20000, done_qty: 0, status: "Queued" },
  ];
  const preview = (withCleans: boolean) => previewShifts({
    nowMs: Date.parse("2026-11-10T13:45:00Z"),
    queue, cycles, factors, history: [],
    cleaningFor: withCleans ? (line) => cleaningRule(line, product(), noHistory) : undefined,
  });

  it("forecasts tonight and tomorrow's day from the queue, after what the day still makes", () => {
    const shifts = preview(true);
    expect(shifts.map((s) => `${s.date} ${s.shift}`)).toEqual(["2026-11-10 NIGHT", "2026-11-11 DAY"]);
    const night = shifts[0].lines.find((l) => l.line === 1)!;
    // The day makes about 2,400 of CMB's 5,000 left, so the night finishes CMB, deep cleans
    // (milk to no milk) and starts CORAC.
    expect(night.jobs.map((j) => j.sku)).toEqual(["CMB", "CORAC"]);
    expect(night.jobs[1].cleaning).toMatchObject({ kind: "full", minutes: 240 });
    const day = shifts[1].lines.find((l) => l.line === 1)!;
    expect(day.jobs.map((j) => j.sku)).toEqual(["CORAC"]);
    expect(day.jobs[0].cleaning).toBeNull();
  });

  it("takes the clean off the night's number", () => {
    const night = (s: ReturnType<typeof preview>) => s[0].lines.find((l) => l.line === 1)!.expectedTotal!;
    expect(night(preview(true))).toBeLessThan(night(preview(false)));
  });
});
