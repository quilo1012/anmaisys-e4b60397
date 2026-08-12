import { describe, it, expect } from "vitest";
import { partDay } from "@/lib/partDay";

/** Fri–Mon days: 06:00–18:00 with an hour's break, so eleven hours paid. */
const day = { startsAt: "06:00:00", endsAt: "18:00:00", breakMinutes: 60 };
/** Mon–Thu nights: 18:00–06:00, the same eleven. */
const night = { startsAt: "18:00:00", endsAt: "06:00:00", breakMinutes: 60 };

describe("partDay — a day that ended early", () => {
  it("costs Elias Soares nine hours on 07/08", () => {
    // He came in at six and went home at eight. Every screen recorded a full day.
    expect(partDay({ leftEarlyAt: "08:00:00" }, day)).toEqual({
      workedHours: 2, missedHours: 9, shiftHours: 11,
    });
  });

  it("does not charge somebody for a break they left before", () => {
    // Two hours present is two hours worked. Deducting the hour would bill him for a
    // lunch he was not there for.
    expect(partDay({ leftEarlyAt: "08:00" }, day)!.workedHours).toBe(2);
  });

  it("takes the break off somebody who stayed past the middle", () => {
    // In at six, home at five: eleven hours present, less the break, is ten.
    expect(partDay({ leftEarlyAt: "17:00" }, day)).toEqual({
      workedHours: 10, missedHours: 1, shiftHours: 11,
    });
  });

  it("is nothing missed when they worked the shift out", () => {
    expect(partDay({ leftEarlyAt: "18:00" }, day)).toEqual({
      workedHours: 11, missedHours: 0, shiftHours: 11,
    });
  });

  it("measures a night shift from the evening, not from midnight", () => {
    // Home at 02:00 on a night is eight hours in, not sixteen hours before it started.
    expect(partDay({ leftEarlyAt: "02:00" }, night)).toEqual({
      workedHours: 7, missedHours: 4, shiftHours: 11,
    });
    // Two hours in, same as the day case, and still no break deducted.
    expect(partDay({ leftEarlyAt: "20:00" }, night)).toEqual({
      workedHours: 2, missedHours: 9, shiftHours: 11,
    });
  });

  it("handles a rota with no break at all", () => {
    expect(partDay({ leftEarlyAt: "13:00" }, { startsAt: "09:00", endsAt: "17:00", breakMinutes: 0 })).toEqual({
      workedHours: 4, missedHours: 4, shiftHours: 8,
    });
  });

  it("returns null for a leaving time outside the shift", () => {
    // 04:00 on a day shift is not early leaving, it is a typo or a night's time on a
    // day's row. Better refused than counted as fourteen hours missed.
    expect(partDay({ leftEarlyAt: "04:00" }, day)).toBeNull();
  });
});

describe("partDay — a day that started late", () => {
  it("charges the hours between the shift's start and the person's", () => {
    // Due at six, in at nine: three hours the line ran a body short. He stayed to the
    // end, so he was there for the break and it comes off — eight hours worked.
    expect(partDay({ arrivedLateAt: "09:00" }, day)).toEqual({
      workedHours: 8, missedHours: 3, shiftHours: 11,
    });
  });

  it("does not deduct a break from somebody who arrived after it", () => {
    // In at four on a 06:00–18:00 shift: two hours present, and the break fell hours
    // before he got there.
    expect(partDay({ arrivedLateAt: "16:00" }, day)).toEqual({
      workedHours: 2, missedHours: 9, shiftHours: 11,
    });
  });

  it("counts a late start on a night shift from the evening", () => {
    // Due at six in the evening, in at eight: two hours late on an eleven-hour night.
    expect(partDay({ arrivedLateAt: "20:00" }, night)).toEqual({
      workedHours: 9, missedHours: 2, shiftHours: 11,
    });
  });

  it("is nothing missed when they were in on time", () => {
    expect(partDay({ arrivedLateAt: "06:00" }, day)).toEqual({
      workedHours: 11, missedHours: 0, shiftHours: 11,
    });
  });

  it("returns null for an arrival outside the shift", () => {
    // 04:00 is before a day shift starts. That is not lateness, it is a wrong time.
    expect(partDay({ arrivedLateAt: "04:00" }, day)).toBeNull();
  });
});

describe("partDay — both on the same day", () => {
  it("counts the window between the two, with one break", () => {
    // In at nine, home at two: five hours present, less the break he was there for,
    // is four worked and seven missed on an eleven-hour shift.
    expect(partDay({ arrivedLateAt: "09:00", leftEarlyAt: "14:00" }, day)).toEqual({
      workedHours: 4, missedHours: 7, shiftHours: 11,
    });
  });

  it("does not deduct a break the window never covered", () => {
    // In at half seven, home at nine: an hour and a half, all of it before the middle
    // of the shift. Taking an hour off would leave him half an hour for a morning he
    // worked.
    expect(partDay({ arrivedLateAt: "07:30", leftEarlyAt: "09:00" }, day)).toEqual({
      workedHours: 1.5, missedHours: 9.5, shiftHours: 11,
    });
  });

  it("refuses a day that ends before it starts", () => {
    // Home at eight, in at nine. One of the two times is wrong, and guessing which
    // would put a negative day into payroll.
    expect(partDay({ arrivedLateAt: "09:00", leftEarlyAt: "08:00" }, day)).toBeNull();
  });
});

describe("partDay — when it cannot say", () => {
  it("returns null with no rota to measure against", () => {
    // No rota means no shift length to measure a shortfall against. Reporting "0 hours
    // missed" for somebody who went home at eight is worse than reporting nothing.
    expect(partDay({ leftEarlyAt: "08:00" }, { startsAt: null, endsAt: null, breakMinutes: 60 })).toBeNull();
  });

  it("returns null when neither mark is set", () => {
    // A whole day worked is not a part day, and nothing here has anything to say
    // about it.
    expect(partDay({}, day)).toBeNull();
    expect(partDay({ arrivedLateAt: null, leftEarlyAt: null }, day)).toBeNull();
  });

  it("returns null for a time that is not a time", () => {
    expect(partDay({ leftEarlyAt: "" }, day)).toBeNull();
    expect(partDay({ leftEarlyAt: "25:00" }, day)).toBeNull();
    expect(partDay({ arrivedLateAt: "9am" }, day)).toBeNull();
  });
});
