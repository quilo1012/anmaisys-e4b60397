/* eslint-disable @typescript-eslint/no-explicit-any -- the jspdf module mock wraps an untyped default export */
import { describe, it, expect, vi } from "vitest";
import { generatePerformanceReportPDF, type PerfReportInput } from "@/lib/performanceReport";

/**
 * A line with output and no plan.
 *
 * `aggregateLines` keeps it (actual > 0) with target 0 and eff 0, and the screen's
 * totals leave it out (`target > 0`). The PDF drew it as "0%" in red — a missing plan
 * printed as the worst possible efficiency — and its daily table added its output to
 * the TOTAL against a plan that never included it, so the bottom line read higher
 * than the line table above it.
 *
 * Asserted against the bytes jsPDF would have saved.
 */
const pdfs: string[] = [];
vi.mock("jspdf", async () => {
  const actual: any = await vi.importActual("jspdf");
  const Real = actual.default ?? actual.jsPDF;
  const Wrapped: any = function (...args: unknown[]) {
    const doc = new Real(...args);
    doc.save = () => { pdfs.push(Buffer.from(doc.output("arraybuffer")).toString("latin1")); return doc; };
    return doc;
  };
  return { ...actual, default: Wrapped, jsPDF: Wrapped };
});

const base = (over: Partial<PerfReportInput> = {}): PerfReportInput => ({
  periodLabel: "Day · 29/10/2026 – 29/10/2026",
  filtersLabel: "Shift: Day · Line: All · Leader: All",
  lines: [
    { line: "Line 1", leader: "A", target: 1000, actual: 900, eff: 90 },
    { line: "Line 9", leader: "B", target: 0, actual: 500, eff: 0 },
  ],
  // What the page passes: the planned lines only.
  totalTarget: 1000,
  totalActual: 900,
  dailyRows: [
    { date: "2026-10-29", line: "Line 1", shift: "DAY", target: 1000, actual: 900, eff: 90 },
    { date: "2026-10-29", line: "Line 9", shift: "DAY", target: 0, actual: 500, eff: 0 },
  ],
  openActions: [],
  generatedBy: "Test",
  ...over,
});

const render = async (input: PerfReportInput) => {
  pdfs.length = 0;
  await generatePerformanceReportPDF(input, { output: "save" });
  return pdfs[pdfs.length - 1];
};

describe("generatePerformanceReportPDF — a line with no plan", () => {
  it("prints 'No plan' instead of a 0% efficiency", async () => {
    const pdf = await render(base());
    expect(pdf).toContain("(No plan)");
  });

  it("counts only planned lines as scored", async () => {
    const pdf = await render(base());
    expect(pdf).toContain("(1 line scored");
    expect(pdf).toContain("1 line with output and no plan");
  });

  it("keeps unplanned output out of the daily TOTAL, so it agrees with the line table", async () => {
    const pdf = await render(base());
    // 900 / 1000. With the unplanned 500 added it read 1,400 and 140%.
    expect(pdf).not.toContain("(140%)");
    expect(pdf).not.toMatch(/\(1[,.]?400\)/);
  });

  it("prints No plan, not 0%, for the overall figure when nothing was planned", async () => {
    const pdf = await render(base({
      lines: [{ line: "Line 9", leader: "B", target: 0, actual: 500, eff: 0 }],
      totalTarget: 0, totalActual: 0,
      dailyRows: [],
    }));
    expect(pdf).not.toContain("(0%)");
    expect(pdf).toContain("(No plan)");
  });
});
