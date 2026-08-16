import { describe, it, expect } from "vitest";
import { ragDowntimeBucket } from "./ragDowntimeBucket";

/**
 * The RAG week aggregates two things into the same cell: production sessions, which
 * arrive with the factory's own `session_date` and `shift` already on them, and
 * downtime events, which arrive as a bare timestamp and have to be filed.
 *
 * Filing them by a different rule than the sessions use is how the same cell ends up
 * holding a day's production and a night's downtime. These are the cases where the
 * hand-rolled `(getUTCHours() + 1) // BST` disagreed with the factory.
 */
describe("ragDowntimeBucket", () => {
  it("files a summer evening stop on the night that was working", () => {
    // 18:30 London (BST). The old arithmetic agreed here, which is why nobody noticed.
    expect(ragDowntimeBucket("2026-08-16T17:30:00Z")).toEqual({
      date: "2026-08-16",
      shift: "NIGHT",
    });
  });

  it("keeps a winter afternoon stop on the day shift", () => {
    // 17:30 London (GMT). The +1 made this 18:30 and moved the whole handover hour
    // onto the night crew for five months of the year.
    expect(ragDowntimeBucket("2026-11-10T17:30:00Z")).toEqual({
      date: "2026-11-10",
      shift: "DAY",
    });
  });

  it("keeps a winter early-morning stop on the night that is still running", () => {
    // 05:30 London (GMT). The +1 made this 06:30 and handed it to the day crew.
    expect(ragDowntimeBucket("2026-11-10T05:30:00Z")).toEqual({
      date: "2026-11-09",
      shift: "NIGHT",
    });
  });

  it("files a stop after midnight on the day the night started", () => {
    // The shift was never in doubt here; the date was. `format(dt, "yyyy-MM-dd")`
    // dated this the 10th, so the night of the 9th lost its downtime to the next
    // column while its production stayed put.
    expect(ragDowntimeBucket("2026-11-10T00:30:00Z")).toEqual({
      date: "2026-11-09",
      shift: "NIGHT",
    });
  });

  it("applies the same rule across the BST boundary, not a fixed offset", () => {
    // 00:30 London on the 17th, in summer. Same answer as the winter case above,
    // reached without knowing which offset is in force.
    expect(ragDowntimeBucket("2026-08-16T23:30:00Z")).toEqual({
      date: "2026-08-16",
      shift: "NIGHT",
    });
  });

  it("accepts a Date as readily as an ISO string", () => {
    expect(ragDowntimeBucket(new Date("2026-11-10T17:30:00Z"))).toEqual({
      date: "2026-11-10",
      shift: "DAY",
    });
  });
});
