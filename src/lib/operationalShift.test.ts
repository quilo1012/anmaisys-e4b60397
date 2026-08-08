import { describe, it, expect } from "vitest";
import { currentShift, shiftRank } from "@/lib/operationalShift";
import { shiftTimeToIso } from "@/lib/productionTime";

/** An instant given as a London wall clock, in August (UTC+1). */
const bst = (day: number, hm: string) => new Date(`2026-08-${String(day).padStart(2, "0")}T${hm}:00+01:00`);
/** The same, in December (UTC). */
const gmt = (day: number, hm: string) => new Date(`2026-12-${String(day).padStart(2, "0")}T${hm}:00Z`);

describe("currentShift", () => {
  it("opens on the day board through the working day", () => {
    for (const hm of ["06:00", "09:30", "13:00", "17:59"]) {
      expect(currentShift(bst(6, hm))).toMatchObject({ shift: "Day", operationalDate: "2026-08-06", carriedOver: false });
    }
  });

  it("opens on the night board from six in the evening", () => {
    for (const hm of ["18:00", "21:15", "23:59"]) {
      expect(currentShift(bst(6, hm))).toMatchObject({ shift: "Night", operationalDate: "2026-08-06", carriedOver: false });
    }
  });

  it("files the small hours under the night that is still running", () => {
    // The bug this exists for: at 03:00 the board showed an empty Day board for 07/08
    // while forty-eight people were on the floor finishing the night of 06/08.
    expect(currentShift(bst(7, "03:00"))).toEqual({
      shift: "Night", operationalDate: "2026-08-06", carriedOver: true,
    });
    expect(currentShift(bst(7, "00:01")).operationalDate).toBe("2026-08-06");
    expect(currentShift(bst(7, "05:59")).operationalDate).toBe("2026-08-06");
  });

  it("hands over to the day crew exactly at six", () => {
    expect(currentShift(bst(7, "05:59"))).toMatchObject({ shift: "Night", operationalDate: "2026-08-06" });
    expect(currentShift(bst(7, "06:00"))).toMatchObject({ shift: "Day", operationalDate: "2026-08-07" });
  });

  it("crosses the month, not just the day", () => {
    expect(currentShift(bst(1, "02:00")).operationalDate).toBe("2026-07-31");
  });

  it("reads the London clock, not the browser's", () => {
    // 05:30 UTC in August is 06:30 in London — the day crew is already in. A browser
    // an hour behind would hand their first hour to the night board.
    expect(currentShift(new Date("2026-08-07T05:30:00Z"))).toMatchObject({
      shift: "Day", operationalDate: "2026-08-07",
    });
    // The same wall clock in December is genuinely still the night.
    expect(currentShift(gmt(7, "05:30"))).toMatchObject({ shift: "Night", operationalDate: "2026-12-06" });
  });

  it("agrees with the rule production times already use", () => {
    // Both must file 02:00 under the previous evening's date, or a run recorded at two
    // in the morning sits on one date and the board that recorded it on another.
    const { operationalDate } = currentShift(bst(7, "02:00"));
    const typed = shiftTimeToIso("02:00", operationalDate, "NIGHT");
    expect(typed!.slice(0, 10)).toBe("2026-08-07"); // the instant is the 7th…
    expect(operationalDate).toBe("2026-08-06");     // …filed under the 6th
  });
});

describe("shiftRank", () => {
  it("puts Day before Night", () => {
    expect(shiftRank("DAY")).toBeLessThan(shiftRank("NIGHT"));
  });

  it("does not care how the shift was spelled", () => {
    // `production_sessions.shift` is upper case; `daily_allocations.shift` is "Day".
    for (const d of ["DAY", "Day", " day "]) expect(shiftRank(d)).toBe(0);
    for (const n of ["NIGHT", "Night", "night"]) expect(shiftRank(n)).toBe(1);
  });

  it("sorts anything else last, never between the two", () => {
    for (const other of ["Weekend", "", null, undefined]) {
      expect(shiftRank(other)).toBeGreaterThan(shiftRank("NIGHT"));
    }
  });

  it("takes each line down its two shifts before the next line", () => {
    // The order Production Control is read in: the LINE is the outer grouping and the
    // shift decides within it. Not two blocks of every line — Daniel corrected this.
    const rows = [
      { shift: "NIGHT", line: "Line 1" }, { shift: "DAY", line: "Line 2" },
      { shift: "NIGHT", line: "Line 2" }, { shift: "DAY", line: "Line 1" },
    ];
    expect(
      rows.slice().sort((a, b) => a.line.localeCompare(b.line) || shiftRank(a.shift) - shiftRank(b.shift))
        .map((r) => `${r.line} ${r.shift}`),
    ).toEqual(["Line 1 DAY", "Line 1 NIGHT", "Line 2 DAY", "Line 2 NIGHT"]);
  });
});
