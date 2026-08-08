import { describe, it, expect } from "vitest";
import { absenceKind, splitAbsences } from "./absenceKind";

describe("absenceKind", () => {
  it("folds every name the two sources use for booked holiday", () => {
    expect(absenceKind("Vacation")).toBe("holiday");
    expect(absenceKind("holiday")).toBe("holiday");
    expect(absenceKind("Annual Leave")).toBe("holiday");
  });

  it("reads sick before anything else, so unpaid sick leave is sick", () => {
    expect(absenceKind("Sickness")).toBe("sick");
    expect(absenceKind("Unpaid sick leave")).toBe("sick");
  });

  it("keeps unpaid leave apart from holiday", () => {
    expect(absenceKind("Unpaid Leave")).toBe("unpaid");
  });

  it("does not guess at a name it has never seen", () => {
    expect(absenceKind("Jury service")).toBe("other");
    expect(absenceKind("")).toBe("other");
  });
});

describe("splitAbsences", () => {
  it("counts booked holiday apart from everything unplanned", () => {
    const s = splitAbsences({ Vacation: 2, Sickness: 1, "Unpaid Leave": 3 });
    expect(s.holiday).toBe(2);
    expect(s.sick).toBe(1);
    expect(s.unpaid).toBe(3);
    expect(s.other).toBe(0);
  });

  it("leaves holiday out of the unplanned list, under whatever name it arrived", () => {
    const s = splitAbsences({ Vacation: 2, Sickness: 1 });
    expect(s.unplanned).toEqual({ Sickness: 1 });
  });

  it("keeps the source's own wording for the unplanned ones", () => {
    const s = splitAbsences({ "Unpaid Leave": 1, "Jury service": 1 });
    expect(s.unplanned).toEqual({ "Unpaid Leave": 1, "Jury service": 1 });
    expect(s.other).toBe(1);
  });

  it("sums two spellings of holiday into one count", () => {
    const s = splitAbsences({ Vacation: 2, Holiday: 1 });
    expect(s.holiday).toBe(3);
    expect(s.unplanned).toEqual({});
  });

  it("reads nothing as nothing", () => {
    const s = splitAbsences({});
    expect(s).toEqual({ holiday: 0, sick: 0, unpaid: 0, other: 0, unplanned: {} });
  });
});
