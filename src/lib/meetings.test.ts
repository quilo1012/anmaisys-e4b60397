import { describe, it, expect } from "vitest";
import {
  addMonths, answerSummary, audiences, firstMeetingAfter, gridStartMinutes, nextMeetingLabel, dayKeyOf, expandOccurrences, formProblems, layoutDay, londonInstant,
  meetingsOnDay, safeVideoLink, stepAnchor, timeOf, toneOf, viewDays, viewRange, waitingForMyAnswer, type MeetingForm,
} from "./meetings";

describe("London time", () => {
  it("turns a London wall clock into the right instant in winter and summer", () => {
    expect(londonInstant("2026-01-15", "09:00").toISOString()).toBe("2026-01-15T09:00:00.000Z");
    expect(londonInstant("2026-07-15", "09:00").toISOString()).toBe("2026-07-15T08:00:00.000Z");
  });
  it("reads an instant back as London date and time", () => {
    expect(dayKeyOf("2026-07-15T23:30:00Z")).toBe("2026-07-16");
    expect(timeOf("2026-07-15T23:30:00Z")).toBe("00:30");
  });
});

describe("recurring occurrences (same rule as meeting_occurrences in SQL)", () => {
  it("weekly keeps 09:00 London across the October clock change", () => {
    const occ = expandOccurrences("2026-10-20", "09:00", 30, "weekly", "2026-11-10");
    expect(occ).toHaveLength(4);
    expect(occ.map((o) => timeOf(o.starts_at))).toEqual(["09:00", "09:00", "09:00", "09:00"]);
    expect(occ[0].starts_at).toBe("2026-10-20T08:00:00.000Z");
    expect(occ[1].starts_at).toBe("2026-10-27T09:00:00.000Z");
    expect(occ.every((o) => new Date(o.ends_at).getTime() - new Date(o.starts_at).getTime() === 30 * 60_000)).toBe(true);
  });
  it("daily stops on the until date, inclusive", () => {
    expect(expandOccurrences("2026-11-12", "07:00", 15, "daily", "2026-11-14")).toHaveLength(3);
  });
  it("monthly on the 31st lands on the last day of short months and comes back", () => {
    const occ = expandOccurrences("2027-01-31", "10:00", 60, "monthly", "2027-05-31");
    expect(occ.map((o) => dayKeyOf(o.starts_at))).toEqual(["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30", "2027-05-31"]);
  });
  it("no recurrence is one occurrence, and the count is capped", () => {
    expect(expandOccurrences("2026-11-12", "07:00", 15, "none", null)).toHaveLength(1);
    expect(expandOccurrences("2026-01-01", "07:00", 15, "daily", "2030-01-01")).toHaveLength(366);
  });
  it("addMonths clamps to the month end", () => {
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
  });
});

describe("the form", () => {
  const ok: MeetingForm = {
    title: "Weekly sync", day: "2026-11-12", time: "09:00", durationMin: 30,
    recurrence: "none", until: "", participants: ["u1"], videoLink: "",
  };
  it("saves a complete meeting", () => expect(formProblems(ok)).toEqual([]));
  it("refuses no participants, no end after start, and a repeat without an end", () => {
    expect(formProblems({ ...ok, participants: [] })).toContain("Invite at least one person.");
    expect(formProblems({ ...ok, durationMin: 0 })).toContain("The meeting must end after it starts.");
    expect(formProblems({ ...ok, recurrence: "weekly" })).toContain("Choose when the repeats stop.");
    expect(formProblems({ ...ok, recurrence: "weekly", until: "2026-11-01" })).toContain("\"Repeat until\" is before the first meeting.");
    expect(formProblems({ ...ok, videoLink: "javascript:alert(1)" })).toHaveLength(1);
  });
});

