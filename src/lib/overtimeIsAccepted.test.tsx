/**
 * The Headcount shows as overtime only overtime somebody accepted.
 *
 * 03/11/2026: Felipe Pinelli (Fri–Mon crew) was on Blender Team on the Tuesday night
 * board as overtime, and My Overtime told him "Booked — put on the Headcount by the
 * office". He had answered neither of that night's two asks. The row was the board's
 * own rota stamp (`statusForPlacement`: placed off rota → `overtime`), one of 85 like it
 * since 20/10. The status stays — payroll reads it — and the board stops calling it
 * accepted overtime.
 *
 * `asks` is what `useConfirmedOvertime` hands the board: answers with
 * `decision = 'accepted'` on an ask that is not cancelled, without a drop-out. A pending,
 * declined or cancelled answer never reaches it, so here it is simply absent.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Chip } from "@/pages/dashboard/ProductionHeadcountPage";
import { overtimeIsAccepted, type ConfirmedAsk } from "./boardOvertime";
import { tallyBoard } from "./boardTally";
import { statusForPlacement } from "./rotaStatus";

const ACCEPTED: ConfirmedAsk[] = [
  { request_id: "q1", employee_id: "e1", on_date: "2026-11-03", starts_at: "18:00:00", ends_at: "06:00:00" },
];
const offRota = { known: true, coversDay: false, onThisBoard: true };
const onRota = { known: true, coversDay: true, onThisBoard: true };

describe("overtimeIsAccepted", () => {
  it("accepted: a row the bridge wrote for the ask", () => {
    expect(overtimeIsAccepted({ status: "overtime", overtime_request_id: "q1" }, undefined)).toBe(true);
  });

  it("accepted: placed by hand, with an accepted answer for this board", () => {
    expect(overtimeIsAccepted({ status: "overtime", overtime_request_id: null }, ACCEPTED)).toBe(true);
  });

  it("pending, no response, declined or cancelled: the rota's stamp alone is not accepted", () => {
    // None of those reach the confirmed list, which is all this reads.
    expect(overtimeIsAccepted({ status: "overtime", overtime_request_id: null }, [])).toBe(false);
    expect(overtimeIsAccepted({ status: "overtime", overtime_request_id: null }, undefined)).toBe(false);
  });

  it("the stamp it is guarding against: placing somebody off rota writes overtime without asking", () => {
    expect(statusForPlacement("assigned", null, offRota)).toBe("overtime");
  });

  it("a normal shift is never overtime, accepted or not", () => {
    expect(statusForPlacement("assigned", null, onRota)).toBe("assigned");
    expect(overtimeIsAccepted({ status: "assigned", overtime_request_id: null }, ACCEPTED)).toBe(false);
  });
});

describe("tallyBoard with overtimeAccepted", () => {
  const areas = [{ id: "l1", kind: "production" }];
  const allocations = [
    { employee_id: "normal", status: "assigned", area_id: "l1" },
    { employee_id: "e1", status: "overtime", area_id: "l1" },       // accepted
    { employee_id: "noYes", status: "overtime", area_id: "l1" },    // rota stamp
    { employee_id: "noLine", status: "overtime", area_id: null },   // rota stamp, no line
  ];
  const accepted = new Set(["e1"]);
  const t = tallyBoard({
    allocations, areas, roster: [], drawable: () => true,
    overtimeAccepted: (a) => accepted.has(a.employee_id),
  });

  it("counts as overtime only the accepted, and says how many were stamped without a yes", () => {
    expect(t.overtime).toBe(1);
    expect(t.overtimeNotAccepted).toBe(2);
  });

  it("keeps everybody in their column and in the total: nobody is taken off the board", () => {
    expect(t.inProduction).toBe(3);
    expect(t.working).toBe(1);
  });

  it("without the predicate, counts every overtime row as before", () => {
    const old = tallyBoard({ allocations, areas, roster: [], drawable: () => true });
    expect(old.overtime).toBe(3);
    expect(old.overtimeNotAccepted).toBe(0);
  });
});

describe("the board card", () => {
  const draw = (props: { overtime?: boolean; overtimeNotAccepted?: boolean }) =>
    render(<Chip name="P" tone="production" draggable={false} onDragStart={() => {}} {...props} />);

  it("says 'Not accepted' on overtime the rota stamped", () => {
    draw({ overtimeNotAccepted: true });
    expect(screen.getByTestId("overtime-not-accepted")).toHaveTextContent("Not accepted");
  });

  it("says nothing of the kind on accepted overtime or a normal shift", () => {
    draw({ overtime: true });
    expect(screen.queryByTestId("overtime-not-accepted")).toBeNull();
  });
});
