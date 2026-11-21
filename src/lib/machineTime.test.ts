import { describe, expect, it } from "vitest";
import {
  NO_REASON,
  classifyMachineState,
  formatHours,
  machineTimeByLine,
  machineTimeTotal,
  machineTimeWindows,
  periodDays,
  plannedLookup,
  type MachineLogRow,
} from "@/lib/machineTime";

const H = 3_600_000;
const planned = plannedLookup([
  { name: "Breaks", planned: true },
  { name: "Line Preparation", planned: true },
  { name: "No Planned Shift", planned: true },
  { name: "Printer Fault", planned: false },
  { name: "Waiting", planned: false },
]);
const row = (line: string, at: string, status: number, stop_label: string | null = null): MachineLogRow =>
  ({ line, status, stop_label, changed_at: at });

describe("machineTimeWindows — the clock a search covers", () => {
  it("all shifts is 06:00 to 06:00, joined into one stretch", () => {
    // November is GMT: London wall clock is UTC.
    const w = machineTimeWindows("2026-11-16", "2026-11-19", "__all__");
    expect(w).toEqual([{ startMs: Date.parse("2026-11-16T06:00:00Z"), endMs: Date.parse("2026-11-20T06:00:00Z") }]);
    expect((w[0].endMs - w[0].startMs) / H).toBe(96);
  });

  it("day and night are twelve hours each, one window per date", () => {
    const day = machineTimeWindows("2026-11-16", "2026-11-17", "DAY");
    expect(day.map((x) => [new Date(x.startMs).toISOString(), new Date(x.endMs).toISOString()])).toEqual([
      ["2026-11-16T06:00:00.000Z", "2026-11-16T18:00:00.000Z"],
      ["2026-11-17T06:00:00.000Z", "2026-11-17T18:00:00.000Z"],
    ]);
    const night = machineTimeWindows("2026-11-16", "2026-11-16", "NIGHT");
    expect(night).toEqual([{ startMs: Date.parse("2026-11-16T18:00:00Z"), endMs: Date.parse("2026-11-17T06:00:00Z") }]);
  });

  it("follows London across the clock change: the night of 24/10/2026 is 13 hours", () => {
    const [n] = machineTimeWindows("2026-10-24", "2026-10-24", "NIGHT");
    expect(new Date(n.startMs).toISOString()).toBe("2026-10-24T17:00:00.000Z"); // 18:00 BST
    expect(new Date(n.endMs).toISOString()).toBe("2026-10-25T06:00:00.000Z"); // 06:00 GMT
    expect((n.endMs - n.startMs) / H).toBe(13);
  });

  it("an upside-down or broken period covers nothing", () => {
    expect(machineTimeWindows("2026-11-19", "2026-11-16", "__all__")).toEqual([]);
    expect(machineTimeWindows("", "2026-11-16", "__all__")).toEqual([]);
    expect(periodDays("2026-11-16", "2026-11-20")).toBe(5);
    expect(periodDays("2026-11-20", "2026-11-16")).toBe(0);
  });
});

describe("classifyMachineState — what one reading says", () => {
  it("a code decides first, planned or not by iTouching's catalogue", () => {
    expect(classifyMachineState(7, "Breaks", planned)).toBe("planned");
    expect(classifyMachineState(7, "  line preparation ", planned)).toBe("planned");
    expect(classifyMachineState(7, "Printer Fault", planned)).toBe("unplanned");
  });

  it("status 1 arrives with stop codes, so a coded 1 is a stop, not a run", () => {
    expect(classifyMachineState(1, "No Planned Shift", planned)).toBe("planned");
    expect(classifyMachineState(1, "Waiting", planned)).toBe("unplanned");
  });

  it("a code the catalogue does not know is unplanned, as on the live board", () => {
    expect(classifyMachineState(7, "Alarm", planned)).toBe("unplanned");
  });

  it("without a code, 4, 6 and 8 run; anything else is a stop with no reason", () => {
    expect(classifyMachineState(4, null, planned)).toBe("run");
    expect(classifyMachineState(6, "", planned)).toBe("run");
    expect(classifyMachineState(8, null, planned)).toBe("run");
    expect(classifyMachineState(5, null, planned)).toBe("unplanned");
    expect(classifyMachineState(7, null, planned)).toBe("unplanned");
    expect(classifyMachineState(null, null, planned)).toBe("unplanned");
  });
});

