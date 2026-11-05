import { describe, it, expect } from "vitest";
import { buildShiftInputs, lineGaps, setupMinutes, MISSING_INPUTS, type SmartTargetItem, type SmartTargetSession } from "./smartTargetInput";
import { buildSkuCatalogue } from "./lineSku";
import { forecastShift } from "./smartTargetEngine";

const catalogue = buildSkuCatalogue([
  { id: "sku-a", code: "ABEENG", name: "A.B.E ENERGY", target_per_hour: 720 },
  { id: "sku-b", code: "COL165SR", name: "COLLAGEN STRAWBERRY", target_per_hour: 0 },
]);

const session = (id: string, line: string, over: Partial<SmartTargetSession> = {}): SmartTargetSession => ({
  id, line, session_date: "2026-11-03", shift: "DAY", ...over,
});
const item = (id: string, session_id: string, display_order: number, over: Partial<SmartTargetItem> = {}): SmartTargetItem => ({
  id, session_id, display_order, sku_id: null, sku_code_text: null, planned_qty: 100, ...over,
});

describe("buildShiftInputs", () => {
  it("gives one input per Line 1–6, with that line's jobs in display order", () => {
    const { lines } = buildShiftInputs("2026-11-03", "DAY", [session("s1", "Line 1")], [
      item("i2", "s1", 2, { sku_code_text: "COL165SR" }),
      item("i1", "s1", 1, { sku_id: "sku-a" }),
    ], catalogue);
    expect(lines.map((l) => l.line)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(lines[0].input.jobs.map((j) => [j.jobId, j.sku, j.sequence])).toEqual([["i1", "ABEENG", 1], ["i2", "COL165SR", 2]]);
    expect(lines[1].input.jobs).toEqual([]);
  });

  it("keeps only the chosen date and shift, and reads the shift case-blind", () => {
    const { lines } = buildShiftInputs("2026-11-03", "NIGHT", [
      session("d", "Line 2"),
      session("n", "Line 2", { shift: "night" }),
      session("x", "Line 2", { shift: "NIGHT", session_date: "2026-11-02" }),
    ], [item("i-d", "d", 1), item("i-n", "n", 1), item("i-x", "x", 1)], catalogue);
    expect(lines[1].sessionIds).toEqual(["n"]);
    expect(lines[1].input.jobs.map((j) => j.jobId)).toEqual(["i-n"]);
  });

  it("names lines outside 1–6 instead of dropping them silently", () => {
    const { otherLines } = buildShiftInputs("2026-11-03", "DAY", [session("t", "Tablet Line"), session("g", "GEL Line")], [], catalogue);
    expect(otherLines).toEqual(["GEL Line", "Tablet Line"]);
  });

  it("notes two sessions for the same line and reads both", () => {
    const { lines } = buildShiftInputs("2026-11-03", "DAY", [session("a", "Line 3"), session("b", "line 3")], [item("ia", "a", 1), item("ib", "b", 1)], catalogue);
    expect(lines[2].notes[0]).toMatch(/2 production sessions/);
    expect(lines[2].input.jobs).toHaveLength(2);
  });

  it("runs two sessions' jobs one session after the other, never interleaved", () => {
    const { lines } = buildShiftInputs("2026-11-03", "DAY", [
      session("late", "Line 3", { started_at: "2026-11-03T12:00:00Z" }),
      session("early", "Line 3", { started_at: "2026-11-03T06:05:00Z" }),
    ], [item("C", "late", 1), item("D", "late", 2), item("A", "early", 1), item("B", "early", 2)], catalogue);
    expect(lines[2].input.jobs.map((j) => j.jobId)).toEqual(["A", "B", "C", "D"]);
  });

  it("treats a zero or missing planned quantity as unknown, not zero", () => {
    const { lines } = buildShiftInputs("2026-11-03", "DAY", [session("s", "Line 4")], [
      item("z", "s", 1, { planned_qty: 0 }),
      item("n", "s", 2, { planned_qty: null }),
    ], catalogue);
    expect(lines[3].input.jobs.map((j) => j.orderQty)).toEqual([null, null]);
  });

  it("passes no rates, events, windows or break times, even when the catalogue has a rate", () => {
    // ABEENG carries 720/h in sku_products. It is a line-class default, not a measured
    // rate, and must not reach the engine.
    const { lines } = buildShiftInputs("2026-11-03", "DAY", [session("s", "Line 1")], [item("i", "s", 1, { sku_id: "sku-a" })], catalogue);
    const input = lines[0].input;
    expect(input.rates).toEqual([]);
    expect(input.events).toEqual([]);
    expect(input.eventSemantics).toBeNull();
    expect(input.breaks).toBeNull();
    expect(input.previousSku).toBeUndefined();
    expect(input.jobs[0]).not.toHaveProperty("plannedStart");

    const r = forecastShift(input);
    expect(r.status).toBe("insufficient_data");
    expect(r.expectedTotal).toBeNull();
    expect(r.jobs[0].rateStatus).toBe("missing");
  });

  it("lists every input it leaves empty, with who can supply it", () => {
    expect(MISSING_INPUTS.map((m) => m.key)).toEqual(["rates", "events", "breaks", "previous_sku", "downtime"]);
    for (const m of MISSING_INPUTS) expect(m.owner.length).toBeGreaterThan(0);
  });
});

describe("lineGaps and setupMinutes", () => {
  const run = (items: SmartTargetItem[], previousSku?: string | null) => {
    const { lines } = buildShiftInputs("2026-11-03", "DAY", [session("s", "Line 1")], items, catalogue);
    return forecastShift({ ...lines[0].input, previousSku });
  };

  it("names each missing-rate SKU once, however many jobs it has", () => {
    const r = run([item("a", "s", 1, { sku_id: "sku-a" }), item("b", "s", 2, { sku_id: "sku-a" }), item("c", "s", 3, { sku_id: "sku-b" })]);
    expect(lineGaps(r)).toEqual([
      "No rate for ABEENG, COL165SR.",
      "Job times cannot be worked out without a rate.",
    ]);
  });

  it("counts jobs with no SKU", () => {
    const r = run([item("a", "s", 1)]);
    expect(lineGaps(r)).toContain("1 job has no SKU.");
  });

  it("adds up changeover and mixing across the sequence", () => {
    // Previous SKU ABEENG: job 1 same SKU (0), job 2 same (0), job 3 change (25 + 30).
    const r = run([item("a", "s", 1, { sku_id: "sku-a" }), item("b", "s", 2, { sku_id: "sku-a" }), item("c", "s", 3, { sku_id: "sku-b" })], "ABEENG");
    expect(setupMinutes(r)).toBe(55);
  });
});
