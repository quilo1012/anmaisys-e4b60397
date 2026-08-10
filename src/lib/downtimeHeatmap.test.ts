import { describe, it, expect } from "vitest";
import { computeHeatmap, type HeatmapRecord } from "@/lib/downtimeHeatmap";

/**
 * The week of 03/08/2026, as it actually sits in downtime_events. Every case here
 * is a real row — the arithmetic was never wrong, but three of these rows made the
 * matrix answer a question nobody asked.
 */

// Monday 03/08 00:00 → Monday 10/08 00:00, Europe/London (BST, UTC+1).
const FROM = Date.parse("2026-08-02T23:00:00.000Z");
const TO = Date.parse("2026-08-09T23:00:00.000Z");

const AUTO_CLOSE_NOTE = " [auto-closed: end of shift]";

function rec(partial: Partial<HeatmapRecord>): HeatmapRecord {
  return { line: "Line 1", started_at: null, ended_at: null, ...partial };
}

describe("computeHeatmap", () => {
  it("leaves no downtime on a day whose only overlap is a boundary sliver", () => {
    // WO-809: Line 3 stopped Wed 18:13 and was auto-closed at Thu 06:00:00.049.
    // Those 49 milliseconds are the whole of its Thursday day shift.
    const hm = computeHeatmap(
      [rec({ line: "Line 3", started_at: "2026-08-05T17:13:03.807Z", ended_at: "2026-08-06T05:00:00.049Z" })],
      FROM,
      TO,
      "all",
      "Day",
    );
    expect(hm.matrix.get("Line 3")?.get("3-Day")?.minutes ?? 0).toBe(0);
    expect(hm.grandTotalMinutes).toBe(0);
  });

  it("keeps the column totals consistent with the grand total", () => {
    const hm = computeHeatmap(
      [
        rec({ line: "Line 3", started_at: "2026-08-05T17:13:03.807Z", ended_at: "2026-08-06T05:00:00.049Z" }),
        rec({ line: "Line 3", started_at: "2026-08-07T12:28:00.000Z", ended_at: "2026-08-07T13:05:40.340Z" }),
      ],
      FROM,
      TO,
      "all",
      "Day",
    );
    const columns = Array.from(hm.dayShiftTotals.values()).reduce((a, c) => a + c.minutes, 0);
    expect(columns).toBe(hm.grandTotalMinutes);
    expect(hm.lineTotals.get("Line 3")?.minutes).toBe(38);
  });

  it("attributes a stop the shift-close job ended to system-closed minutes", () => {
    // WO-807: Line 4, Wed 09:24:36 → 18:00:00.072, note left by the closing job.
    const hm = computeHeatmap(
      [
        rec({
          line: "Line 4",
          started_at: "2026-08-05T08:24:36.085Z",
          ended_at: "2026-08-05T17:00:00.072Z",
          notes: AUTO_CLOSE_NOTE,
        }),
      ],
      FROM,
      TO,
      "all",
      "Day",
    );
    const wed = hm.matrix.get("Line 4")!.get("2-Day")!;
    expect(wed.minutes).toBe(515);
    expect(wed.systemMinutes).toBe(515);
    expect(hm.lineTotals.get("Line 4")?.systemMinutes).toBe(515);
  });

  it("counts a stop a person resumed as measured, not system-closed", () => {
    const hm = computeHeatmap(
      [
        rec({
          line: "Line 1",
          started_at: "2026-08-08T08:00:46.320Z",
          ended_at: "2026-08-08T08:37:02.330Z",
          resumed_by: "3f1c-user",
          resumed_by_name: "Engineer",
        }),
      ],
      FROM,
      TO,
      "all",
      "Day",
    );
    const sat = hm.matrix.get("Line 1")!.get("5-Day")!;
    expect(sat.minutes).toBe(36);
    expect(sat.systemMinutes).toBe(0);
  });

  it("refuses a PM recommendation built on auto-closed hours", () => {
    const hm = computeHeatmap(
      [
        rec({
          line: "Line 4",
          started_at: "2026-08-05T08:24:36.085Z",
          ended_at: "2026-08-05T17:00:00.072Z",
          notes: AUTO_CLOSE_NOTE,
        }),
        rec({ line: "Line 4", started_at: "2026-08-03T11:42:01.879Z", ended_at: "2026-08-03T12:31:55.215Z" }),
      ],
      FROM,
      TO,
      "all",
      "Day",
    );
    expect(hm.insights).toHaveLength(1);
    expect(hm.insights[0].verified).toBe(false);
    expect(hm.insights[0].line).toBe("Line 4");
    expect(hm.insights[0].text).not.toContain("Consider scheduling PM");
  });

  it("still recommends PM for a line whose worst cell was measured", () => {
    // Line 5 on Monday: three stops, all resumed by iTouching-independent means.
    const hm = computeHeatmap(
      [
        rec({
          line: "Line 5",
          started_at: "2026-08-03T05:48:02.383Z",
          ended_at: "2026-08-03T05:53:48.126Z",
          resumed_by: "3f1c-user",
        }),
        rec({
          line: "Line 5",
          started_at: "2026-08-03T06:48:01.422Z",
          ended_at: "2026-08-03T07:15:01.540Z",
          resumed_by: "3f1c-user",
        }),
        rec({
          line: "Line 5",
          started_at: "2026-08-03T11:42:01.879Z",
          ended_at: "2026-08-03T14:41:01.682Z",
          resumed_by: "3f1c-user",
        }),
      ],
      FROM,
      TO,
      "all",
      "Day",
    );
    expect(hm.insights[0].verified).toBe(true);
    expect(hm.insights[0].text).toContain("Consider scheduling PM on Sunday night");
  });
});