describe("the calendar", () => {
  it("a week starts on Monday and a month shows whole weeks", () => {
    expect(viewDays("week", "2026-11-12")[0]).toBe("2026-11-09");
    const month = viewDays("month", "2026-11-12");
    expect(month[0]).toBe("2026-10-26");
    expect(month.length % 7).toBe(0);
    expect(month[month.length - 1]).toBe("2026-12-06");
  });
  it("steps by a day, a week or a month", () => {
    expect(stepAnchor("day", "2026-11-12", 1)).toBe("2026-11-13");
    expect(stepAnchor("week", "2026-11-12", -1)).toBe("2026-11-05");
    expect(stepAnchor("month", "2026-11-12", 1)).toBe("2026-12-01");
  });
  it("the query range covers the whole London days", () => {
    expect(viewRange("day", "2026-07-15")).toEqual({ from: "2026-07-14T23:00:00.000Z", to: "2026-07-15T23:00:00.000Z" });
  });
  it("puts overlapping meetings side by side and lone ones full width", () => {
    const m = (id: string, s: string, e: string) => ({ id, starts_at: `2026-11-12T${s}:00Z`, ends_at: `2026-11-12T${e}:00Z` });
    const l = layoutDay([m("a", "09:00", "10:00"), m("b", "09:30", "10:30"), m("c", "11:00", "11:30")]);
    expect(l.get("a")).toEqual({ col: 0, cols: 2 });
    expect(l.get("b")).toEqual({ col: 1, cols: 2 });
    expect(l.get("c")).toEqual({ col: 0, cols: 1 });
  });
  it("a meeting across midnight is on both days", () => {
    const x = [{ starts_at: "2026-11-12T23:30:00Z", ends_at: "2026-11-13T00:30:00Z" }];
    expect(meetingsOnDay(x, "2026-11-12")).toHaveLength(1);
    expect(meetingsOnDay(x, "2026-11-13")).toHaveLength(1);
  });
  it("colour follows my answer, and cancelled wins", () => {
    expect(toneOf({ cancelled_at: null, my_response: "accepted" })).toBe("accepted");
    expect(toneOf({ cancelled_at: null, my_response: null })).toBe("pending");
    expect(toneOf({ cancelled_at: "2026-11-01T00:00:00Z", my_response: "accepted" })).toBe("cancelled");
  });
});

describe("audiences", () => {
  it("turns departments, teams and crews into the people in them now", () => {
    const people = [
      { user_id: "1", name: "A", department: "Packing", crew: "A", job: null },
      { user_id: "2", name: "B", department: "Packing", crew: "B", job: null },
      { user_id: "3", name: "C", department: "Blending", crew: "A", job: null },
      { user_id: "4", name: "D", department: null, crew: null, job: null },
    ];
    const a = audiences(people);
    expect(a.departments.map((d) => [d.label, d.people])).toEqual([["Blending", ["3"]], ["Packing", ["1", "2"]]]);
    expect(a.teams.find((t) => t.label === "Packing · crew A")?.people).toEqual(["1"]);
    expect(a.crews.find((c) => c.label === "Crew A")?.people).toEqual(["1", "3"]);
  });
});

describe("video link", () => {
  it("opens only https", () => {
    expect(safeVideoLink("https://teams.microsoft.com/l/x")).toBe("https://teams.microsoft.com/l/x");
    expect(safeVideoLink("javascript:alert(1)")).toBeNull();
    expect(safeVideoLink("http://zoom.us")).toBeNull();
  });
});

