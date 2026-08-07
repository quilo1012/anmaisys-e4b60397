import { describe, it, expect } from "vitest";
import { earlyLeave } from "@/lib/earlyLeave";

/** Fri–Mon days: 06:00–18:00 with an hour's break, so eleven hours paid. */
const day = { startsAt: "06:00:00", endsAt: "18:00:00", breakMinutes: 60 };
/** Mon–Thu nights: 18:00–06:00, the same eleven. */
const night = { startsAt: "18:00:00", endsAt: "06:00:00", breakMinutes: 60 };

describe("earlyLeave", () => {
  it("costs Elias Soares nine hours on 07/08", () => {
    // He came in at six and went home at eight. Every screen recorded a full day.
    expect(earlyLeave("08:00:00", day)).toEqual({
      workedHours: 2, missedHours: 9, shiftHours: 11,
    });
  });

  it("does not charge somebody for a break they left before", () => {
    // Two hours present is two hours worked. Deducting the hour would bill him for a
    // lunch he was not there for.
    expect(earlyLeave("08:00", day)!.workedHours).toBe(2);
  });

  it("takes the break off somebody who stayed past the middle", () => {
    // In at six, home at five: eleven hours present, less the break, is ten.
    expect(earlyLeave("17:00", day)).toEqual({
      workedHours: 10, missedHours: 1, shiftHours: 11,
    });
  });

  it("is nothing missed when they worked the shift out", () => {
    expect(earlyLeave("18:00", day)).toEqual({
      workedHours: 11, missedHours: 0, shiftHours: 11,
    });
  });

  it("measures a night shift from the evening, not from midnight", () => {
    // Home at 02:00 on a night is eight hours in, not sixteen hours before it started.
    expect(earlyLeave("02:00", night)).toEqual({
      workedHours: 7, missedHours: 4, shiftHours: 11,
    });
    // Two hours in, same as the day case, and still no break deducted.
    expect(earlyLeave("20:00", night)).toEqual({
      workedHours: 2, missedHours: 9, shiftHours: 11,
    });
  });

  it("handles a rota with no break at all", () => {
    expect(earlyLeave("13:00", { startsAt: "09:00", endsAt: "17:00", breakMinutes: 0 })).toEqual({
      workedHours: 4, missedHours: 4, shiftHours: 8,
    });
  });

  it("returns null rather than a figure when the rota cannot say", () => {
    // No rota means no shift length to measure a shortfall against. Reporting "0 hours
    // missed" for somebody who went home at eight is worse than reporting nothing.
    expect(earlyLeave("08:00", { startsAt: null, endsAt: null, breakMinutes: 60 })).toBeNull();
    expect(earlyLeave(null, day)).toBeNull();
    expect(earlyLeave("", day)).toBeNull();
    expect(earlyLeave("25:00", day)).toBeNull();
  });

  it("returns null for a leaving time outside the shift", () => {
    // 04:00 on a day shift is not early leaving, it is a typo or a night's time on a
    // day's row. Better refused than counted as fourteen hours missed.
    expect(earlyLeave("04:00", day)).toBeNull();
  });
});
