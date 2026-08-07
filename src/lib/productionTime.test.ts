import { describe, it, expect } from "vitest";
import { shiftTimeToIso, runMinutes } from "@/lib/productionTime";

/** What the London wall clock reads at that instant — what the operator typed. */
const wall = (iso: string | null) =>
  iso == null ? null : new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));

describe("shiftTimeToIso", () => {
  it("keeps a day-shift time on the session's own day", () => {
    expect(wall(shiftTimeToIso("07:10", "2026-08-06", "DAY"))).toBe("06/08/2026, 07:10");
    expect(wall(shiftTimeToIso("17:50", "2026-08-06", "DAY"))).toBe("06/08/2026, 17:50");
  });

  it("puts the evening of a night shift on the session's day", () => {
    expect(wall(shiftTimeToIso("17:20", "2026-08-06", "NIGHT"))).toBe("06/08/2026, 17:20");
    expect(wall(shiftTimeToIso("23:10", "2026-08-06", "NIGHT"))).toBe("06/08/2026, 23:10");
  });

  it("puts the small hours of a night shift on the morning after", () => {
    expect(wall(shiftTimeToIso("01:40", "2026-08-06", "NIGHT"))).toBe("07/08/2026, 01:40");
    expect(wall(shiftTimeToIso("05:45", "2026-08-06", "NIGHT"))).toBe("07/08/2026, 05:45");
  });

  it("fixes the record that started this — R26216 on Line 1", () => {
    // Stored as 07/08 17:20 → 06/08 23:10, a duration of minus eighteen hours, because
    // the start was saved after midnight and took that day's date.
    const start = shiftTimeToIso("17:20", "2026-08-06", "NIGHT");
    const finish = shiftTimeToIso("23:10", "2026-08-06", "NIGHT");
    expect(runMinutes(start, finish)).toBe(350);
  });

  it("does not depend on when the form was submitted", () => {
    // The whole bug: `new Date()` meant the answer changed with the clock.
    const a = shiftTimeToIso("20:50", "2026-08-06", "NIGHT");
    const b = shiftTimeToIso("20:50", "2026-08-06", "NIGHT");
    expect(a).toBe(b);
    expect(wall(a)).toBe("06/08/2026, 20:50");
  });

  it("holds the wall clock across the British Summer Time boundary", () => {
    // London is UTC+1 in August and UTC in December. A naive build shifts by an hour.
    expect(wall(shiftTimeToIso("09:00", "2026-12-15", "DAY"))).toBe("15/12/2026, 09:00");
    expect(wall(shiftTimeToIso("09:00", "2026-08-15", "DAY"))).toBe("15/08/2026, 09:00");
  });

  it("returns null rather than a guess for anything unparseable", () => {
    for (const bad of ["", "  ", "abc", "25:00", "12:60", null, undefined]) {
      expect(shiftTimeToIso(bad as any, "2026-08-06", "NIGHT")).toBeNull();
    }
    expect(shiftTimeToIso("09:00", "not-a-date", "DAY")).toBeNull();
  });
});

describe("runMinutes", () => {
  it("measures a run that crosses midnight", () => {
    const start = shiftTimeToIso("23:30", "2026-08-06", "NIGHT");
    const finish = shiftTimeToIso("00:30", "2026-08-06", "NIGHT");
    expect(runMinutes(start, finish)).toBe(60);
  });

  it("refuses a negative duration instead of passing it on", () => {
    // Twenty-three records hold one. A negative that survives gets averaged into a
    // line's speed, where it quietly cancels out real minutes.
    expect(runMinutes("2026-08-07T17:20:00Z", "2026-08-06T23:10:00Z")).toBeNull();
  });

  it("is null when either end is missing", () => {
    expect(runMinutes(null, "2026-08-06T23:10:00Z")).toBeNull();
    expect(runMinutes("2026-08-06T17:20:00Z", null)).toBeNull();
  });
});

describe("runMinutes refuses a pair that cannot describe a run", () => {
  it("refuses zero, which is not a short run", () => {
    // Nine records hold a start and a finish on the same minute — five on 27/07 alone,
    // at 09:59, 10:01, 10:02, 11:09 and 16:40. Saving stamped the finish with the clock
    // while the operator had typed the clock into the start.
    const t = "2026-08-06T09:59:00Z";
    expect(runMinutes(t, t)).toBeNull();
  });

  it("refuses a run longer than the shift it belongs to", () => {
    // An item belongs to a session and a session is one shift. K26217 claims 1050
    // minutes on Line 3; averaged in, it makes the line look half as fast as it is.
    const start = "2026-08-07T02:20:00Z";
    expect(runMinutes(start, "2026-08-07T19:50:00Z")).toBeNull();   // 1050 min
    expect(runMinutes(start, "2026-08-07T14:20:00Z")).toBe(720);    // exactly 12 h
    expect(runMinutes(start, "2026-08-07T14:21:00Z")).toBeNull();   // a minute over
  });

  it("still measures an ordinary run", () => {
    expect(runMinutes("2026-08-06T06:00:00Z", "2026-08-06T10:05:00Z")).toBe(245);
  });
});
