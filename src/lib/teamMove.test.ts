import { describe, it, expect } from "vitest";
import { planTeamMove } from "@/lib/teamMove";

const row = (id: string, area_id: string | null, status = "assigned", is_leader = false) =>
  ({ id: `r-${id}`, employee_id: id, area_id, status, is_leader });

describe("moving a whole line's team", () => {
  it("moves everybody working on the line, overtime included, and nobody else", () => {
    const rows = [
      row("a", "L4"), row("b", "L4"), row("c", "L4", "overtime"), row("d", "L4"), row("e", "L4"),
      row("f", "L5"), row("g", null, "sick"), row("h", "L1"),
    ];
    const plan = planTeamMove({ allocations: rows, from: "L4", to: "L5", drawable: () => true });
    expect(plan.movers.map((r) => r.employee_id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(plan.staying).toEqual([]);
  });

  it("leaves behind, and says why, a row whose person is no longer on the active list", () => {
    const rows = [row("a", "L4"), row("left", "L4")];
    const plan = planTeamMove({ allocations: rows, from: "L4", to: "L5", drawable: (id) => id !== "left" });
    expect(plan.movers.map((r) => r.employee_id)).toEqual(["a"]);
    expect(plan.staying.map((s) => s.row.employee_id)).toEqual(["left"]);
    expect(plan.staying[0].reason).toMatch(/not on the active staff list/i);
  });

  it("carries the line's leader when the destination has none", () => {
    const rows = [row("lead", "L4", "assigned", true), row("a", "L4")];
    const plan = planTeamMove({ allocations: rows, from: "L4", to: "L5", drawable: () => true });
    expect(plan.carryLeader?.employee_id).toBe("lead");
    expect(plan.destinationLeader).toBeNull();
  });

  it("does not carry the leader onto a line that already has one", () => {
    const rows = [row("lead", "L4", "assigned", true), row("a", "L4"), row("other", "L5", "assigned", true)];
    const plan = planTeamMove({ allocations: rows, from: "L4", to: "L5", drawable: () => true });
    expect(plan.carryLeader).toBeNull();
    expect(plan.destinationLeader?.employee_id).toBe("other");
  });

  it("refuses a move onto the same line, or onto no line", () => {
    const rows = [row("a", "L4")];
    expect(() => planTeamMove({ allocations: rows, from: "L4", to: "L4", drawable: () => true })).toThrow();
    expect(() => planTeamMove({ allocations: rows, from: "L4", to: "", drawable: () => true })).toThrow();
  });

  it("has nothing to move from an empty line", () => {
    const plan = planTeamMove({ allocations: [row("a", "L1")], from: "L4", to: "L5", drawable: () => true });
    expect(plan.movers).toEqual([]);
  });
});
