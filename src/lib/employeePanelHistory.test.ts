import { describe, expect, it } from "vitest";
import { buildBoardOvertime, buildPositionTimeline } from "./employeePanelHistory";

const name = (id: string | null) => (id === "mt-n" ? "Mon–Thu nights" : id === "tf-d" ? "Tue–Fri days" : id === "mt-d" ? "Mon–Thu days" : "No rota");

describe("position timeline", () => {
  it("hides and counts saves identical to the row before", () => {
    const t = buildPositionTimeline([
      { effective_from: "2026-08-01", shift_group: "Night", shift_pattern_id: "mt-n", note: null },
      { effective_from: "2026-09-10", shift_group: "Night", shift_pattern_id: "mt-n", note: "panel" },
      { effective_from: "2026-10-21", shift_group: "Night", shift_pattern_id: "mt-n", note: "panel" },
    ], [], name);
    expect(t.hiddenNoops).toBe(2);
    expect(t.entries).toHaveLength(1);
    expect(t.entries[0].opening).toBe(true);
  });

  it("a changed row shows before → after", () => {
    const t = buildPositionTimeline([
      { effective_from: "2026-08-01", shift_group: "Day", shift_pattern_id: "mt-d", note: null },
      { effective_from: "2026-09-10", shift_group: "Night", shift_pattern_id: "tf-d", note: null },
    ], [], name);
    expect(t.entries[0].lines).toEqual(["Shift: Day → Night", "Rota: Mon–Thu days → Tue–Fri days"]);
  });

  it("the same change in record and dated history shows once", () => {
    const t = buildPositionTimeline([
      { effective_from: "2026-08-01", shift_group: "Day", shift_pattern_id: "mt-d", note: null },
      { effective_from: "2026-10-20", shift_group: "Night", shift_pattern_id: "mt-d", note: null },
    ], [{
      id: "r1", changed_at: "2026-10-20T10:00:00Z",
      before_values: { position: "Operative", shift_group: "Day", shift_pattern_id: "mt-d" },
      after_values: { position: "Operative", shift_group: "Night", shift_pattern_id: "mt-d" },
    }], name);
    expect(t.entries.flatMap((e) => e.lines).filter((l) => l.startsWith("Shift:"))).toHaveLength(1);
  });

  it("a person with no dated row is flagged for the empty sentence", () => {
    expect(buildPositionTimeline([], [], name).hasDated).toBe(false);
  });
});

describe("board overtime", () => {
  const today = "2026-10-30";
  const board = [
    { on_date: "2026-10-31", shift: "Day", area_name: "Line 2", overtime_request_id: null },
    { on_date: "2026-10-25", shift: "Day", area_name: "Line 1", overtime_request_id: "q1" },
    { on_date: "2026-08-08", shift: "Night", area_name: "Line 3", overtime_request_id: null },
  ];
  const asks = [
    { request_id: "q1", on_date: "2026-10-25", starts_at: "06:00:00", ends_at: "14:00:00", outcome: "attended" },
    { request_id: "q2", on_date: "2026-11-01", starts_at: "06:00:00", ends_at: "18:00:00", outcome: "cancelled_in_time" },
  ];
  const clock = [{ on_date: "2026-10-25", start_time: "05:55", end_time: "14:10", worked_minutes: 495, balance_minutes: 15 }];

  it("future reads Booked, linked ask carries hours and outcome, cancelled booking listed", () => {
    const { lines } = buildBoardOvertime(board, asks, clock, today);
    expect(lines.find((l) => l.date === "2026-10-31")?.state).toBe("booked");
    const d25 = lines.find((l) => l.date === "2026-10-25")!;
    expect(d25).toMatchObject({ state: "worked", hours: "06:00–14:00", outcome: "attended" });
    expect(lines.find((l) => l.date === "2026-11-01")?.state).toBe("cancelled");
  });

  it("clock is attached beside the date and never counted", () => {
    const { lines, summary } = buildBoardOvertime(board, asks, clock, today);
    expect(lines.find((l) => l.date === "2026-10-25")?.clock?.worked_minutes).toBe(495);
    expect(summary).toEqual({ total: 2, last30: 1, upcoming: 1 });
  });
});
