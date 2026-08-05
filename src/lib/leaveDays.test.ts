import { describe, it, expect } from "vitest";
import { leaveDays, eachDate, describeLeaveDays, leaveBalance, leaveYearOf, countSpells } from "@/lib/leaveDays";

// ISO weekdays: 1 = Monday … 7 = Sunday.
const MON_THU = [1, 2, 3, 4];
const MON_FRI = [1, 2, 3, 4, 5];
const FRI_MON = [5, 6, 7, 1];

describe("eachDate", () => {
  it("is inclusive at both ends", () => {
    expect(eachDate("2026-08-03", "2026-08-05")).toEqual(["2026-08-03", "2026-08-04", "2026-08-05"]);
  });

  it("treats a backwards range as empty rather than crashing", () => {
    expect(eachDate("2026-08-05", "2026-08-03")).toEqual([]);
  });

  it("steps over a month end", () => {
    expect(eachDate("2026-07-31", "2026-08-01")).toEqual(["2026-07-31", "2026-08-01"]);
  });
});

describe("leaveDays", () => {
  it("counts a week off for a Mon–Thu person as four days, not seven", () => {
    // Mon 03 Aug 2026 to Sun 09 Aug 2026.
    const d = leaveDays("2026-08-03", "2026-08-09", MON_THU);
    expect(d.calendarDays).toBe(7);
    expect(d.workingDays).toBe(4);
    expect(d.workingDates).toEqual(["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06"]);
  });

  it("counts the same week as five for a Mon–Fri person", () => {
    expect(leaveDays("2026-08-03", "2026-08-09", MON_FRI).workingDays).toBe(5);
  });

  it("handles a pattern that wraps the weekend", () => {
    // Fri–Mon: Friday, Saturday, Sunday and Monday.
    const d = leaveDays("2026-08-03", "2026-08-09", FRI_MON);
    expect(d.workingDays).toBe(4);
    expect(d.workingDates).toEqual(["2026-08-03", "2026-08-07", "2026-08-08", "2026-08-09"]);
  });

  it("says nothing rather than zero when no rota is on file", () => {
    // Missing information and "works no days" are different facts. A zero would let
    // a request be approved for nothing with nobody knowing which it was.
    const d = leaveDays("2026-08-03", "2026-08-09", null);
    expect(d.workingDays).toBeNull();
    expect(d.calendarDays).toBe(7);
    expect(describeLeaveDays(d)).toBe("rota not recorded");
  });

  it("reports zero working days when the range genuinely misses the rota", () => {
    // A Mon–Thu person asking for the Saturday and Sunday spends no entitlement.
    const d = leaveDays("2026-08-08", "2026-08-09", MON_THU);
    expect(d.workingDays).toBe(0);
    expect(describeLeaveDays(d)).toBe("no working days in this range");
  });

  it("counts a single day correctly", () => {
    expect(describeLeaveDays(leaveDays("2026-08-04", "2026-08-04", MON_THU))).toBe("1 day");
  });

  it("does not drift across a daylight-saving boundary", () => {
    // UK clocks go back on 25 Oct 2026. Naive date maths repeats or skips a day here.
    const d = leaveDays("2026-10-23", "2026-10-27", MON_FRI);
    expect(d.calendarDays).toBe(5);
    expect(d.workingDates).toEqual(["2026-10-23", "2026-10-26", "2026-10-27"]);
  });
});


describe("leaveYearOf", () => {
  it("runs 1 August to 31 July", () => {
    expect(leaveYearOf("2026-08-04")).toEqual({ from: "2026-08-01", to: "2027-07-31" });
    expect(leaveYearOf("2027-07-31")).toEqual({ from: "2026-08-01", to: "2027-07-31" });
    // The day before the year opens belongs to the year before.
    expect(leaveYearOf("2026-07-31")).toEqual({ from: "2025-08-01", to: "2026-07-31" });
  });
});

describe("leaveBalance", () => {
  const TODAY = "2026-08-04";
  /** `n` consecutive recorded days off starting on `from`. */
  const days = (from: string, n: number, amount = 1) =>
    eachDate(from, (() => { const d = new Date(`${from}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n - 1); return d.toISOString().slice(0, 10); })())
      .map((date) => ({ date, amount }));

  it("reconciles with the BrightPay figures for Mon–Thu", () => {
    // 0 taken, 5 booked, 17.5 remaining, 22.5 total.
    const b = leaveBalance(days("2026-09-07", 5), 22.5, TODAY);
    expect(b).toEqual({ taken: 0, booked: 5, remaining: 17.5, total: 22.5 });
  });

  it("reconciles for Tue–Fri", () => {
    const b = leaveBalance(days("2026-10-06", 3), 21.5, TODAY);
    expect(b).toEqual({ taken: 0, booked: 3, remaining: 18.5, total: 21.5 });
  });

  it("reconciles for Fri–Mon", () => {
    const b = leaveBalance(days("2026-12-04", 8), 22.5, TODAY);
    expect(b).toEqual({ taken: 0, booked: 8, remaining: 14.5, total: 22.5 });
  });

  it("splits taken from booked on today", () => {
    // Spent and promised are different questions, and BrightPay reports them apart.
    const b = leaveBalance([
      ...days("2026-08-01", 3),   // over
      ...days("2026-08-10", 4),   // to come
    ], 22.5, TODAY);
    expect(b.taken).toBe(3);
    expect(b.booked).toBe(4);
    expect(b.remaining).toBe(15.5);
  });

  it("counts a request running right now as booked, not taken", () => {
    expect(leaveBalance(days("2026-08-04", 4), 22.5, TODAY).booked).toBe(4);
  });

  it("carries half days, because the sheet does", () => {
    expect(leaveBalance(days("2026-09-01", 1, 0.5), 22.5, TODAY).remaining).toBe(22);
  });

  it("ignores leave from another leave year", () => {
    expect(leaveBalance(days("2026-07-20", 4), 22.5, TODAY).taken).toBe(0);
  });

  it("says nothing rather than zero when the pattern has no entitlement on file", () => {
    // Mon–Fri and Sun are not in BrightPay's table yet. A remaining of 0 would read
    // as "no days left" when it means "nobody has told us how many there are".
    const b = leaveBalance(days("2026-09-01", 2), null, TODAY);
    expect(b.total).toBeNull();
    expect(b.remaining).toBeNull();
    expect(b.booked).toBe(2);
  });
});

describe("countSpells", () => {
  it("counts a run of consecutive days as one spell", () => {
    expect(countSpells(["2026-08-03", "2026-08-04", "2026-08-05"])).toBe(1);
  });

  it("counts scattered single days separately", () => {
    // The whole point: five days in one go and five days across the year both count
    // five, and only one of them is the pattern a manager is looking for.
    expect(countSpells(["2026-04-06", "2026-05-11", "2026-06-01", "2026-07-20", "2026-08-03"])).toBe(5);
  });

  it("does not care what order the dates arrive in, or repeat one", () => {
    expect(countSpells(["2026-08-05", "2026-08-03", "2026-08-04", "2026-08-04"])).toBe(1);
  });

  it("is zero for nobody off at all", () => {
    expect(countSpells([])).toBe(0);
  });

  it("starts a new spell after a gap of a single day", () => {
    expect(countSpells(["2026-08-03", "2026-08-05"])).toBe(2);
  });
});
