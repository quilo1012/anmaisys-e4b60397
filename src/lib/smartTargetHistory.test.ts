import { describe, it, expect } from "vitest";
import { factorWindow, FORECAST_LINES, WIDE_MARGIN_LINES, historyFromSessions, type HistoryItem } from "./smartTargetHistory";
import { buildSkuCatalogue } from "./lineSku";
import { cleanCycles, lineFactors } from "./smartTargetRates";

const catalogue = buildSkuCatalogue([
  { id: "sku-a", code: "ABEENG", name: "A.B.E ENERGY", target_per_hour: 720 },
  { id: "sku-c", code: "CRE250", name: "CREATINE 250", target_per_hour: 0 },
]);
const s = (id: string, line: string, session_date: string, shift = "DAY") => ({ id, line, session_date, shift });
const it_ = (session_id: string, display_order: number, over: Partial<HistoryItem>): HistoryItem => ({
  session_id, display_order, sku_id: null, sku_code_text: null, actual_qty: 0, ...over,
});

describe("factorWindow", () => {
  it("reads the eight weeks before the forecast date, never the date itself", () => {
    expect(factorWindow("2026-11-05")).toEqual({ from: "2026-09-10", to: "2026-11-04" });
  });
});

describe("historyFromSessions", () => {
  it("adds up what was made per SKU across the shift's sessions, and charges the engine's setup", () => {
    const h = historyFromSessions(
      [s("a", "Line 4", "2026-11-03"), s("b", "Line 4", "2026-11-03"), s("c", "Tablet Line", "2026-11-03")],
      [
        it_("a", 1, { sku_id: "sku-a", actual_qty: 3000 }),
        it_("b", 1, { sku_code_text: "ABEENG", actual_qty: 500 }),
        it_("b", 2, { sku_id: "sku-c", actual_qty: 4000 }),
        it_("b", 3, { sku_id: "sku-c", actual_qty: null }),
      ],
      catalogue,
    );
    expect(h).toEqual([{
      key: "2026-11-03|DAY|4",
      line: 4,
      made: [{ sku: "ABEENG", qty: 3500 }, { sku: "CRE250", qty: 4000 }],
      // ABEENG was typed, but it is in the product list.
      unidentified: [],
      netMinutes: 645,
      // Start: mix 30 (previous unknown, no changeover). ABEENG → CRE250: 25 + 30.
      setupMinutes: 85,
    }]);
  });

  it("uses the real length of a night the clocks change", () => {
    const [h] = historyFromSessions([s("n", "Line 2", "2026-10-24", "NIGHT")], [it_("n", 1, { sku_id: "sku-a", actual_qty: 10 })], catalogue);
    expect(h.netMinutes).toBe(780 - 75);
  });

  it("keeps a shift with nothing logged, so the factor can say why it left it out", () => {
    const h = historyFromSessions([s("e", "Line 5", "2026-11-03")], [], catalogue);
    const [, , , , l5] = lineFactors(h, []);
    expect(l5.excluded).toEqual([{ key: "2026-11-03|DAY|5", reason: "Nothing logged as made." }]);
  });

  it("feeds lineFactors end to end", () => {
    // Line 4, ABEENG at 3.1 s: 3000 made = 155 ideal min, of 645 − 30 = 615 available → 0.252.
    const cycles = cleanCycles([{ line: "Filler Line 4", sku: "ABEENG", cycleSeconds: 3.1, cavities: 1, source: "test" }]).cycles;
    const sessions = Array.from({ length: 5 }, (_, i) => s(`d${i}`, "Line 4", `2026-10-0${i + 1}`));
    const items = sessions.map((x) => it_(x.id, 1, { sku_id: "sku-a", actual_qty: 3000 }));
    const l4 = lineFactors(historyFromSessions(sessions, items, catalogue), cycles)[3];
    expect(l4).toMatchObject({ line: 4, factor: 0.252, shiftsUsed: 5 });
  });
});

describe("which lines show a number", () => {
  it("is every line, with the tested margin of the two over the goal", () => {
    expect(FORECAST_LINES).toEqual([1, 2, 3, 4, 5, 6]);
    expect(WIDE_MARGIN_LINES).toEqual({ 1: 22, 3: 18 });
  });
});
