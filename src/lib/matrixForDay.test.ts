import { describe, it, expect } from "vitest";
import { matrixForDate, matrixKindsFor } from "@/lib/matrixForDay";

/** A week of real dates, so the weekdays are checked and not asserted. */
const MON = "2026-08-31";
const TUE = "2026-09-01";
const WED = "2026-09-02";
const THU = "2026-09-03";
const FRI = "2026-09-04";
const SAT = "2026-09-05";
const SUN = "2026-09-06";

describe("matrixForDate", () => {
  it("gives Monday its own standard", () => {
    expect(matrixForDate("Day", MON)).toBe("monday");
  });

  it("gives the middle of the week the full-shift standard", () => {
    // Tuesday to Thursday are the only days both weekday crews are in together.
    expect([TUE, WED, THU].map((d) => matrixForDate("Day", d))).toEqual(["full", "full", "full"]);
  });

  it("gives Friday its own standard, not the middle of the week's", () => {
    // Friday is Tue–Fri finishing as Fri–Mon starts. It is not a Wednesday.
    expect(matrixForDate("Day", FRI)).toBe("friday");
  });

  it("gives both weekend days the weekend standard", () => {
    expect([SAT, SUN].map((d) => matrixForDate("Day", d))).toEqual(["weekend", "weekend"]);
  });

  it("reads the weekday at midday, so a timezone west of UTC cannot shift it", () => {
    // `new Date("2026-08-31")` is UTC midnight, which is Sunday in New York — and a
    // Monday board would then be offered the weekend matrix.
    const tz = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      expect(matrixForDate("Day", MON)).toBe("monday");
    } finally {
      process.env.TZ = tz;
    }
  });

  it("names no standard for the night board, which is not planned by weekday", () => {
    // Nights keep the two standards they always had, chosen by hand.
    expect(matrixForDate("Night", MON)).toBeNull();
    expect(matrixForDate("Night", SAT)).toBeNull();
  });
});

describe("matrixKindsFor", () => {
  it("offers the day board its four standards in the order the week runs", () => {
    expect(matrixKindsFor("Day").map((k) => k.kind)).toEqual(["monday", "full", "friday", "weekend"]);
  });

  it("leaves the night board the two standards it already had", () => {
    expect(matrixKindsFor("Night").map((k) => k.kind)).toEqual(["normal", "changeover"]);
  });

  it("labels every standard it offers", () => {
    // The label is read back in a toast and in the copy menu; an empty one there is a
    // sentence with a hole in it.
    for (const shift of ["Day", "Night"]) {
      for (const k of matrixKindsFor(shift)) {
        expect(k.label.length).toBeGreaterThan(0);
        expect(k.hint.length).toBeGreaterThan(0);
      }
    }
  });
});
