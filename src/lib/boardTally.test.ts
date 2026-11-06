import { describe, it, expect } from "vitest";
import { tallyBoard, boardTrend, nextIsoDay } from "./boardTally";

const areas = [
  { id: "l1", kind: "production" },
  { id: "l2", kind: "production" },
  { id: "wh", kind: "support" },
];
const row = (employee_id: string, status: string, area_id: string | null = null) => ({ employee_id, status, area_id });

describe("tallyBoard", () => {
  const allocations = [
    row("a", "assigned", "l1"),
    row("b", "assigned", "l1"),
    row("c", "assigned", "wh"),
    row("d", "overtime", "l2"),
    row("e", "sick"),
    row("f", "holiday"),
    row("g", "unpaid"),
    row("h", "training"),
    row("gone", "assigned", "l1"), // somebody the board cannot draw
  ];
  const roster = ["a", "b", "c", "e", "f", "x", "y"].map((id) => ({ id }));
  const t = tallyBoard({ allocations, areas, roster, drawable: (id) => id !== "gone" });

  it("counts working as assigned only", () => {
    expect(t.working).toBe(3);
  });
  // 25/10: the board said 40, the printed sheet 51 — the overtime people on the lines.
  it("counts everybody in an area column as in production, overtime included, split into lines and support", () => {
    expect(t.inProduction).toBe(4);
    expect(t.onLines).toBe(3);
    expect(t.support).toBe(1);
    expect(t.onLines + t.support).toBe(t.inProduction);
  });
  it("keeps overtime and training out of working and out of away", () => {
    expect(t.overtime).toBe(1);
    expect(t.training).toBe(1);
    expect(t.away).toEqual({ sick: 1, holiday: 1, unpaid: 1, total: 3 });
  });
  it("leaves out rows the board cannot draw", () => {
    expect(t.byArea.get("l1")).toEqual({ working: 2, overtime: 0 });
  });
  it("counts each area's working and overtime people", () => {
    expect(t.byArea.get("l2")).toEqual({ working: 0, overtime: 1 });
    expect(t.byArea.get("wh")).toEqual({ working: 1, overtime: 0 });
  });
  it("says who the rota has due and nobody placed", () => {
    expect(t.onRota).toBe(7);
    expect(t.notPlaced).toBe(2); // x and y; e and f are placed, as away
  });
  it("is all zeros on an empty board", () => {
    const empty = tallyBoard({ allocations: [], areas, roster: [], drawable: () => true });
    expect(empty).toMatchObject({ onRota: 0, working: 0, overtime: 0, notPlaced: 0, away: { total: 0 } });
  });
});

describe("tallyBoard, a row with no line", () => {
  it("does not count an assigned row with no area as working, and leaves the person not placed", () => {
    const t = tallyBoard({
      allocations: [
        { employee_id: "a", area_id: "l1", status: "assigned" },
        { employee_id: "b", area_id: null, status: "assigned" },
        { employee_id: "c", area_id: null, status: "overtime" },
      ],
      areas: [{ id: "l1", kind: "production" }],
      roster: [{ id: "a" }, { id: "b" }],
      drawable: () => true,
    });
    expect(t.working).toBe(1);
    expect(t.notPlaced).toBe(1);
    expect(t.overtime).toBe(1);
    // Overtime with no area is in its own block only, as on paper.
    expect(t.inProduction).toBe(1);
  });
});

describe("boardTrend", () => {
  it("gives every day a point, empty days as zero", () => {
    const days = boardTrend(
      [
        { on_date: "2026-10-12", employee_id: "a", status: "assigned" },
        { on_date: "2026-10-12", employee_id: "b", status: "sick" },
        { on_date: "2026-10-14", employee_id: "a", status: "overtime" },
        { on_date: "2026-10-20", employee_id: "a", status: "assigned" }, // outside
      ],
      "2026-10-12", "2026-10-14", () => true,
    );
    expect(days.map((d) => d.on_date)).toEqual(["2026-10-12", "2026-10-13", "2026-10-14"]);
    expect(days[0]).toMatchObject({ working: 1, sick: 1 });
    expect(days[1]).toMatchObject({ working: 0, overtime: 0, sick: 0 });
    expect(days[2]).toMatchObject({ overtime: 1 });
  });
  it("asks who the board can draw on each date", () => {
    const days = boardTrend(
      [
        { on_date: "2026-10-12", employee_id: "leaver", status: "assigned" },
        { on_date: "2026-10-13", employee_id: "leaver", status: "assigned" },
      ],
      "2026-10-12", "2026-10-13", (_id, d) => d <= "2026-10-12",
    );
    expect(days.map((d) => d.working)).toEqual([1, 0]);
  });
});

describe("nextIsoDay", () => {
  it("steps across a month end and the October clock change", () => {
    expect(nextIsoDay("2026-10-31")).toBe("2026-11-01");
    expect(nextIsoDay("2026-10-24")).toBe("2026-10-25");
    expect(nextIsoDay("2026-10-25")).toBe("2026-10-26");
  });
});
