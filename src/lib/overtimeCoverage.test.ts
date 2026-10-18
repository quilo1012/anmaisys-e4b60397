import { describe, it, expect } from "vitest";
import { overtimeCoverage } from "./overtimeCoverage";
import type { OvertimeRequest, OvertimeResponse } from "./overtimeRequests";

const now = new Date("2026-10-18T12:00:00");
const ask = (id: string, o: Partial<OvertimeRequest> = {}): OvertimeRequest => ({
  id, on_date: "2026-10-20", starts_at: "06:00:00", ends_at: "14:00:00", headcount: 2,
  department: null, shift_group: null, note: null, status: "open",
  created_by: "u", created_at: "", closed_at: null, ...o,
} as OvertimeRequest);
const resp = (id: string, request_id: string, o: Partial<OvertimeResponse> = {}): OvertimeResponse => ({
  id, request_id, employee_id: id, answer: "yes", decision: null,
  answered_at: "", decided_at: null, ...o,
} as OvertimeResponse);

describe("overtimeCoverage", () => {
  const requests = [
    ask("day", { headcount: 3 }),
    ask("night", { starts_at: "18:00:00", ends_at: "06:00:00", headcount: 2 }),
    ask("past", { on_date: "2026-10-17", headcount: 2 }),
    ask("gone", { status: "cancelled", headcount: 5 }),
    ask("closed", { status: "closed", headcount: 2 }),
  ];
  const responses = new Map<string, OvertimeResponse[]>([
    ["day", [resp("a", "day", { decision: "accepted" }), resp("b", "day"), resp("c", "day", { decision: "accepted" })]],
    ["night", [resp("d", "night", { decision: "accepted" }), resp("e", "night", { answer: "no" })]],
    ["past", [resp("f", "past", { decision: "accepted" }), resp("g", "past", { decision: "accepted" })]],
    ["closed", [resp("h", "closed", { decision: "accepted" })]],
  ]);
  const outcomes = new Map([["c", "called_sick"], ["f", "attended"], ["g", "attended"]]);
  const c = overtimeCoverage(requests, responses, (id) => outcomes.get(id), now);

  it("counts places wanted and filled on every ask but the cancelled ones", () => {
    expect(c.asks).toBe(4);
    expect(c.cancelled).toBe(1);
    expect(c.placesWanted).toBe(3 + 2 + 2 + 2);
    // day: a (c called in sick); night: d; past: f, g; closed: h
    expect(c.placesFilled).toBe(1 + 1 + 2 + 1);
  });
  it("leaves still-to-fill to open asks that have not started", () => {
    expect(c.stillToFill).toBe(2 + 1);
    expect(c.unfilled.map((u) => [u.request.id, u.left])).toEqual([["day", 2], ["night", 1]]);
  });
  it("counts undecided yeses on live asks, and attendance as worked", () => {
    expect(c.awaitingDecision).toBe(1);
    expect(c.worked).toBe(2);
  });
  it("splits by the board the hours land on", () => {
    expect(c.byShift.Night).toEqual({ wanted: 2, filled: 1 });
    expect(c.byShift.Day).toEqual({ wanted: 7, filled: 4 });
  });
  it("never counts more filled than wanted", () => {
    const over = overtimeCoverage(
      [ask("x", { headcount: 1 })],
      new Map([["x", [resp("p", "x", { decision: "accepted" }), resp("q", "x", { decision: "accepted" })]]]),
      () => undefined, now,
    );
    expect(over.placesFilled).toBe(1);
    expect(over.stillToFill).toBe(0);
  });
});
