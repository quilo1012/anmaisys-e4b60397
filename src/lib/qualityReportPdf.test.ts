/* eslint-disable @typescript-eslint/no-explicit-any -- the jspdf module mock wraps an untyped default export */
import { describe, it, expect, vi } from "vitest";
import { generateQualityReportPDF, type QualityReportAction } from "@/lib/qualityReport";

/**
 * The footer used to be stamped from the action log table's `didDrawPage`, where
 * `pageNumber` counts that table's own pages. On the 19/08/2026 report that meant
 * page 1 — the summary and the leader table — carried no footer at all, and a
 * five-page document ended on a page numbered 4. Neither is acceptable on paper that
 * gets signed and filed for an audit, where "is this the last page?" has to be
 * answerable from the page itself.
 *
 * Asserted against the bytes the browser would have saved, not against a helper.
 */
// `save` is an own property of each jsPDF instance, not a prototype method, so the
// module is wrapped instead: the real jsPDF still draws the document, and only the
// final write to disk is swapped for a capture of the very bytes it would have saved.
const mockPdfs: string[] = [];
vi.mock("jspdf", async () => {
  const actual: any = await vi.importActual("jspdf");
  const Real = actual.default ?? actual.jsPDF;
  const Wrapped: any = function (...args: unknown[]) {
    const doc = new Real(...args);
    doc.save = () => { mockPdfs.push(Buffer.from(doc.output("arraybuffer")).toString("latin1")); return doc; };
    return doc;
  };
  return { ...actual, default: Wrapped, jsPDF: Wrapped };
});

// Twenty-one leaders, as on the 19/08/2026 report: the per-leader table then fills
// page 1 on its own and the action log starts on page 2 — which is exactly the shape
// that left page 1 unfooted. A fixture with one leader hides the bug.
const LEADERS = ["Marcio", "Rafael Tosta", "Ailton", "Cainan", "Everton", "Unassigned", "Marcelo",
  "Lucas", "Henrique", "Vagner", "Gill", "Juliano", "Nilton", "Pedro", "Izildo", "Guilherme",
  "Kleyve", "Kaz", "Murilo", "Filipi", "Sandro"];

const action = (i: number, over: Partial<QualityReportAction> = {}): QualityReportAction => ({
  recorded_at: `2026-08-${String((i % 28) + 1).padStart(2, "0")}`,
  action_no: null, severity: null, line: `Line ${(i % 6) + 1}`, shift: i % 2 ? "DAY" : "NIGHT",
  leader_name: LEADERS[i % LEADERS.length], department: "Production", sku: "NEUBFBP500BR", batch: "D26223",
  labels: [], description: "Batch Code Printing Issue (L5)", validation_status: "open",
  closed_at: null, domain: "quality", ...over,
});

const render = async (actions: QualityReportAction[]) => {
  mockPdfs.length = 0;
  await generateQualityReportPDF({ actions, periodLabel: "Period: 22/05/2026 — 19/08/2026", generatedBy: "Daniel Quiló" });
  return mockPdfs[mockPdfs.length - 1];
};

describe("generateQualityReportPDF — the footer of a filed document", () => {
  it("numbers every page of the document, page 1 included, and says how many there are", async () => {
    const pdf = await render(Array.from({ length: 69 }, (_, i) => action(i)));
    const stamps = [...pdf.matchAll(/\(Page (\d+) of (\d+)\)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    const total = pdf.match(/\/Type \/Page[^s]/g)?.length ?? 0;
    expect(total).toBeGreaterThan(1);
    // One stamp per page, in order, all agreeing on the total.
    expect(stamps).toEqual(Array.from({ length: total }, (_, i) => [i + 1, total]));
  });

  it("puts the generated-by line on every page, not only on the ones the log reached", async () => {
    const pdf = await render(Array.from({ length: 69 }, (_, i) => action(i)));
    const total = pdf.match(/\/Type \/Page[^s]/g)?.length ?? 0;
    expect(pdf.match(/\(Generated .*? by Daniel Quil/g)?.length).toBe(total);
  });

  it("prints no board state anywhere in the document", async () => {
    const pdf = await render([action(0, { action_no: "AC-6179", severity: "high" })]);
    for (const dead of ["(To do)", "(In progress)", "(Status)"]) expect(pdf).not.toContain(dead);
  });

  it("omits Action # and Severity when the period fills neither", async () => {
    const pdf = await render(Array.from({ length: 5 }, (_, i) => action(i)));
    expect(pdf).not.toContain("(Action #)");
    expect(pdf).not.toContain("(Severity)");
    expect(pdf).toContain("(Action log)");
  });

  it("prints them again as soon as one action carries them", async () => {
    const pdf = await render([action(0), action(1, { action_no: "AC-6179", severity: "high" })]);
    expect(pdf).toContain("(Action #)");
    expect(pdf).toContain("(Severity)");
  });
});
