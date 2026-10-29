import { describe, it, expect } from "vitest";
import { countResponses, myStatusLabel, supervisorLabel } from "@/lib/overtimeRequests";

/**
 * The employee's card and the supervisor's Overtime page read the same
 * `overtime_responses` row. Through a change of mind — yes onto the reserve, left, yes
 * again, moved up — both must say the same thing at every step: the card's badge
 * (`myStatusLabel`) and the supervisor's counts (`countResponses`, plus the "said no"
 * list, which is `answer = 'no'`).
 *
 * The row in each step is the one the database writes (leave_my_reserve since BLOCO
 * 137, answer_overtime, the reserve promotion), checked end to end in
 * supabase/tests/a_no_after_the_reserve_can_become_a_yes_test.sql.
 */
type Row = { answer: "yes" | "no"; decision: "accepted" | "reserve" | "declined" | null };
const ask = { status: "open" as const, headcount: 1 };

function bothSides(row: Row) {
  const counts = countResponses(ask, [row]);
  return {
    employee: myStatusLabel(ask, row),
    employeeSupervisorLine: supervisorLabel(ask, row),
    adminInterested: counts.interested,
    adminAccepted: counts.accepted,
    adminReserve: counts.reserve,
    adminSaidNo: row.answer === "no" ? 1 : 0,
  };
}

describe("a change of mind reads the same on both screens", () => {
  it("yes onto a full ask: reserve on both", () => {
    expect(bothSides({ answer: "yes", decision: "reserve" })).toMatchObject({
      employee: "Reserve", adminInterested: 1, adminReserve: 1, adminAccepted: 0, adminSaidNo: 0,
    });
  });

  it("reserve left (BLOCO 137: a plain no): declined on both, and held by nobody", () => {
    expect(bothSides({ answer: "no", decision: null })).toMatchObject({
      employee: "You said no", employeeSupervisorLine: null,
      adminInterested: 0, adminReserve: 0, adminAccepted: 0, adminSaidNo: 1,
    });
  });

  it("yes again: back on the reserve on both — not confirmed on either", () => {
    const s = bothSides({ answer: "yes", decision: "reserve" });
    expect(s.employee).toBe("Reserve");
    expect(s.adminAccepted).toBe(0);
    expect(s.adminReserve).toBe(1);
  });

  it("moved up: in on both", () => {
    expect(bothSides({ answer: "yes", decision: "accepted" })).toMatchObject({
      employee: "You're in", adminAccepted: 1, adminReserve: 0, adminSaidNo: 0,
    });
  });

  it("the row the old leave_my_reserve left (no + reserve) is a no on both, never a place", () => {
    expect(bothSides({ answer: "no", decision: "reserve" })).toMatchObject({
      employee: "You said no", employeeSupervisorLine: null,
      adminInterested: 0, adminReserve: 0, adminAccepted: 0, adminSaidNo: 1,
    });
  });
});
