import { describe, expect, it } from "vitest";
import { actionShift, actionsInReportPeriod } from "@/lib/performanceActions";

/**
 * The Production Performance report printed "No quality actions in this period"
 * over a period full of them.
 *
 * The screen's shift filter opens on the shift running right now — never on "All" —
 * and the query turned that into `.eq("shift", "DAY")`. Measured on 13/09/2026:
 * every one of the 123 actions raised since 13/08 came from the SafetyCulture sync,
 * and the sync writes no `shift` at all. `shift = 'DAY'` matched none of them, so
 * the report's quality section had been empty for a month:
 *
 *   quality_actions, 14 days to 13/09    88 rows   0 with shift='DAY'   0 with 'NIGHT'
 *
 * A row that carries no shift is not a row that belongs to neither shift — it is a
 * row that only has a timestamp, and the hour is the right question for it, which is
 * what `getShift` is for and what work orders already do. A row that DOES carry one
 * keeps it: bulk-imported history lands with a synthetic midday timestamp and a real
 * NIGHT in the column, and reading the clock there would file a night under a day
 * nobody worked.
 */

const at = (iso: string, shift: string | null = null) => ({ recorded_at: iso, shift });

describe("the shift an action belongs to", () => {
  it("comes from the clock when the log did not record one", () => {
    // 12:02 London on 13/09 — a day-shift action, and the sync left `shift` null.
    expect(actionShift(at("2026-09-13T11:02:39.710Z"))).toBe("DAY");
    // 21:40 London, still nothing in the column.
    expect(actionShift(at("2026-09-13T20:40:00.000Z"))).toBe("NIGHT");
  });

  it("comes from the column whenever the column was filled in", () => {
    // The imported history: midday on the clock, NIGHT in the column. The column wins.
    expect(actionShift(at("2026-08-13T11:00:00.000Z", "NIGHT"))).toBe("NIGHT");
    expect(actionShift(at("2026-08-13T23:00:00.000Z", "DAY"))).toBe("DAY");
  });

  it("reads a blank string as no answer, not as an answer", () => {
    expect(actionShift(at("2026-09-13T11:02:39.710Z", "   "))).toBe("DAY");
  });
});

describe("the actions a report prints", () => {
  const period = { from: "2026-09-13", to: "2026-09-13" };

  it("keeps a shiftless action in the shift its hour worked", () => {
    const row = at("2026-09-13T11:02:39.710Z");
    expect(actionsInReportPeriod([row], { ...period, shift: "DAY" })).toEqual([row]);
    expect(actionsInReportPeriod([row], { ...period, shift: "NIGHT" })).toEqual([]);
    expect(actionsInReportPeriod([row], { ...period, shift: "all" })).toEqual([row]);
  });

  it("files the small hours under the night that was still running", () => {
    // 02:15 on the 14th is the 13th's night, and belongs to no part of the 14th.
    const row = at("2026-09-14T01:15:00.000Z");
    expect(actionsInReportPeriod([row], { ...period, shift: "NIGHT" })).toEqual([row]);
    expect(actionsInReportPeriod([row], { ...period, shift: "DAY" })).toEqual([]);
    expect(
      actionsInReportPeriod([row], { from: "2026-09-14", to: "2026-09-14", shift: "all" }),
    ).toEqual([]);
  });

  it("throws back the morning after that the fetch had to reach for", () => {
    // 07:30 on the 14th is the 14th's day shift, fetched only because the night
    // before could have run into it.
    const row = at("2026-09-14T06:30:00.000Z");
    expect(actionsInReportPeriod([row], { ...period, shift: "all" })).toEqual([]);
  });

  it("still lets a recorded shift outrank the clock", () => {
    const imported = at("2026-09-13T11:00:00.000Z", "NIGHT");
    expect(actionsInReportPeriod([imported], { ...period, shift: "NIGHT" })).toEqual([imported]);
    expect(actionsInReportPeriod([imported], { ...period, shift: "DAY" })).toEqual([]);
  });

  it("prints the whole period when no shift is chosen", () => {
    const rows = [at("2026-09-13T11:02:00.000Z"), at("2026-09-13T20:40:00.000Z")];
    expect(actionsInReportPeriod(rows, { ...period, shift: "all" })).toEqual(rows);
  });
});
