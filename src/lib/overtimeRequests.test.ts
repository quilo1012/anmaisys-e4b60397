import { describe, it, expect } from "vitest";
import {
  countResponses, reliabilityTone, reliabilityLabel, attendedLabel, blockedLabel,
  sortCandidates, requestIsForEmployee, myStatusLabel, windowLabel,
  myAnswerLabel, supervisorLabel, headcountLine, audienceLine, askIsOver, askHasStarted, upcomingForMe, localDate,
  type Reliability, type OvertimeResponse, type Candidate, hoursBetween, deskCandidates, overtimeBoardFor,
  placesTaken, placesLine } from "./overtimeRequests";

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
    expect(supervisorLabel({ status: "open" }, { answer: "yes", decision: "accepted" })).toBe("Booked — your supervisor has been told");
    expect(supervisorLabel({ status: "open" }, { answer: "yes", decision: "reserve" })).toBe("Reserve");
    expect(supervisorLabel({ status: "open" }, { answer: "yes", decision: "declined" })).toBe("Not needed this time");
  });
  it("says the ask was cancelled over anything it was waiting for", () => {
    // A cancelled ask is not a decision about the person, and reading "Waiting for
    // the supervisor" on an ask that no longer exists is the worst of both.
    expect(supervisorLabel({ status: "cancelled" }, { answer: "yes", decision: null })).toBe("Ask cancelled");
  });
  it("keeps a decision already made, even once the ask is closed", () => {
    expect(supervisorLabel({ status: "closed" }, { answer: "yes", decision: "accepted" })).toBe("Booked — your supervisor has been told");
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

/**
 * A shift that has already finished is not on offer.
 *
 * Seen on a Line 1 tablet at 23:00 on 08/10: the ask for 08/10, 06:00–14:00, listed
 * as "Not answered" with both buttons live. The window had closed nine hours
 * earlier. Somebody could still have said yes to a morning that was over, and the
 * supervisor's screen would have shown them as interested.
 *
 * The filter compared `on_date >= today` and nothing else — dates, when the ask
 * carries hours. `starts_at` and `ends_at` were never read.
 *
 * A night window ends on the following day: 18:00–06:00 is not a window that ends
 * twelve hours before it starts.
 */
describe("askIsOver", () => {
  const ask = (on_date: string, starts_at: string, ends_at: string) =>
    ({ on_date, starts_at, ends_at });

  it("is not over before it starts", () => {
    expect(askIsOver(ask("2026-10-09", "06:00", "14:00"), new Date("2026-10-08T23:00:00Z"))).toBe(false);
  });

  it("is not over while it is running", () => {
    expect(askIsOver(ask("2026-10-08", "06:00", "14:00"), new Date("2026-10-08T09:00:00Z"))).toBe(false);
  });

  it("is over once the window has closed", () => {
    // The case from the tablet: 23:00, same day, a window that ended at 14:00.
    expect(askIsOver(ask("2026-10-08", "06:00", "14:00"), new Date("2026-10-08T23:00:00Z"))).toBe(true);
  });

  it("carries a night window into the next day instead of ending it before it starts", () => {
    const night = ask("2026-10-08", "18:00", "06:00");
    expect(askIsOver(night, new Date("2026-10-08T23:00:00Z"))).toBe(false);
    expect(askIsOver(night, new Date("2026-10-09T03:00:00Z"))).toBe(false);
    expect(askIsOver(night, new Date("2026-10-09T07:00:00Z"))).toBe(true);
  });

  it("reads seconds on the time, because Postgres sends them", () => {
    expect(askIsOver(ask("2026-10-08", "06:00:00", "14:00:00"), new Date("2026-10-08T23:00:00Z"))).toBe(true);
  });
});

/**
 * My Overtime lists shifts still ahead, and only those.
 *
 * It used to keep every ask the person had answered, over or not, so a phone opened
 * on Monday led with last week's mornings. Times here are built on the local clock
 * (month is 0-based) because that is the clock the screen reads.
 */
describe("askHasStarted", () => {
  it("is false a minute before the start and true from the start on", () => {
    const a = { on_date: "2026-10-08", starts_at: "06:00:00" };
    expect(askHasStarted(a, new Date(2026, 9, 8, 5, 59))).toBe(false);
    expect(askHasStarted(a, new Date(2026, 9, 8, 6, 0))).toBe(true);
  });

  it("judges a night by its evening start, not by the morning it ends", () => {
    const night = { on_date: "2026-10-08", starts_at: "18:00" };
    expect(askHasStarted(night, new Date(2026, 9, 8, 17, 0))).toBe(false);
    expect(askHasStarted(night, new Date(2026, 9, 8, 23, 0))).toBe(true);
    expect(askHasStarted(night, new Date(2026, 9, 9, 3, 0))).toBe(true);
  });
});

describe("localDate", () => {
  it("is the device's date, not UTC's", () => {
    expect(localDate(new Date(2026, 9, 8, 0, 30))).toBe("2026-10-08");
  });
});

describe("upcomingForMe", () => {
  const me = { department: "Packing", shift_group: "Day" };
  const now = new Date(2026, 9, 8, 12, 0);
  const ask = (id: string, o: Partial<{ on_date: string; starts_at: string; status: "open" | "closed" | "cancelled"; department: string | null; shift_group: string | null }> = {}) =>
    ({ id, on_date: "2026-10-09", starts_at: "06:00", status: "open" as const, department: null, shift_group: null, ...o });
  const ids = (rs: { id: string }[]) => rs.map((r) => r.id);
  const none = new Map();

  it("drops an answered ask whose shift is in the past", () => {
    const past = ask("past", { on_date: "2026-10-07" });
    expect(ids(upcomingForMe([past], me, new Map([["past", { decision: "accepted" }]]), now))).toEqual([]);
  });

  it("drops today's morning once it has begun, keeps tonight's night", () => {
    const morning = ask("morning", { on_date: "2026-10-08", starts_at: "06:00" });
    const night = ask("night", { on_date: "2026-10-08", starts_at: "18:00" });
    expect(ids(upcomingForMe([morning, night], me, none, now))).toEqual(["night"]);
  });

  it("drops a night that started yesterday, though it runs until this morning", () => {
    const night = ask("n", { on_date: "2026-10-07", starts_at: "18:00" });
    expect(ids(upcomingForMe([night], me, none, new Date(2026, 9, 8, 3, 0)))).toEqual([]);
  });

  it("never lists a cancelled ask, answered or not", () => {
    const c = ask("c", { status: "cancelled" });
    expect(ids(upcomingForMe([c], me, new Map([["c", { decision: "accepted" }]]), now))).toEqual([]);
  });

  it("lists a filled ask only when this person is on it", () => {
    const closed = ask("x", { status: "closed" });
    expect(ids(upcomingForMe([closed], me, none, now))).toEqual([]);
    expect(ids(upcomingForMe([closed], me, new Map([["x", { decision: null }]]), now))).toEqual([]);
    expect(ids(upcomingForMe([closed], me, new Map([["x", { decision: "declined" }]]), now))).toEqual([]);
    expect(ids(upcomingForMe([closed], me, new Map([["x", { decision: "accepted" }]]), now))).toEqual(["x"]);
    expect(ids(upcomingForMe([closed], me, new Map([["x", { decision: "reserve" }]]), now))).toEqual(["x"]);
  });

  it("offers an open ask only to its audience, unless the person is already on it", () => {
    const night = ask("o", { shift_group: "Night" });
    expect(ids(upcomingForMe([night], me, none, now))).toEqual([]);
    expect(ids(upcomingForMe([night], me, new Map([["o", { decision: "accepted" }]]), now))).toEqual(["o"]);
    expect(ids(upcomingForMe([ask("all")], me, none, now))).toEqual(["all"]);
  });
});

describe("hoursBetween", () => {
  it("a noite normal", () => {
    expect(hoursBetween("18:00", "06:00")).toBe("12h");
  });

  /** O engano que motivou isto: vinte horas lidas à pressa como um turno de noite. */
  it("mostra as vinte horas de 18:00–14:00", () => {
    expect(hoursBetween("18:00", "14:00")).toBe("20h");
  });

  it("o dia que não atravessa a meia-noite", () => {
    expect(hoursBetween("06:00", "14:30")).toBe("8h30");
  });

  it("a mesma hora duas vezes é um dia inteiro, não zero", () => {
    expect(hoursBetween("18:00", "18:00")).toBe("24h");
  });

  it("aguenta o campo vazio enquanto se escreve", () => {
    for (const v of ["", "1", "ab:cd"]) expect(hoursBetween(v, "06:00")).toBe("");
  });
});

describe("cross-shift overtime", () => {
  const people = [
    { id: "d", full_name: "Rosana Cardozo", department: "Production", shift_group: "Day" },
    { id: "n", full_name: "Juliano Santos", department: "Production", shift_group: "Night" },
    { id: "w", full_name: "Ana Weekend", department: "Production", shift_group: "Weekend" },
  ];

  it("puts the hours, not the crew, on a board", () => {
    expect(overtimeBoardFor("06:00")).toBe("Day");
    expect(overtimeBoardFor("17:59")).toBe("Day");
    expect(overtimeBoardFor("18:00")).toBe("Night");
    expect(overtimeBoardFor("05:30")).toBe("Night");
  });

  it("lets a supervisor add a Day person to an ask for the Night crew", () => {
    const list = deskCandidates({ department: null, shift_group: "Night" }, people, new Set());
    // Night crew first, then everybody else by name.
    expect(list.map((c) => c.employee.id)).toEqual(["n", "w", "d"]);
    expect(list.find((c) => c.employee.id === "d")).toMatchObject({ outside: true });
    expect(list.find((c) => c.employee.id === "n")).toMatchObject({ outside: false });
  });

  it("and a Night person to an ask for the Day crew", () => {
    const list = deskCandidates({ department: null, shift_group: "Day" }, people, new Set());
    expect(list[0].employee.id).toBe("d");
    expect(list.some((c) => c.employee.id === "n" && c.outside)).toBe(true);
  });

  it("never offers somebody who has already answered, so nobody is added twice", () => {
    const list = deskCandidates({ department: null, shift_group: null }, people, new Set(["d"]));
    expect(list.map((c) => c.employee.id)).not.toContain("d");
  });

  it("still keeps the ask's audience for the employee's own phone", () => {
    expect(requestIsForEmployee({ department: null, shift_group: "Night" }, people[0])).toBe(false);
  });
});

describe("upcomingForMe — the phone does not offer hours that are already the person's", () => {
  const now = new Date("2026-10-15T12:00:00");
  const a = (id: string, p: Partial<{ department: string | null; shift_group: string | null; on_date: string; starts_at: string }> = {}) => ({
    id, status: "open" as const, department: null, shift_group: null, on_date: "2026-10-17", starts_at: "06:00", ...p,
  });
  const weekendCrew = { department: "Production", shift_group: "Weekend" };
  const satDay = a("sat-day");
  const satNight = a("sat-night", { starts_at: "18:00" });
  const clashes = new Map([["sat-day", "Your rota has you on the day shift on Sat 17/10, 06:00–18:00"]]);
  const none = new Map();

  it("hides Saturday Day overtime from somebody rostered Saturday Day", () => {
    expect(upcomingForMe([satDay, satNight], weekendCrew, none, now, clashes).map((r) => r.id))
      .toEqual(["sat-night"]);
  });
  it("still offers it to somebody whose hours it does not touch", () => {
    expect(upcomingForMe([satDay], { department: "Production", shift_group: "Day" }, none, now, new Map()))
      .toEqual([satDay]);
  });
  it("keeps an ask the person already answered, so their answer does not vanish", () => {
    expect(upcomingForMe([satDay], weekendCrew, new Map([["sat-day", { decision: null }]]), now, clashes)).toEqual([satDay]);
  });
  it("keeps the department and crew narrowing", () => {
    expect(upcomingForMe([a("wh", { department: "Warehouse" })], weekendCrew, none, now, new Map())).toEqual([]);
  });
});

describe("placesTaken", () => {
  const outcomes = new Map([["sick", "called_sick"], ["came", "attended"]]);
  const of = (id: string) => outcomes.get(id);
  it("counts accepted people who are still coming, as the database does", () => {
    expect(placesTaken([
      { id: "a", decision: "accepted" },
      { id: "came", decision: "accepted" },
      { id: "sick", decision: "accepted" },
      { id: "r", decision: "reserve" },
      { id: "d", decision: "declined" },
      { id: "n", decision: null },
    ], of)).toBe(2);
  });
});

describe("placesLine", () => {
  it("says nothing when the counts are unknown", () => {
    expect(placesLine(undefined)).toBeNull();
  });
  it("says how many are left", () => {
    expect(placesLine({ taken: 1, headcount: 4 })).toBe("3 of 4 places left");
    expect(placesLine({ taken: 0, headcount: 1 })).toBe("1 of 1 place left");
  });
  it("says what a yes means once it is full, even past full", () => {
    expect(placesLine({ taken: 4, headcount: 4 })).toBe("All 4 places are filled — a yes puts you on the reserve list");
    expect(placesLine({ taken: 3, headcount: 2 })).toMatch(/^All 2 places are filled/);
    expect(placesLine({ taken: 1, headcount: 1 })).toMatch(/^All 1 place is filled/);
  });
});

describe("countResponses, places still held", () => {
  const rs = [
    { id: "a", answer: "yes" as const, decision: "accepted" as const },
    { id: "b", answer: "yes" as const, decision: "accepted" as const },
  ];
  it("counts every accept as a place when outcomes are not known", () => {
    expect(countResponses({ headcount: 2 }, rs).short).toBe(0);
  });
  it("frees the place of somebody accepted who called in sick", () => {
    const outcomes = new Map([["b", "called_sick"]]);
    const c = countResponses({ headcount: 2 }, rs, (id) => outcomes.get(id));
    expect(c.short).toBe(1);
    expect(c.accepted).toBe(2);
  });
});
