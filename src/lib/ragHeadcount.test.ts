import { describe, it, expect } from "vitest";
import { summariseHeadcountDay, headcountAreaLabel, headcountAreas } from "./ragHeadcount";

const res = {
  sheet: "21.09.2026",
  source_file: "Production Headcount September.xlsx",
  production: { "Line 1": ["A", "B"], "Tablet line": ["C"] },
  support: { "WH team": ["D", "E"] },
  absence: [],
  holidays: ["Abner", "John"],
  counts: {
    production: { "Line 1": 2, "Tablet line": 1 },
    support: { "WH team": 2 },
    production_assigned: 3,
    support_assigned: 2,
    total_staff_calculated: 5,
    absence: 0,
    holidays: 2,
  },
};

describe("summariseHeadcountDay", () => {
  it("puts planned staff and the people who came in side by side", () => {
    const d = summariseHeadcountDay(res);
    expect(d.planned).toBe(5);
    expect(d.holidays).toBe(2);
    expect(d.actual).toBe(3);
  });

  it("falls back to the name lists when the sheet did no arithmetic", () => {
    const d = summariseHeadcountDay({ ...res, counts: null });
    expect(d.productionStaff).toBe(3);
    expect(d.supportStaff).toBe(2);
    expect(d.planned).toBe(5);
    expect(d.actual).toBe(3);
  });

  it("never reports fewer than nobody", () => {
    const d = summariseHeadcountDay({ counts: { total_staff_calculated: 1, holidays: 4 } });
    expect(d.actual).toBe(0);
  });

  it("keeps the area labels the workbook uses", () => {
    const d = summariseHeadcountDay(res);
    expect(Object.keys(d.production)).toEqual(["Line 1", "Tablet line"]);
    expect(headcountAreaLabel("Line 5 (A&B)")).toBe("Line 5");
    expect(headcountAreaLabel("Pill line")).toBe("Pill line");
  });

  it("collects every area seen across the week, in file order", () => {
    const a = summariseHeadcountDay(res);
    const b = summariseHeadcountDay({ ...res, counts: { production: { "Line 2": 4 }, support: {} } });
    expect(headcountAreas([a, b])).toEqual({
      production: ["Line 1", "Tablet line", "Line 2"],
      support: ["WH team"],
    });
  });
});
