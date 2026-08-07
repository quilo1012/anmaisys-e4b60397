import { describe, it, expect } from "vitest";
import {
  expectedShifts, buildShiftBalances, shiftTotals, shortfallIsReliable,
  type ShiftBalanceInput,
} from "@/lib/shiftBalance";

const FROM = "2026-07-13";
const TO = "2026-08-04";

const person = (over: Partial<ShiftBalanceInput> = {}): ShiftBalanceInput => ({
  employeeId: "e1", name: "Ana Silva", department: "Production",
  patternName: "Mon–Thu days", patternDays: [1, 2, 3, 4],
  present: 0, holiday: 0, sick: 0, unpaid: 0, boardPlanned: true, ...over,
});

describe("expectedShifts", () => {
  it("counts the rota's own weekdays across the period", () => {
    // 13/07 to 04/08 is 23 days: a Mon–Thu rota falls on fourteen of them, a Fri–Mon
    // on thirteen. These are the figures the live period produced.
    expect(expectedShifts([1, 2, 3, 4], FROM, TO)).toBe(14);
    expect(expectedShifts([5, 6, 7, 1], FROM, TO)).toBe(13);
    expect(expectedShifts([2, 3, 4, 5], FROM, TO)).toBe(13);
  });

  it("counts a Sunday rota as Sundays, not as nothing", () => {
    expect(expectedShifts([7], FROM, TO)).toBe(3);
  });

  it("is null without a rota, rather than zero", () => {
    // Zero would read as "owes nothing", which is what somebody with no rota on file
    // is not — it is not known what they owe.
    expect(expectedShifts(null, FROM, TO)).toBeNull();
    expect(expectedShifts([], FROM, TO)).toBeNull();
  });

  it("refuses a period that ends before it starts", () => {
    expect(expectedShifts([1], TO, FROM)).toBeNull();
  });
});

describe("buildShiftBalances", () => {
  it("reproduces the overtime the live period showed", () => {
    // Fabio Silva: Fri–Mon, thirteen owed, twenty-two worked.
    const r = buildShiftBalances(
      [person({ patternDays: [5, 6, 7, 1], present: 22 })], FROM, TO,
    )[0];
    expect(r.expected).toBe(13);
    expect(r.needed).toBe(13);
    expect(r.balance).toBe(9);
  });

  it("takes booked holiday off what was owed", () => {
    // Felipe Pinelli: thirteen owed less three days of holiday is ten, eighteen worked.
    const r = buildShiftBalances(
      [person({ patternDays: [5, 6, 7, 1], present: 18, holiday: 3 })], FROM, TO,
    )[0];
    expect(r.needed).toBe(10);
    expect(r.balance).toBe(8);
  });

  it("leaves sickness and unpaid in the requirement, and says so by carrying them", () => {
    // The agreed rule deducts holiday only. Deducting these as well moved five more
    // people into overtime on the live period, which is a payroll decision.
    const r = buildShiftBalances(
      [person({ present: 10, sick: 2, unpaid: 2 })], FROM, TO,
    )[0];
    expect(r.needed).toBe(14);
    expect(r.balance).toBe(-4);
    expect(r.sick).toBe(2);
    expect(r.unpaid).toBe(2);
  });

  it("never asks for negative work when the holiday exceeds the rota", () => {
    const r = buildShiftBalances([person({ present: 0, holiday: 20 })], FROM, TO)[0];
    expect(r.needed).toBe(0);
    expect(r.balance).toBe(0);
  });

  it("leaves the balance unstated when no rota is on file", () => {
    const r = buildShiftBalances([person({ patternDays: null, present: 9 })], FROM, TO)[0];
    expect(r.expected).toBeNull();
    expect(r.balance).toBeNull();
  });
});

describe("shiftTotals", () => {
  it("counts overtime and shortfall separately and never nets them", () => {
    const t = shiftTotals(buildShiftBalances([
      person({ employeeId: "a", name: "A", present: 18 }),
      person({ employeeId: "b", name: "B", present: 10 }),
    ], FROM, TO));
    expect(t.inOvertime).toBe(1);
    expect(t.overtimeShifts).toBe(4);
    expect(t.inDeficit).toBe(1);
    expect(t.deficitShifts).toBe(4);
  });

  it("counts people with a rota and nothing at all on the board", () => {
    // Not absence — a name the import could not place. Luiz Badejo showed thirteen
    // shifts short off a single board line, having worked the period.
    const t = shiftTotals(buildShiftBalances([person({ present: 0 })], FROM, TO));
    expect(t.noBoardRecord).toBe(1);
  });
});

describe("shortfallIsReliable", () => {
  const build = (o: Partial<ShiftBalanceInput>) => buildShiftBalances([person(o)], FROM, TO)[0];

  it("trusts every overtime figure", () => {
    // The board cannot invent a day somebody stood on a line.
    expect(shortfallIsReliable(build({ present: 20 }))).toBe(true);
  });

  it("distrusts a shortfall from an empty board record", () => {
    expect(shortfallIsReliable(build({ present: 0 }))).toBe(false);
  });

  it("distrusts a shortfall when barely half the days were marked", () => {
    expect(shortfallIsReliable(build({ present: 3 }))).toBe(false);
  });

  it("trusts a shortfall when the days were marked and they were genuinely off", () => {
    expect(shortfallIsReliable(build({ present: 11, unpaid: 3 }))).toBe(true);
  });
});

describe("a board nobody planned", () => {
  // The night board has never been filled in. All forty-eight of its people read as a
  // full period short, which buries the two or three shortfalls that are real.
  const night = (o = {}) => person({ boardPlanned: false, present: 0, ...o });

  it("does not count them as short", () => {
    const t = shiftTotals(buildShiftBalances([night()], FROM, TO));
    expect(t.inDeficit).toBe(0);
    expect(t.deficitShifts).toBe(0);
  });

  it("counts them as their own thing instead", () => {
    expect(shiftTotals(buildShiftBalances([night()], FROM, TO)).onUnplannedBoard).toBe(1);
  });

  it("keeps them out of the missing-from-the-board count", () => {
    // Their absence is nobody's entry, not their absence.
    expect(shiftTotals(buildShiftBalances([night()], FROM, TO)).noBoardRecord).toBe(0);
  });

  it("still counts somebody missing from a board that WAS planned", () => {
    const t = shiftTotals(buildShiftBalances([person({ present: 0 })], FROM, TO));
    expect(t.noBoardRecord).toBe(1);
    expect(t.onUnplannedBoard).toBe(0);
  });

  it("never calls a shortfall on an unplanned board reliable", () => {
    expect(shortfallIsReliable(buildShiftBalances([night()], FROM, TO)[0])).toBe(false);
  });
});
