import { describe, it, expect } from "vitest";
import {
  isOnTheWorkingBoard,
  tallyOpenActions,
  splitOpenActionsBySession,
  type BoardAction,
} from "@/lib/openActionsInPeriod";
import { leaderNameKey } from "@/lib/leaderNameMatch";

const none = new Set<string>();

/** A row shaped like the card's query, priced by its frozen points so the tests
 *  assert this module's arithmetic and not `actionPoints`' pricing table. */
const action = (over: Partial<BoardAction> & { points_at_creation?: number }): BoardAction =>
  ({
    leader_name: "Ailton",
    status: "todo",
    severity: "low",
    labels: null,
    validation_status: null,
    points_at_creation: 1,
    ...over,
  }) as BoardAction;

describe("isOnTheWorkingBoard", () => {
  it("counts what is still to do or in progress", () => {
    expect(isOnTheWorkingBoard({ status: "todo" })).toBe(true);
    expect(isOnTheWorkingBoard({ status: "in_progress" })).toBe(true);
  });

  it("leaves out everything that has left the board", () => {
    for (const status of ["done", "rejected", "closed", null, undefined, ""]) {
      expect(isOnTheWorkingBoard({ status })).toBe(false);
    }
  });
});

describe("tallyOpenActions", () => {
  it("is empty for no rows", () => {
    expect(tallyOpenActions([], none)).toEqual({ open: 0, points: 0, critical: 0 });
  });

  it("counts, prices and flags severity in one pass", () => {
    const rows = [
      action({ points_at_creation: 2, severity: "high" }),
      action({ points_at_creation: 3, severity: "critical" }),
      action({ points_at_creation: 1, severity: "low" }),
      action({ status: "done", points_at_creation: 9, severity: "critical" }),
    ];
    expect(tallyOpenActions(rows, none)).toEqual({ open: 3, points: 6, critical: 2 });
  });
});

describe("splitOpenActionsBySession", () => {
  /**
   * The defect this module exists for.
   *
   * Ailton ran sessions and has three open actions; SANDRA ran none and has two. The
   * tile was the sum of the table's column, so it said three and the documentation
   * panel beside it counted all five — two numbers from one query, disagreeing.
   */
  it("counts every open action, not only those of leaders who worked", () => {
    const rows = [
      action({ leader_name: "Ailton", points_at_creation: 1 }),
      action({ leader_name: "Ailton", points_at_creation: 2 }),
      action({ leader_name: "Ailton", points_at_creation: 3, status: "in_progress" }),
      action({ leader_name: "SANDRA", points_at_creation: 5 }),
      action({ leader_name: "SANDRA", points_at_creation: 7 }),
    ];
    const worked = new Set([leaderNameKey("Ailton")]);

    const split = splitOpenActionsBySession(rows, worked, none);

    expect(split.all.open).toBe(5);
    expect(split.all.points).toBe(18);
    expect(split.withSession.open).toBe(3);
    expect(split.withSession.points).toBe(6);
    expect(split.withoutSession.open).toBe(2);
    expect(split.withoutSession.points).toBe(12);
    expect(split.leadersWithoutSession).toBe(1);
  });

  it("adds up: the two halves are the whole", () => {
    const rows = [
      action({ leader_name: "Ailton" }),
      action({ leader_name: "Marcio" }),
      action({ leader_name: "SANDRA" }),
      action({ leader_name: null }),
      action({ leader_name: "Ailton", status: "done" }),
    ];
    const worked = new Set([leaderNameKey("Ailton"), leaderNameKey("Marcio")]);

    const s = splitOpenActionsBySession(rows, worked, none);

    expect(s.withSession.open + s.withoutSession.open).toBe(s.all.open);
    expect(s.withSession.points + s.withoutSession.points).toBe(s.all.points);
    expect(s.all.open).toBe(4);
  });

  it("matches the leader the way the rest of the card does, capitals and all", () => {
    // The log writes SANDRA, the tablet writes Sandra. Keyed on the raw string these
    // are two people, and the one with the session would lose her own actions.
    const rows = [action({ leader_name: "SANDRA" })];
    const worked = new Set([leaderNameKey("Sandra")]);

    const s = splitOpenActionsBySession(rows, worked, none);

    expect(s.withSession.open).toBe(1);
    expect(s.withoutSession.open).toBe(0);
    expect(s.leadersWithoutSession).toBe(0);
  });

  it("puts an action with no leader in the difference without naming a leader", () => {
    const rows = [action({ leader_name: null }), action({ leader_name: "  " })];

    const s = splitOpenActionsBySession(rows, new Set(), none);

    expect(s.all.open).toBe(2);
    expect(s.withoutSession.open).toBe(2);
    expect(s.leadersWithoutSession).toBe(0);
  });

  it("has nothing to explain when every leader worked", () => {
    const rows = [action({ leader_name: "Ailton" }), action({ leader_name: "Marcio" })];
    const worked = new Set([leaderNameKey("Ailton"), leaderNameKey("Marcio")]);

    const s = splitOpenActionsBySession(rows, worked, none);

    expect(s.withoutSession).toEqual({ open: 0, points: 0, critical: 0 });
    expect(s.leadersWithoutSession).toBe(0);
  });
});
