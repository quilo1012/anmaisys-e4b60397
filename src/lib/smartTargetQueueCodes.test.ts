import { describe, it, expect } from "vitest";
import { buildSkuCatalogue } from "./lineSku";
import { canonicalQueue, canonicalQueueCode, familyWithQueue, unknownQueueCodes } from "./smartTargetHistory";
import { planAtStart, versusPlan, type StoredForecast } from "./smartTargetAccuracy";
import { ENGINE_VERSION } from "./smartTargetEngine";

const catalogue = buildSkuCatalogue([
  { id: "1", code: "CRE250", name: "CREATINE MONOHYDRATE POWDER 250g", target_per_hour: null },
  { id: "2", code: "CRE250MOROCCO", name: "CREATINE MONOHYDRATE 250g MOROCCO", target_per_hour: null },
  { id: "3", code: "DYNAMICMASSV", name: "DYNAMIC MASS GAINER 750G VANILLA", target_per_hour: null },
  { id: "4", code: "PERUCRE500", name: "PERU CREATINE 500G", target_per_hour: null },
  { id: "5", code: "CRE500", name: "CREATINE MONOHYDRATE POWDER 500g", target_per_hour: null },
]);

describe("queued codes as the product list knows them (Q85)", () => {
  const canon = canonicalQueueCode(catalogue);
  it("takes a market off a code the list does not have, as CRE250PAKISTAN on 10/11", () => {
    expect(canon("CRE250PAKISTAN")).toBe("CRE250");
    expect(canon("CRE250PAKISTAN - B3")).toBe("CRE250");
    expect(canon("NEUCRE500")).toBe("CRE500");
  });

  it("leaves a listed code alone, market and all", () => {
    expect(canon("CRE250MOROCCO")).toBe("CRE250MOROCCO");
    expect(canon("PERUCRE500")).toBe("PERUCRE500");
    expect(canon("CRE500 - B15")).toBe("CRE500 - B15");
  });

  it("places an unlisted code by iTouch's description, as DYM750V with the line's DYNAMICMASSV", () => {
    const queue = canonicalQueue([{ line: "Line 1", sku: "DYM750V", description: "DYNAMIC MASS GAINER 750G VANILLA" }], catalogue);
    const familyOf = familyWithQueue(catalogue, queue);
    expect(familyOf("DYM750V")).toBe(familyOf("DYNAMICMASSV"));
    expect(familyOf("DYM750V")).toBe("DYNAMIC MASS GAINER 750G");
  });

  it("lists the codes still unplaced, leaving out samples and those placed", () => {
    const rows = [
      { line: "Line 1", sku: "DYM750V", description: null },
      { line: "Line 1", sku: "DYM750C - B2", description: "DYNAMIC MASS GAINER 750G CHOCOLATE" },
      { line: "Line 4", sku: "CRE250PAKISTAN", description: null },
      { line: "Line 1", sku: "SAMPLE CW2S", description: null },
    ];
    expect(unknownQueueCodes(rows, catalogue, (s) => /SAMPLE/.test(s))).toEqual([{ line: "Line 1", code: "DYM750V", description: null }]);
  });
});

describe("the RAG plan as it stood at the shift's start (Q88)", () => {
  const start = Date.parse("2026-11-10T18:00:00Z");
  it("leaves out a plan written once the shift was running, as the night of 10/11 at 19:05", () => {
    expect(planAtStart({ plan_qty: 10000, created_at: "2026-11-10T19:05:00Z" }, [], start)).toBeNull();
  });

  it("takes the plan before the first change made during the shift", () => {
    const changes = [
      { changed_at: "2026-11-10T22:00:00Z", before_qty: 8000, kind: "line" },
      { changed_at: "2026-11-10T23:00:00Z", before_qty: 9000, kind: "line" },
      { changed_at: "2026-11-10T17:00:00Z", before_qty: 7000, kind: "line" },
    ];
    expect(planAtStart({ plan_qty: 10000, created_at: "2026-11-10T09:00:00Z" }, changes, start)).toBe(8000);
    expect(planAtStart({ plan_qty: 10000, created_at: "2026-11-10T09:00:00Z" }, [], start)).toBe(10000);
  });

  it("compares both on the same shifts and actual", () => {
    const f = (date: string, expected_total: number): StoredForecast => ({
      session_date: date, shift: "DAY", line: 4, shown: true, expected_total, frozen_at: `${date}T05:30:00Z`, engine_version: ENGINE_VERSION,
    });
    const actuals = new Map([["2026-11-08|DAY|4", 8000], ["2026-11-09|DAY|4", 10000]]);
    const plans = new Map([["2026-11-08|DAY|4", 7200]]);
    const l4 = versusPlan([f("2026-11-08", 8400), f("2026-11-09", 7500)], actuals, plans).find((v) => v.line === 4)!;
    expect(l4).toEqual({ line: 4, shifts: 1, smartMedian: 5, planMedian: 10 });
  });
});
