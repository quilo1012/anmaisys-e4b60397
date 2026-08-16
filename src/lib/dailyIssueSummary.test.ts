import { describe, it, expect } from "vitest";
import { summaryToText } from "@/hooks/useDailyIssueSummary";
import { formatDurationCompact as formatDuration } from "@/lib/formatDuration";

describe("formatDuration", () => {
  it("reads minutes under the hour and hours above it", () => {
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(45 * 60)).toBe("45m");
    expect(formatDuration(60 * 60)).toBe("1h 00m");
    expect(formatDuration(80 * 60)).toBe("1h 20m");
  });

  it("says nothing rather than zero when the clock never ran", () => {
    // A null is "we did not measure this"; 0 is "it was instant". Printing both as
    // 0m would let an unmeasured repair pass for a fast one.
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(undefined)).toBe("—");
    expect(formatDuration(-1)).toBe("—");
  });
});

describe("summaryToText", () => {
  const issue = (problem: string, down: number | null, repair: number | null, wo: number | null) =>
    ({ problem, downtimeSec: down, repairSec: repair, woNumber: wo });

  it("lays out both shifts with problem, downtime, repair and order", () => {
    const text = summaryToText({
      day: [issue("Capper Fault", 80 * 60, 25 * 60, 662)],
      night: [issue("Sensor Issue", 30 * 60, 10 * 60, 704)],
    });
    expect(text).toContain("Day:");
    expect(text).toContain("• Capper Fault — down 1h 20m, repair 25m (WO-662)");
    expect(text).toContain("Night:");
    expect(text).toContain("• Sensor Issue — down 30m, repair 10m (WO-704)");
  });

  it("says a quiet shift was quiet instead of leaving a gap", () => {
    const text = summaryToText({ day: [issue("Drill Fault", 600, 300, 700)], night: [] });
    expect(text).toContain("Night: no issues");
  });

  it("omits the order number when there is none", () => {
    const text = summaryToText({ day: [issue("Label Issue", 600, null, null)], night: [] });
    expect(text).toContain("• Label Issue — down 10m, repair —");
    expect(text).not.toContain("WO-");
  });

  it("keeps a problem nobody typed visible rather than blank", () => {
    const text = summaryToText({ day: [issue("Not recorded", null, null, 999)], night: [] });
    expect(text).toContain("• Not recorded — down —, repair — (WO-999)");
  });
});