describe("machineTimeByLine — where the hours went", () => {
  const day16 = machineTimeWindows("2026-11-16", "2026-11-16", "DAY"); // 06:00–18:00 UTC
  const later = Date.parse("2026-11-30T00:00:00Z");

  it("splits the shift into run, planned and unplanned, and the parts add up to the total", () => {
    const rows = [
      // The state the line was in when the shift opened comes from the night before.
      row("Line 6", "2026-11-15T22:00:00Z", 1, "No Planned Shift"),
      row("Line 6", "2026-11-16T06:30:00Z", 7, "Line Preparation"),
      row("Line 6", "2026-11-16T07:00:00Z", 4),
      row("Line 6", "2026-11-16T10:00:00Z", 7, "Breaks"),
      row("Line 6", "2026-11-16T10:30:00Z", 6),
      row("Line 6", "2026-11-16T13:00:00Z", 7, "Printer Fault"),
      row("Line 6", "2026-11-16T14:00:00Z", 5),
      row("Line 6", "2026-11-16T14:15:00Z", 8),
      // Past the end of the shift: does not count.
      row("Line 6", "2026-11-16T19:00:00Z", 7, "Breaks"),
    ];
    const [l6] = machineTimeByLine(rows, day16, planned, later);
    expect(l6.line).toBe("Line 6");
    expect(l6.totalMin).toBe(720);
    // 06:00–06:30 No Planned Shift, 06:30–07:00 Line Prep, 10:00–10:30 Breaks.
    expect(l6.plannedMin).toBe(90);
    expect(l6.availableMin).toBe(630);
    // 07:00–10:00, 10:30–13:00, 14:15–18:00.
    expect(l6.runMin).toBe(180 + 150 + 225);
    // Printer Fault 60 + an uncoded stop 15.
    expect(l6.unplannedMin).toBe(75);
    expect(l6.noDataMin).toBe(0);
    expect(l6.runMin + l6.plannedMin + l6.unplannedMin + l6.noDataMin).toBe(l6.totalMin);
    expect(l6.availabilityPct).toBeCloseTo((555 / 630) * 100, 6);
    expect(l6.stops.map((s) => [s.label, s.planned, s.minutes])).toEqual([
      ["Printer Fault", false, 60],
      ["No Planned Shift", true, 30],
      ["Line Preparation", true, 30],
      ["Breaks", true, 30],
      [NO_REASON, false, 15],
    ]);
  });

  it("a line the log only hears from mid-shift has its first minutes as no data, not as run or stop", () => {
    const rows = [row("Line 2", "2026-11-16T08:00:00Z", 4)];
    const [l2] = machineTimeByLine(rows, day16, planned, later);
    expect(l2.noDataMin).toBe(120);
    expect(l2.runMin).toBe(600);
    expect(l2.availableMin).toBe(720);
    expect(l2.availabilityPct).toBe(100);
  });

  it("an open shift counts up to now, and the last state holds until then", () => {
    const now = Date.parse("2026-11-16T09:00:00Z");
    const rows = [row("Line 1", "2026-11-16T05:00:00Z", 4), row("Line 1", "2026-11-16T08:00:00Z", 7, "Breaks")];
    const [l1] = machineTimeByLine(rows, day16, planned, now);
    expect(l1.totalMin).toBe(180);
    expect(l1.runMin).toBe(120);
    expect(l1.plannedMin).toBe(60);
  });

  it("keeps lines apart, leaves out a line with nothing in the period, and orders same-instant rows as given", () => {
    const rows = [
      row("Line 1", "2026-11-16T05:00:00Z", 4),
      row("Line 3", "2026-11-14T05:00:00Z", 4),
      row("Line 3", "2026-11-14T06:00:00Z", 7, "Breaks"),
      row("Line 3", "2026-11-16T18:30:00Z", 4),
      // Two rows on one instant: the second is the one that holds.
      row("Line 1", "2026-11-16T12:00:00Z", 7, "Printer Fault"),
      row("Line 1", "2026-11-16T12:00:00Z", 7, "Breaks"),
      row("Gone", "2026-11-17T09:00:00Z", 4),
    ];
    const lines = machineTimeByLine(rows, day16, planned, later);
    expect(lines.map((l) => l.line).sort()).toEqual(["Line 1", "Line 3"]);
    const l1 = lines.find((l) => l.line === "Line 1")!;
    expect(l1.runMin).toBe(360);
    expect(l1.plannedMin).toBe(360);
    expect(l1.unplannedMin).toBe(0);
    // Line 3 sat on Breaks from the 14th: the whole shift is planned, nothing available.
    const l3 = lines.find((l) => l.line === "Line 3")!;
    expect(l3.plannedMin).toBe(720);
    expect(l3.availableMin).toBe(0);
    expect(l3.availabilityPct).toBeNull();
  });

  it("a period that has not started yet covers nothing", () => {
    const rows = [row("Line 6", "2026-11-16T05:00:00Z", 4)];
    expect(machineTimeByLine(rows, day16, planned, Date.parse("2026-11-16T05:30:00Z"))).toEqual([]);
  });
});

describe("machineTimeTotal — the Total row", () => {
  it("adds hours across lines and works availability out of the sums, not as an average", () => {
    const rows = [
      row("Line 1", "2026-11-16T05:00:00Z", 4),
      row("Line 2", "2026-11-16T05:00:00Z", 4),
      row("Line 2", "2026-11-16T12:00:00Z", 7, "Printer Fault"),
    ];
    const t = machineTimeTotal(machineTimeByLine(rows, machineTimeWindows("2026-11-16", "2026-11-16", "DAY"), planned, Date.parse("2026-11-30T00:00:00Z")));
    expect(t.totalMin).toBe(1440);
    expect(t.runMin).toBe(720 + 360);
    expect(t.unplannedMin).toBe(360);
    expect(t.availabilityPct).toBe(75);
    expect(t.stops).toEqual([{ label: "Printer Fault", planned: false, minutes: 360 }]);
  });
});

describe("formatHours", () => {
  it("writes hours as the period report does", () => {
    expect(formatHours(96 * 60)).toBe("96:00");
    expect(formatHours(62 * 60 + 40.97)).toBe("62:41");
    expect(formatHours(5)).toBe("0:05");
    expect(formatHours(null)).toBe("—");
  });
});
