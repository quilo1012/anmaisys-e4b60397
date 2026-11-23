import { describe, it, expect } from "vitest";
import { tallyBoard } from "@/lib/boardTally";
import { attendanceForDay, attendanceForStatus } from "@/lib/attendanceFromBoard";
import { rowsToCopy } from "@/lib/copyBoard";
import { suggestHeadcountPlaces } from "@/lib/headcountSuggestions";
import { statusForPlacement, type RotaCover } from "@/lib/rotaStatus";

const offRota: RotaCover = { known: true, coversDay: false, onThisBoard: true };
const on: RotaCover = { known: true, coversDay: true, onThisBoard: true };

describe("Other department on the board", () => {
  const areas = [{ id: "l1", kind: "production" }, { id: "wh", kind: "support" }];

  it("is counted on its own: not away, not working, not in production", () => {
    const t = tallyBoard({
      allocations: [
        { employee_id: "a", area_id: null, status: "other_department" },
        { employee_id: "b", area_id: "l1", status: "assigned" },
      ],
      areas,
      roster: [{ id: "a" }, { id: "b" }],
      drawable: () => true,
    });
    expect(t.otherDepartment).toBe(1);
    expect(t.inProduction).toBe(1);
    expect(t.working).toBe(1);
    expect(t.away.total).toBe(0);
    // They have a row, so they are not "not placed".
    expect(t.notPlaced).toBe(0);
  });

  it("is a day present to payroll, and beats an away mark on the other board", () => {
    expect(attendanceForStatus("other_department")).toBe("present");
    expect(attendanceForDay(["other_department", "sick"])).toBe("present");
  });

  it("is never rewritten as overtime by the rota", () => {
    expect(statusForPlacement("other_department", null, offRota)).toBe("other_department");
  });
});

describe("Training as somebody's place on file", () => {
  const base = {
    dueIds: ["nik", "ana"], savedIds: [], awayIds: [], areaIds: ["l1"],
    primary: [], secondary: [], previous: [], onDate: "2026-11-24", today: "2026-11-23",
  };

  it("suggests the Training column for them, ahead of any line", () => {
    expect(suggestHeadcountPlaces({
      ...base,
      trainingIds: ["nik"],
      primary: [{ employee_id: "nik", area_id: "l1" }, { employee_id: "ana", area_id: "l1" }],
    })).toEqual([
      { employee_id: "nik", area_id: null, status: "training" },
      { employee_id: "ana", area_id: "l1", status: "assigned" },
    ]);
  });

  it("leaves alone a trainee already saved, away, or not due in", () => {
    expect(suggestHeadcountPlaces({ ...base, trainingIds: ["nik"], savedIds: ["nik"] })).toEqual([]);
    expect(suggestHeadcountPlaces({ ...base, trainingIds: ["nik"], awayIds: ["nik"] })).toEqual([]);
    expect(suggestHeadcountPlaces({ ...base, trainingIds: ["nik"], dueIds: ["ana"] })).toEqual([]);
  });

  it("is written as Training when the suggested plan is saved, and only then", () => {
    const source = [{ employee_id: "nik", area_id: null, status: "training" }];
    const args = { source, onDate: "2026-11-24", shift: "Day", alreadyOnTheDay: [], cover: () => on };
    expect(rowsToCopy({ ...args, keepTraining: true })).toEqual([
      { on_date: "2026-11-24", shift: "Day", employee_id: "nik", area_id: null, status: "training" },
    ]);
    // A day copied from another day carries only who was working.
    expect(rowsToCopy(args)).toEqual([]);
  });
});