describe("answers", () => {
  it("counts the answers for the organiser, leaving out zeros", () => {
    expect(answerSummary([{ response: "accepted" }, { response: "accepted" }, { response: "pending" }])).toBe("2 accepted · 1 not answered");
    expect(answerSummary([{ response: "declined" }])).toBe("1 declined");
    expect(answerSummary([])).toBe("");
  });

  it("waits for my answer only on meetings that are open, not over and not answered", () => {
    const base = {
      series_id: "s", title: "x", description: null, location: null, video_link: null, recurrence: "none" as const,
      recurrence_until: null, created_by: "a", starts_at: "2026-11-12T09:00:00Z", ends_at: "2026-11-12T10:00:00Z",
    };
    const now = new Date("2026-11-11T12:00:00Z");
    const list = [
      { ...base, id: "pending", cancelled_at: null, my_response: "pending" as const },
      { ...base, id: "accepted", cancelled_at: null, my_response: "accepted" as const },
      { ...base, id: "cancelled", cancelled_at: "2026-11-11T10:00:00Z", my_response: "pending" as const },
      { ...base, id: "over", cancelled_at: null, my_response: "pending" as const, ends_at: "2026-11-11T11:00:00Z" },
    ];
    expect(waitingForMyAnswer(list, now).map((m) => m.id)).toEqual(["pending"]);
  });
});

describe("the next meeting", () => {
  const at = (day: string, time: string) => londonInstant(day, time).toISOString();
  const now = londonInstant("2026-11-12", "09:50");
  const m = (sd: string, st: string, et: string) => ({ starts_at: at(sd, st), ends_at: at(sd, et) });

  it("counts down the last hour and turns urgent 15 minutes before", () => {
    expect(nextMeetingLabel(m("2026-11-12", "10:30", "11:00"), now)).toEqual({ text: "Starts in 40 min", soon: false });
    expect(nextMeetingLabel(m("2026-11-12", "10:05", "10:30"), now)).toEqual({ text: "Starts in 15 min", soon: true });
  });

  it("says it is happening until it ends, then says nothing", () => {
    expect(nextMeetingLabel(m("2026-11-12", "09:30", "10:00"), now)).toEqual({ text: "Happening now, until 10:00", soon: true });
    expect(nextMeetingLabel(m("2026-11-12", "09:00", "09:30"), now)).toBeNull();
  });

  it("names today and tomorrow, and leaves later days to the calendar", () => {
    expect(nextMeetingLabel(m("2026-11-12", "14:00", "15:00"), now)?.text).toBe("Today at 14:00");
    expect(nextMeetingLabel(m("2026-11-13", "09:00", "10:00"), now)?.text).toBe("Tomorrow at 09:00");
    expect(nextMeetingLabel(m("2026-11-14", "09:00", "10:00"), now)).toBeNull();
  });
});

describe("where the grid opens", () => {
  const at = (day: string, time: string) => londonInstant(day, time).toISOString();
  it("an hour before now when today is on screen", () => {
    expect(gridStartMinutes(["2026-11-12"], [], "2026-11-12", 9 * 60 + 50)).toBe(8 * 60 + 50);
  });
  it("half an hour before the first meeting on another day, else 07:00", () => {
    const list = [{ starts_at: at("2026-11-13", "14:00"), ends_at: at("2026-11-13", "15:00") },
                  { starts_at: at("2026-11-13", "06:00"), ends_at: at("2026-11-13", "06:30") }];
    expect(gridStartMinutes(["2026-11-13"], list, "2026-11-12", 0)).toBe(5 * 60 + 30);
    expect(gridStartMinutes(["2026-11-14"], list, "2026-11-12", 0)).toBe(7 * 60);
  });
});

describe("an empty day's hint", () => {
  const at = (day: string, time: string) => londonInstant(day, time).toISOString();
  it("finds the first meeting on a later day, skipping cancelled ones", () => {
    const list = [
      { id: "c", starts_at: at("2026-11-13", "09:00"), cancelled_at: "x" },
      { id: "b", starts_at: at("2026-11-14", "09:00"), cancelled_at: null },
      { id: "a", starts_at: at("2026-11-12", "09:00"), cancelled_at: null },
    ];
    expect(firstMeetingAfter(list, "2026-11-12")?.id).toBe("b");
    expect(firstMeetingAfter(list, "2026-11-14")).toBeNull();
  });
});
