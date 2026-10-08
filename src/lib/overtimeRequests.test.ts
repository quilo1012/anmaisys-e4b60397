import { describe, it, expect } from "vitest";
import {
  countResponses, reliabilityTone, reliabilityLabel, attendedLabel, blockedLabel,
  sortCandidates, requestIsForEmployee, myStatusLabel, windowLabel,
  myAnswerLabel, supervisorLabel, headcountLine, audienceLine,
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

describe("blockedLabel", () => {
  it("names the day, and says nothing once it has passed", () => {
    expect(blockedLabel(rel({ blocked_until: "2026-10-20" }), "2026-10-06")).toBe("Blocked until 20/10");
    expect(blockedLabel(rel({ blocked_until: "2026-10-06" }), "2026-10-06")).toBe("");
    expect(blockedLabel(rel({ blocked_until: null }), "2026-10-06")).toBe("");
    expect(blockedLabel(undefined)).toBe("");
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

/**
 * Two answers, two lines.
 *
 * `myStatusLabel` collapses the whole of an employee's position into one word, which
 * is right for a badge and wrong for a confirmation: "Waiting" does not say whether
 * the person said yes, and "You're in" does not say who decided it. On a phone held
 * between shifts those are the two things being asked — did my answer land, and has
 * anybody acted on it — and a single string can only answer one.
 *
 * So they are separate functions and stay separate. The employee's answer is a fact
 * about the employee; the decision is a fact about the supervisor; and the screen
 * showing them on one line was how "I confirmed" and "I was accepted" became the
 * same sentence.
 */
describe("myAnswerLabel", () => {
  it("says nothing happened when there is no answer", () => {
    expect(myAnswerLabel(undefined)).toBe("Not answered");
  });
  it("says what the person themselves said", () => {
    expect(myAnswerLabel({ answer: "yes", decision: null })).toBe("You said yes");
    expect(myAnswerLabel({ answer: "no", decision: null })).toBe("You said no");
  });
  it("does not change when the supervisor decides — that is the other line", () => {
    expect(myAnswerLabel({ answer: "yes", decision: "declined" })).toBe("You said yes");
    expect(myAnswerLabel({ answer: "yes", decision: "accepted" })).toBe("You said yes");
  });
});

describe("supervisorLabel", () => {
  it("has nothing to say before the person answers", () => {
    expect(supervisorLabel({ status: "open" }, undefined)).toBeNull();
  });
  it("says the ask is waiting while nobody has decided", () => {
    expect(supervisorLabel({ status: "open" }, { answer: "yes", decision: null }))
      .toBe("Waiting for the supervisor");
  });
  it("names each decision the supervisor can make", () => {
    expect(supervisorLabel({ status: "open" }, { answer: "yes", decision: "accepted" })).toBe("Accepted");
    expect(supervisorLabel({ status: "open" }, { answer: "yes", decision: "reserve" })).toBe("Reserve");
    expect(supervisorLabel({ status: "open" }, { answer: "yes", decision: "declined" })).toBe("Not needed this time");
  });
  it("says the ask was cancelled over anything it was waiting for", () => {
    // A cancelled ask is not a decision about the person, and reading "Waiting for
    // the supervisor" on an ask that no longer exists is the worst of both.
    expect(supervisorLabel({ status: "cancelled" }, { answer: "yes", decision: null })).toBe("Ask cancelled");
  });
  it("keeps a decision already made, even once the ask is closed", () => {
    expect(supervisorLabel({ status: "closed" }, { answer: "yes", decision: "accepted" })).toBe("Accepted");
  });
  it("does not wait on behalf of somebody who said no", () => {
    expect(supervisorLabel({ status: "open" }, { answer: "no", decision: null })).toBeNull();
  });
});

/**
 * Who the ask is for, and how many it needs — as words.
 *
 * Both screens built this the same way and it is the commonest tell there is:
 * `{headcount} needed · {shift_group} · {department} · {note}`. Four different kinds
 * of fact threaded onto middle dots, so the one that decides whether you read on —
 * how many people are needed — carries the same weight as a note somebody typed.
 *
 * Two functions rather than one, because they answer two questions and the two
 * screens need them in different places: the supervisor's card leads with who can
 * see it, the floor's card leads with how many are wanted.
 */
describe("headcountLine", () => {
  it("counts people, and counts one of them properly", () => {
    expect(headcountLine({ headcount: 4 })).toBe("4 people needed");
    expect(headcountLine({ headcount: 1 })).toBe("1 person needed");
  });
});

describe("audienceLine", () => {
  it("names the department and the crew when the ask names both", () => {
    expect(audienceLine({ department: "Production", shift_group: "Day" }))
      .toBe("Production, Day crew");
  });
  it("names whichever one the ask narrowed on", () => {
    expect(audienceLine({ department: "Production", shift_group: null })).toBe("Production");
    expect(audienceLine({ department: null, shift_group: "Night" })).toBe("Night crew");
  });
  it("says everyone when the ask named nobody, rather than leaving a gap", () => {
    // An empty line reads as missing data. "Everyone" is the actual rule: a null on
    // the ask means it was not narrowed — see `requestIsForEmployee`.
    expect(audienceLine({ department: null, shift_group: null })).toBe("Everyone");
  });
});
