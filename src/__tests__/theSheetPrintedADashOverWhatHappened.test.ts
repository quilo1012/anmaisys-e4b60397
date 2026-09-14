import { describe, expect, it } from "vitest";
import { generatePerformanceReportPDF, type PerfReportOpenAction } from "@/lib/performanceReport";
import { actionShift, shiftWasRecorded } from "@/lib/performanceActions";

/**
 * What the Production Performance sheet says about a quality action.
 *
 * Two defects, both silent, both on the same block of the same page:
 *
 *   1. The section printed "No quality actions in this period" over a month of them,
 *      because the query asked the database for a shift that the SafetyCulture sync
 *      never writes. Covered by anActionWithNoShiftColumnStillWorkedAShift.
 *   2. What it printed instead of the fault was a dash. The sheet read `description`
 *      alone; the sync writes the fault into `title` and leaves `description` for the
 *      product and batch. On 13/09/2026 that was 104 of 188 rows blank.
 *
 * Asserted against the bytes of the PDF rather than a mocked table, because the way
 * both defects reached a printed page was that every layer in front of them looked
 * fine. jsPDF writes its text uncompressed, so the sheet can simply be read back.
 */

const sheetText = async (openActions: PerfReportOpenAction[]) => {
  const dataUri = (await generatePerformanceReportPDF(
    {
      periodLabel: "Day · 10/09/2026 – 10/09/2026",
      filtersLabel: "Shift: Day · Line: All · Leader: All",
      lines: [{ line: "Line 1", leader: "Kaz", target: 100, actual: 90, eff: 90 }],
      totalTarget: 100,
      totalActual: 90,
      openActions,
      generatedBy: "Test",
    },
    { output: "dataurl" },
  )) as string;
  return Buffer.from(dataUri.split(",")[1], "base64").toString("latin1");
};

/** As the sync leaves them: a title, no description, and no shift at all. */
const synced = (over: Partial<PerfReportOpenAction> = {}): PerfReportOpenAction => {
  const row = {
    recorded_at: "2026-09-10T06:41:35.416Z",
    action_no: "AC-6547",
    line: "Line 1",
    shift: null,
    severity: "medium",
    status: "complete",
    description: null,
    title: "Drill Cover Weld Joint Failure",
    error_type: null,
    labels: ["Maintenance"],
    ...over,
  };
  return { ...row, shift: actionShift(row), shiftDerived: !shiftWasRecorded(row) };
};

describe("the printed quality actions", () => {
  it("lists an action the log gave no shift", async () => {
    const sheet = await sheetText([synced()]);
    expect(sheet).not.toContain("No quality actions in this period");
    expect(sheet).toContain("AC-6547");
    expect(sheet).toContain("Drill Cover Weld Joint Failure");
  });

  it("says what happened, from wherever the row says it", async () => {
    const sheet = await sheetText([
      synced(),
      synced({ title: null, description: "Metal found in the magnetic separator" }),
      synced({ title: null, description: null, error_type: "Contamination risk" }),
      synced({ title: null, description: null, error_type: null, labels: ["CCP", "Foreign Body"] }),
    ]);
    expect(sheet).toContain("Drill Cover Weld Joint Failure");
    expect(sheet).toContain("Metal found in the magnetic separator");
    expect(sheet).toContain("Contamination risk");
    expect(sheet).toContain("CCP");
  });

  it("prefers the title to the description, which is the batch and not the fault", async () => {
    const sheet = await sheetText([
      synced({ description: "Muscle Moose Whey Protein Vanilla 900g / MM26252" }),
    ]);
    expect(sheet).toContain("Drill Cover Weld Joint Failure");
    expect(sheet).not.toContain("MM26252");
  });

  it("counts what the period held, so the total is not the only figure", async () => {
    const sheet = await sheetText([
      synced({ severity: "high", status: "todo" }),
      synced({ severity: "low", status: "complete" }),
      synced({ severity: null, status: "in_progress" }),
    ]);
    expect(sheet).toContain("Quality Actions");
    expect(sheet).toContain("1 high");
    expect(sheet).toContain("1 not graded");
    expect(sheet).toContain("2 still open");
  });

  it("says an ungraded action is ungraded rather than drawing a dash", async () => {
    const sheet = await sheetText([synced({ severity: null })]);
    expect(sheet).toContain("Not graded");
  });

  it("still says so plainly when the period really held none", async () => {
    expect(await sheetText([])).toContain("No quality actions in this period");
  });
});
