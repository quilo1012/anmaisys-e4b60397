import { describe, it, expect } from "vitest";
import {
  sessionInCharge,
  type ProductionSession,
} from "../../supabase/functions/_shared/safetyculture/leaderOnDuty";

/**
 * Who was actually running the line when the finding was raised.
 *
 * `leader_line_assignment` cannot answer this. It holds seven rows, all of them open
 * ended — "Rafael Tosta has Line 4 from 2026-08-17, no end date" — so every action on
 * Line 4, on any day, at any hour, comes out in Rafael's name. Measured against
 * `production_sessions` on 07/09/2026, that put the wrong leader on FOURTEEN of the
 * twenty-two imported actions that carry one.
 *
 * `production_sessions` does know: it is written when somebody opens the line, and it
 * records the line, the date, the shift and who opened it. Line 4 on 06/09 was Marcio;
 * on 04/09 it was Rafael; the nights of 01/09 and 02/09 were Filipi.
 *
 * THE NIGHT SHIFT IS WHY THIS IS NOT A DATE LOOKUP.
 *
 * Nights start around 17:00 and run past midnight, so an action raised at 02:23 on the
 * 3rd belongs to the session opened at 17:09 on the 2nd. Joining on
 * `session_date = date of the action` silently finds nothing for those, and "nothing"
 * is exactly when the old fixed assignment used to step in and name the day-shift
 * leader. Four of the fourteen wrong names came from that hour of the night.
 */

const SESSIONS: ProductionSession[] = [
  { line: "Line 4", started_at: "2026-09-01T05:10:42Z", leader_name: "Rafael Tosta" },
  { line: "Line 4", started_at: "2026-09-01T17:08:42Z", leader_name: "Filipi" },
  { line: "Line 4", started_at: "2026-09-02T17:09:16Z", leader_name: "Filipi" },
  { line: "Line 4", started_at: "2026-09-06T05:00:39Z", leader_name: "Marcio" },
  { line: "Line 6", started_at: "2026-09-01T17:09:12Z", leader_name: "Henrique" },
];

describe("sessionInCharge", () => {
  it("finds the shift that was open when the action was raised", () => {
    // The case the factory reported: Line 4, 06/09, and it was Marcio, not Rafael.
    const s = sessionInCharge("Line 4", "2026-09-06T07:19:47Z", SESSIONS);
    expect(s?.leader_name).toBe("Marcio");
  });

  it("reaches back across midnight for the night shift", () => {
    // 02:23 on the 3rd is the session opened at 17:09 on the 2nd. A lookup keyed on
    // the calendar date of the action finds nothing here.
    const s = sessionInCharge("Line 4", "2026-09-03T02:23:14Z", SESSIONS);
    expect(s?.leader_name).toBe("Filipi");
    expect(s?.started_at).toBe("2026-09-02T17:09:16Z");
  });

  it("picks the night, not the morning, for an evening action", () => {
    const s = sessionInCharge("Line 4", "2026-09-01T21:19:56Z", SESSIONS);
    expect(s?.leader_name).toBe("Filipi");
  });

  it("picks the morning for an action raised before the night opened", () => {
    const s = sessionInCharge("Line 4", "2026-09-01T09:00:00Z", SESSIONS);
    expect(s?.leader_name).toBe("Rafael Tosta");
  });

  it("never uses a session that opened after the action", () => {
    // 04:00 on the 1st is before anything opened. Naming Rafael here would be reading
    // the future back onto the record.
    expect(sessionInCharge("Line 4", "2026-09-01T04:00:00Z", SESSIONS)).toBeNull();
  });

  it("lets go of a shift that ended long before", () => {
    // 06/09 opened at 05:00. An action at 23:00 on 05/09 is thirty hours after the
    // previous Line 4 session and belongs to neither: no session was open.
    expect(sessionInCharge("Line 4", "2026-09-05T23:00:00Z", SESSIONS)).toBeNull();
  });

  it("stays on its own line", () => {
    const s = sessionInCharge("Line 6", "2026-09-01T21:13:59Z", SESSIONS);
    expect(s?.leader_name).toBe("Henrique");
    expect(sessionInCharge("Line 5", "2026-09-01T21:13:59Z", SESSIONS)).toBeNull();
  });

  it("matches the line name regardless of case and padding", () => {
    expect(sessionInCharge("  line 4 ", "2026-09-06T07:19:47Z", SESSIONS)?.leader_name)
      .toBe("Marcio");
  });

  it("returns the session even when nobody signed it", () => {
    // Deliberate. A session that opened with no leader recorded is a KNOWN gap, and
    // the caller must report it rather than fall back to the standing assignment —
    // falling back is how the wrong name got there in the first place.
    const unsigned: ProductionSession[] = [
      { line: "Line 4", started_at: "2026-09-06T05:00:39Z", leader_name: null },
    ];
    const s = sessionInCharge("Line 4", "2026-09-06T07:19:47Z", unsigned);
    expect(s).not.toBeNull();
    expect(s?.leader_name).toBeNull();
  });

  it("answers nothing when there are no sessions or no time to ask about", () => {
    expect(sessionInCharge("Line 4", "2026-09-06T07:19:47Z", [])).toBeNull();
    expect(sessionInCharge("Line 4", null, SESSIONS)).toBeNull();
    expect(sessionInCharge("Line 4", "not a date", SESSIONS)).toBeNull();
  });

  it("takes the later of two sessions opened in the same shift", () => {
    // Reopening a line writes a second row. The one in charge is the last one opened.
    const twice: ProductionSession[] = [
      { line: "Line 4", started_at: "2026-09-06T05:00:00Z", leader_name: "Marcio" },
      { line: "Line 4", started_at: "2026-09-06T06:00:00Z", leader_name: "Rafael Tosta" },
    ];
    expect(sessionInCharge("Line 4", "2026-09-06T07:19:47Z", twice)?.leader_name)
      .toBe("Rafael Tosta");
  });
});
