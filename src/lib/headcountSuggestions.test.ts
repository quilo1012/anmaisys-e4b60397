import { describe, expect, it } from "vitest";
import { suggestHeadcountPlaces } from "./headcountSuggestions";

const base = {
  dueIds: ["a", "b", "c"], savedIds: [], awayIds: [], areaIds: ["l1", "l2"],
  primary: [], secondary: [], previous: [], onDate: "2026-10-21", today: "2026-10-19",
};
describe("automatic Headcount suggestions", () => {
  it("uses each employee's own previous day, including a different crew's older day", () => {
    expect(suggestHeadcountPlaces({ ...base, previous: [
      { employee_id: "a", area_id: "l1", status: "assigned", on_date: "2026-10-20" },
      { employee_id: "b", area_id: "l2", status: "assigned", on_date: "2026-10-16" },
      { employee_id: "a", area_id: "l2", status: "assigned", on_date: "2026-10-15" },
    ] })).toEqual([
      { employee_id: "a", area_id: "l1", status: "assigned" },
      { employee_id: "b", area_id: "l2", status: "assigned" },
    ]);
  });
  it("prefers habitual positions and falls back independently for missing employees", () => {
    expect(suggestHeadcountPlaces({ ...base,
      primary: [{ employee_id: "a", area_id: "l1" }],
      secondary: [{ employee_id: "b", area_id: "l2" }],
      previous: [{ employee_id: "a", area_id: "l2", status: "overtime", on_date: "2026-10-18" }],
    }).map((r) => r.area_id)).toEqual(["l1", "l2"]);
  });
  it("fills a partial board without changing saved placements or absences", () => {
    expect(suggestHeadcountPlaces({ ...base, savedIds: ["a"], awayIds: ["b"],
      primary: base.dueIds.map((employee_id) => ({ employee_id, area_id: "l1" })),
    })).toEqual([{ employee_id: "c", area_id: "l1", status: "assigned" }]);
  });
  it("does not place people outside the selected day's rota", () => {
    expect(suggestHeadcountPlaces({ ...base, dueIds: [], primary: [{ employee_id: "a", area_id: "l1" }] })).toEqual([]);
  });
  it("leaves unknown positions unplaced and skips inactive areas and nonworking history", () => {
    expect(suggestHeadcountPlaces({ ...base, previous: [
      { employee_id: "a", area_id: "inactive", status: "assigned", on_date: "2026-10-18" },
      { employee_id: "b", area_id: "l1", status: "holiday", on_date: "2026-10-18" },
      { employee_id: "c", area_id: "l2", status: "assigned", on_date: "2026-10-22" },
    ] })).toEqual([]);
  });
  it("suggests today's board but never fills historical days", () => {
    const primary = [{ employee_id: "a", area_id: "l1" }];
    expect(suggestHeadcountPlaces({ ...base, primary, onDate: base.today })).toHaveLength(1);
    expect(suggestHeadcountPlaces({ ...base, primary, onDate: "2026-10-18" })).toEqual([]);
  });
});