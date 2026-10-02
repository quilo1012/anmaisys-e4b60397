import { describe, expect, it } from "vitest";
import {
  leaveRangeProblem, leaveSpellsInWindow, leaveDays, MAX_LEAVE_CALENDAR_DAYS,
} from "@/lib/leaveDays";

/** Mon–Thu, the commonest pattern in this factory. */
const MON_THU = [1, 2, 3, 4];

describe("leaveRangeProblem", () => {
  /**
   * The three ways of booking nothing, all of which used to report success.
   *
   * `create()` guarded that the three fields were filled in, and `leaveDays` answers
   * for a backwards range with an object like any other — so the guard passed, the
   * request went in as APPROVED, `applyToRecords` wrote nothing because there were no
   * working dates, and the toast said "Booked and written to the board".
   */
  it("refuses a range that ends before it starts", () => {
    const d = leaveDays("2026-08-10", "2026-08-03", MON_THU);
    expect(leaveRangeProblem("2026-08-10", "2026-08-03", d)).toMatch(/before the first/i);
  });

  it("refuses days the person was never due in", () => {
    // A Mon–Thu person taking the Saturday and Sunday: two calendar days, no
    // working days, and nothing for the board to write.
    const d = leaveDays("2026-08-08", "2026-08-09", MON_THU);
    expect(d.workingDays).toBe(0);
    expect(leaveRangeProblem("2026-08-08", "2026-08-09", d)).toMatch(/not due in/i);
  });

  /**
   * Missing information, not a mistake in the dates, so it does not get the same
   * sentence — `leaveDays` returns null rather than 0 for exactly this reason.
   */
  it("says the rota is missing, rather than blaming the dates", () => {
    const d = leaveDays("2026-08-03", "2026-08-06", null);
    expect(d.workingDays).toBeNull();
    expect(leaveRangeProblem("2026-08-03", "2026-08-06", d)).toMatch(/no rota/i);
  });

  /**
   * The typo this cap exists for: 2126 for 2026 is one keystroke, and it used to mean
   * ~36,500 iterations and some 26,000 upserts, written as approved with nothing to
   * undo them with.
   */
  it("refuses a hundred-year booking, and points at the year", () => {
    const problem = leaveRangeProblem("2026-08-01", "2126-08-01", leaveDays("2026-08-01", "2126-08-01", MON_THU));
    expect(problem).toMatch(/check the year/i);
    expect(problem).toMatch(/36,5\d\d/);
  });

  it("allows a long but real booking, right up to the cap", () => {
    // A year off is unusual and not impossible; the cap is a typo guard, not a policy.
    const to = new Date(Date.UTC(2026, 7, 1) + (MAX_LEAVE_CALENDAR_DAYS - 1) * 86_400_000)
      .toISOString().slice(0, 10);
    expect(leaveRangeProblem("2026-08-01", to, leaveDays("2026-08-01", to, MON_THU))).toBeNull();
  });

  it("lets an ordinary week through", () => {
    const d = leaveDays("2026-08-03", "2026-08-06", MON_THU);
    expect(d.workingDays).toBe(4);
    expect(leaveRangeProblem("2026-08-03", "2026-08-06", d)).toBeNull();
  });

  it("asks for the missing field before anything else", () => {
    expect(leaveRangeProblem("", "2026-08-06", null)).toMatch(/first and last day/i);
    expect(leaveRangeProblem("2026-08-03", "", null)).toMatch(/first and last day/i);
  });
});

describe("leaveSpellsInWindow", () => {
  /**
   * The panel this feeds read `leave_requests` while every number around it read
   * `employee_attendance`. There are 7 requests on file against 169 holiday days,
   * because nearly every day off here is marked straight onto the board — so "Who is
   * off, next two weeks" showed almost nobody above a table that knew better.
   */
  const days = [
    { employee_id: "ana", on_date: "2026-08-03", status: "holiday" },
    { employee_id: "ana", on_date: "2026-08-04", status: "holiday" },
    { employee_id: "ana", on_date: "2026-08-05", status: "holiday" },
    // A gap, so this is a second stretch rather than one long one.
    { employee_id: "ana", on_date: "2026-08-10", status: "holiday" },
    { employee_id: "bruno", on_date: "2026-08-04", status: "sick" },
  ];

  it("joins consecutive days into one stretch", () => {
    const out = leaveSpellsInWindow(days, "2026-08-01", "2026-08-14");
    const ana = out.filter((s) => s.employee_id === "ana");
    expect(ana).toEqual([
      { employee_id: "ana", kind: "holiday", start_date: "2026-08-03", end_date: "2026-08-05" },
      { employee_id: "ana", kind: "holiday", start_date: "2026-08-10", end_date: "2026-08-10" },
    ]);
  });

  /**
   * On CALENDAR days, not working days. Somebody off Thursday and the following Monday
   * is two stretches to anybody reading the panel, whatever their rota says about the
   * Friday — the panel is read as "when is this person away", not as a count.
   */
  it("treats a weekend between two days as a break in the stretch", () => {
    const out = leaveSpellsInWindow([
      { employee_id: "ana", on_date: "2026-08-06", status: "holiday" },
      { employee_id: "ana", on_date: "2026-08-10", status: "holiday" },
    ], "2026-08-01", "2026-08-14");
    expect(out).toHaveLength(2);
  });

  it("keeps a change of kind apart", () => {
    // "Sick, then holiday" is two facts about somebody, not one five-day absence.
    const out = leaveSpellsInWindow([
      { employee_id: "ana", on_date: "2026-08-03", status: "sick" },
      { employee_id: "ana", on_date: "2026-08-04", status: "holiday" },
    ], "2026-08-01", "2026-08-14");
    expect(out.map((s) => s.kind).sort()).toEqual(["holiday", "sick"]);
  });

  it("leaves out whatever falls outside the window", () => {
    expect(leaveSpellsInWindow(days, "2026-08-04", "2026-08-04")).toEqual([
      { employee_id: "ana", kind: "holiday", start_date: "2026-08-04", end_date: "2026-08-04" },
      { employee_id: "bruno", kind: "sick", start_date: "2026-08-04", end_date: "2026-08-04" },
    ]);
  });

  it("calls a day with no status by the kind it was given", () => {
    // `employee_attendance` holiday rows are selected by status and carry none.
    const out = leaveSpellsInWindow([{ employee_id: "ana", on_date: "2026-08-03" }], "2026-08-01", "2026-08-14");
    expect(out[0].kind).toBe("holiday");
  });

  it("has nothing to show for an empty fortnight", () => {
    expect(leaveSpellsInWindow([], "2026-08-01", "2026-08-14")).toEqual([]);
  });

  it("counts a day written twice once", () => {
    const out = leaveSpellsInWindow([
      { employee_id: "ana", on_date: "2026-08-03", status: "holiday" },
      { employee_id: "ana", on_date: "2026-08-03", status: "holiday" },
    ], "2026-08-01", "2026-08-14");
    expect(out).toEqual([
      { employee_id: "ana", kind: "holiday", start_date: "2026-08-03", end_date: "2026-08-03" },
    ]);
  });
});
