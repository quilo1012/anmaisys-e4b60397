import { describe, it, expect } from "vitest";
import {
  countResponses, reliabilityTone, reliabilityLabel, attendedLabel,
  sortCandidates, requestIsForEmployee, myStatusLabel, windowLabel,
  type Reliability, type OvertimeResponse, type Candidate,
} from "./overtimeRequests";

const rel = (o: Partial<Reliability> = {}): Reliability => ({
  employee_id: "e", sick_this_month: 0, absent_this_month: 0,
  ot_accepted_60d: 0, ot_attended_60d: 0, ...o,
});

const resp = (o: Partial<OvertimeResponse> = {}): OvertimeResponse => ({
  id: "r", request_id: "q", employee_id: "e", answer: "yes", decision: null,
  answered_at: "2026-09-13T09:00:00Z", decided_at: null, ...o,
});

describe("countResponses", () => {
  it("counts every yes as interest, decided or not, and never goes short below zero", () => {
    const c = countResponses({ headcount: 2 }, [
      resp(), resp({ decision: "accepted" }), resp({ decision: "accepted" }),
      resp({ decision: "reserve" }), resp({ answer: "no" }),
    ]);
    expect(c).toEqual({ headcount: 2, interested: 4, accepted: 2, reserve: 1, declined: 0, short: 0 });
  });

  it("a no is not interest", () => {
    expect(countResponses({ headcount: 3 }, [resp({ answer: "no" })]).interested).toBe(0);
  });
});

describe("reliabilityTone", () => {
  it("nothing this month is green, and so is somebody the function has never seen", () => {
    expect(reliabilityTone(undefined)).toBe("good");
    expect(reliabilityTone(rel())).toBe("good");
  });

  it("one phone call is amber", () => {
    expect(reliabilityTone(rel({ sick_this_month: 1 }))).toBe("warn");
  });

  it("one no-show is red — it is not the same as one phone call", () => {
    expect(reliabilityTone(rel({ absent_this_month: 1 }))).toBe("bad");
  });

  it("two of anything is red", () => {
    expect(reliabilityTone(rel({ sick_this_month: 2 }))).toBe("bad");
  });

  it("the 60-day ratio does not move the colour", () => {
    expect(reliabilityTone(rel({ ot_accepted_60d: 8, ot_attended_60d: 1 }))).toBe("good");
  });
});

describe("labels", () => {
  it("says what it counted", () => {
    expect(reliabilityLabel(rel({ sick_this_month: 2, absent_this_month: 1 }))).toBe("2 sick · 1 absent");
    expect(reliabilityLabel(undefined)).toBe("0 absences");
    expect(attendedLabel(rel({ ot_accepted_60d: 6, ot_attended_60d: 5 }))).toBe("5/6 worked");
    expect(attendedLabel(rel())).toBe("—");
  });

  it("trims seconds off a Postgres time", () => {
    expect(windowLabel("14:00:00", "22:00:00")).toBe("14:00–22:00");
  });
});

describe("sortCandidates", () => {
  const cand = (id: string, r: Partial<Reliability>, at: string): Candidate => ({
    employee: { id, full_name: id },
    response: resp({ employee_id: id, answered_at: at }),
    reliability: rel(r),
  });

  it("best record first, then who answered first", () => {
    const out = sortCandidates([
      cand("late-clean", {}, "2026-09-13T10:00:00Z"),
      cand("no-show", { absent_this_month: 1 }, "2026-09-13T08:00:00Z"),
      cand("early-clean", {}, "2026-09-13T09:00:00Z"),
      cand("sick-once", { sick_this_month: 1 }, "2026-09-13T07:00:00Z"),
    ]);
    expect(out.map((c) => c.employee.id)).toEqual(["early-clean", "late-clean", "sick-once", "no-show"]);
  });

  it("within the same colour, a better worked ratio wins", () => {
    const out = sortCandidates([
      cand("3-of-8", { ot_accepted_60d: 8, ot_attended_60d: 3 }, "2026-09-13T08:00:00Z"),
      cand("6-of-6", { ot_accepted_60d: 6, ot_attended_60d: 6 }, "2026-09-13T09:00:00Z"),
    ]);
    expect(out[0].employee.id).toBe("6-of-6");
  });

  it("does not mutate its input", () => {
    const input = [cand("b", { absent_this_month: 1 }, "x"), cand("a", {}, "y")];
    sortCandidates(input);
    expect(input[0].employee.id).toBe("b");
  });
});

describe("requestIsForEmployee", () => {
  it("null on the ask means everyone", () => {
    expect(requestIsForEmployee({ department: null, shift_group: null }, { department: null, shift_group: null })).toBe(true);
  });

  it("a department narrows, and nobody without one is quietly included", () => {
    const ask = { department: "Packing", shift_group: null };
    expect(requestIsForEmployee(ask, { department: "Packing", shift_group: "A" })).toBe(true);
    expect(requestIsForEmployee(ask, { department: "Blending", shift_group: "A" })).toBe(false);
    expect(requestIsForEmployee(ask, { department: null, shift_group: "A" })).toBe(false);
  });

  it("a shift group narrows further", () => {
    const ask = { department: "Packing", shift_group: "Nights" };
    expect(requestIsForEmployee(ask, { department: "Packing", shift_group: "Days" })).toBe(false);
  });
});

describe("myStatusLabel", () => {
  it("tells the person where they stand without them asking", () => {
    expect(myStatusLabel({ status: "open" }, undefined)).toBe("Not answered");
    expect(myStatusLabel({ status: "open" }, resp())).toBe("Waiting");
    expect(myStatusLabel({ status: "open" }, resp({ decision: "accepted" }))).toBe("You're in");
    expect(myStatusLabel({ status: "open" }, resp({ decision: "reserve" }))).toBe("Reserve");
    expect(myStatusLabel({ status: "closed" }, resp())).toBe("Filled");
    expect(myStatusLabel({ status: "closed" }, resp({ answer: "no" }))).toBe("You said no");
  });
});
