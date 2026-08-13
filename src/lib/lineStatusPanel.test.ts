import { describe, it, expect } from "vitest";
import { buildLineStatusRows } from "./lineStatusPanel";
import type { LiveReading } from "./lineLiveStatus";

const now = new Date("2026-08-13T09:27:20.000Z");
const seenAt = new Date("2026-08-13T09:27:01.234Z");

const lines = [
  { id: "1", name: "Capsules Machine 1" },
  { id: "2", name: "Capsules Machine 2" },
  { id: "3", name: "GEL Line" },
  { id: "4", name: "Line 1" },
  { id: "5", name: "Line 2" },
  { id: "6", name: "Tablet Line" },
];

/**
 * The factory at 09:27:20 UTC on 13/08, read straight out of `v_line_live_status`,
 * beside what the iTouching screen showed at that minute. Six machines, four of
 * them standing still — and the Control Centre panel called all six "Running".
 */
const live = new Map<string, LiveReading>([
  ["capsules machine 1", { status: 1, reason: "No Planned Shift", planned: true, seenAt, stopSince: new Date("2026-08-13T01:28:01.866Z") }],
  ["capsules machine 2", { status: 7, reason: "Line Preparation", planned: true, seenAt, stopSince: new Date("2026-08-13T08:05:00.999Z") }],
  ["gel line", { status: 7, reason: "No Planned Shift", planned: true, seenAt, stopSince: new Date("2026-08-12T17:06:01.120Z") }],
  ["line 1", { status: 7, reason: "Filling Blender/ Blending", planned: true, seenAt, stopSince: new Date("2026-08-13T08:45:01.934Z") }],
  ["line 2", { status: 4, reason: null, planned: null, seenAt, stopSince: null }],
  ["tablet line", { status: 8, reason: null, planned: null, seenAt, stopSince: null }],
]);

const rowFor = (name: string, woStopped = new Map<string, number>()) =>
  buildLineStatusRows(lines, live, woStopped, now).find((r) => r.name === name)!;

describe("buildLineStatusRows", () => {
  it("names every stop with iTouching's own words, not 'Running'", () => {
    // The whole bug in one assertion: four of these six read "Running" on the
    // Control Centre while the iTouching screen two metres away named the stop.
    expect(rowFor("Capsules Machine 1").live.label).toBe("No Planned Shift");
    expect(rowFor("Capsules Machine 2").live.label).toBe("Line Preparation");
    expect(rowFor("GEL Line").live.label).toBe("No Planned Shift");
    expect(rowFor("Line 1").live.label).toBe("Filling Blender/ Blending");
  });

  it("leaves a running line running, on both of the numbers this factory sends", () => {
    expect(rowFor("Line 2").live.state).toBe("RUNNING");
    expect(rowFor("Tablet Line").live.state).toBe("RUNNING");
  });

  it("carries iTouching's colour for the stop, so the two screens paint it the same", () => {
    // "No Planned Shift" is #A9BC15 on the vendor's panel, and green is its green.
    expect(rowFor("GEL Line").hue).toBe("#A9BC15");
    expect(rowFor("Line 2").hue).toBe("#00C000");
  });

  it("times the stop the way iTouching does", () => {
    // 08:45:01 → 09:27:20 is 42:19, and the panel writes it H:MM:SS like the vendor.
    expect(rowFor("Line 1").stopFor).toBe("0:42:18");
    expect(rowFor("Line 2").stopFor).toBeNull();
  });

  it("says so when a line has no machine mapped, instead of calling it running", () => {
    const rows = buildLineStatusRows([{ id: "9", name: "Hygiene" }], live, new Map(), now);
    expect(rows[0].live.state).toBe("NOT_MAPPED");
  });

  it("keeps the work order's word as its own fact, beside iTouching's", () => {
    // The two answer different questions: iTouching says what the machine is doing,
    // an open order says an engineer was called and nobody has resumed the line.
    const row = rowFor("Line 2", new Map([["Line 2", 1]]));
    expect(row.live.state).toBe("RUNNING");
    expect(row.woStopped).toBe(1);
  });

  it("puts what is standing still above what is running", () => {
    const order = buildLineStatusRows(lines, live, new Map(), now).map((r) => r.name);
    expect(order.slice(-2)).toEqual(["Line 2", "Tablet Line"]);
    expect(order[0]).toBe("Capsules Machine 1");
  });
});
