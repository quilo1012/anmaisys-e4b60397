import { describe, it, expect } from "vitest";
import { copyableDays, rowsToCopy } from "@/lib/copyBoard";
import type { RotaCover } from "@/lib/rotaStatus";

const on: RotaCover = { known: true, coversDay: true, onThisBoard: true };
const wrongDay: RotaCover = { known: true, coversDay: false, onThisBoard: true };
const always = () => on;

describe("rowsToCopy", () => {
  it("puts the same people back in the same columns", () => {
    const out = rowsToCopy({
      source: [
        { employee_id: "ana", area_id: "line-1", status: "assigned" },
        { employee_id: "bruno", area_id: "line-2", status: "assigned" },
      ],
      onDate: "2026-08-08",
      shift: "Night",
      alreadyOnTheDay: [],
      cover: always,
    });
    expect(out).toEqual([
      { on_date: "2026-08-08", shift: "Night", employee_id: "ana", area_id: "line-1", status: "assigned" },
      { on_date: "2026-08-08", shift: "Night", employee_id: "bruno", area_id: "line-2", status: "assigned" },
    ]);
  });

  it("leaves alone anybody the day already says something about", () => {
    // 09/08 to 13/08 were booked as holiday days ahead of anybody being placed. A copy
    // that upserted over them would have paid three people for days they are away.
    const out = rowsToCopy({
      source: [
        { employee_id: "ana", area_id: "line-1", status: "assigned" },
        { employee_id: "bruno", area_id: "line-2", status: "assigned" },
      ],
      onDate: "2026-08-10",
      shift: "Day",
      alreadyOnTheDay: ["bruno"],
      cover: always,
    });
    expect(out.map((r) => r.employee_id)).toEqual(["ana"]);
  });

  it("does not carry the source day's absences forward", () => {
    // Being off sick on Friday says nothing about Saturday, and a holiday is approved
    // for a date. Only where somebody was working comes across.
    const out = rowsToCopy({
      source: [
        { employee_id: "ana", area_id: "line-1", status: "assigned" },
        { employee_id: "carla", area_id: null, status: "sick" },
        { employee_id: "diogo", area_id: null, status: "holiday" },
        { employee_id: "elsa", area_id: null, status: "unpaid" },
      ],
      onDate: "2026-08-08",
      shift: "Day",
      alreadyOnTheDay: [],
      cover: always,
    });
    expect(out.map((r) => r.employee_id)).toEqual(["ana"]);
  });

  it("leaves alone a day already booked off, whatever the board says", () => {
    // The skip list is deliberately blind to what the day says — a holiday, a sick
    // day, somebody already placed, or leave that only ever reached payroll. All of
    // them are this day having its own answer already.
    const out = rowsToCopy({
      source: [{ employee_id: "ana", area_id: "line-1", status: "assigned" }],
      onDate: "2026-08-10",
      shift: "Day",
      alreadyOnTheDay: ["ana"],
      cover: always,
    });
    expect(out).toEqual([]);
  });

  it("leaves a rota nobody has recorded as an ordinary day", () => {
    // Unknown is not off. Guessing overtime for the people whose rota nobody filled in
    // would pay them for it — the same rule the placement path follows.
    const out = rowsToCopy({
      source: [{ employee_id: "ana", area_id: "line-1", status: "assigned" }],
      onDate: "2026-08-08",
      shift: "Day",
      alreadyOnTheDay: [],
      cover: () => ({ known: false, coversDay: false, onThisBoard: true }),
    });
    expect(out[0].status).toBe("assigned");
  });

  it("asks the rota again for the new day", () => {
    // The whole point of copying Friday night onto Saturday: no night rota covers a
    // Saturday, so the same placement is a different kind of day and has to be saved
    // as one. Ten people's extra night was once recorded as an ordinary one.
    const out = rowsToCopy({
      source: [{ employee_id: "ana", area_id: "line-1", status: "assigned" }],
      onDate: "2026-08-08",
      shift: "Night",
      alreadyOnTheDay: [],
      cover: () => wrongDay,
    });
    expect(out[0].status).toBe("overtime");
  });

  it("does not carry an overtime mark onto a day the rota does cover", () => {
    // A Saturday call-in copied onto a rostered Monday is an ordinary Monday. The mark
    // belonged to that Saturday, not to the person.
    const out = rowsToCopy({
      source: [{ employee_id: "ana", area_id: "line-1", status: "overtime" }],
      onDate: "2026-08-10",
      shift: "Day",
      alreadyOnTheDay: [],
      cover: always,
    });
    expect(out[0].status).toBe("assigned");
  });

  it("copies where people stood, not what happened to their day", () => {
    // A half day and a note are records of one date. Copied forward they would say
    // somebody worked half of a day nobody has worked yet.
    // Widened deliberately: this is the shape the table hands back, and the function
    // has to drop the parts of it that belong to the day it came from.
    const asStored = { employee_id: "ana", area_id: "line-1", status: "assigned", half_day: true, note: "left for dentist" };
    const out = rowsToCopy({
      source: [asStored],
      onDate: "2026-08-08",
      shift: "Day",
      alreadyOnTheDay: [],
      cover: always,
    });
    expect(Object.keys(out[0]).sort()).toEqual(["area_id", "employee_id", "on_date", "shift", "status"]);
  });

  it("writes one row per person", () => {
    // The unique key is (day, shift, person). A source day holding two rows for one
    // person would make the upsert fail on itself rather than on the table.
    const out = rowsToCopy({
      source: [
        { employee_id: "ana", area_id: "line-1", status: "assigned" },
        { employee_id: "ana", area_id: "line-2", status: "assigned" },
      ],
      onDate: "2026-08-08",
      shift: "Day",
      alreadyOnTheDay: [],
      cover: always,
    });
    expect(out).toHaveLength(1);
    expect(out[0].area_id).toBe("line-1");
  });
});

describe("copyableDays", () => {
  const row = (on_date: string, employee_id: string) => ({ on_date, employee_id });

  it("counts the people on each day, most recent first", () => {
    const out = copyableDays(
      [row("2026-08-05", "ana"), row("2026-08-07", "ana"), row("2026-08-07", "bruno"), row("2026-08-05", "carla")],
      { maybeTruncated: false },
    );
    expect(out).toEqual([
      { on_date: "2026-08-07", people: 2 },
      { on_date: "2026-08-05", people: 2 },
    ]);
  });

  it("counts a person once, however many rows they have", () => {
    // One person can hold a row per shift. The menu is answering "how many people",
    // not "how many rows".
    const out = copyableDays([row("2026-08-07", "ana"), row("2026-08-07", "ana")], { maybeTruncated: false });
    expect(out[0].people).toBe(1);
  });

  it("drops the oldest day when the block may be cut off", () => {
    // The oldest date in a capped response is the one that can be half there. Showing
    // it would put "12 people" against a Tuesday that had seventy-five.
    const out = copyableDays(
      [row("2026-08-07", "ana"), row("2026-08-05", "bruno"), row("2026-08-04", "carla")],
      { maybeTruncated: true },
    );
    expect(out.map((d) => d.on_date)).toEqual(["2026-08-07", "2026-08-05"]);
  });

  it("keeps a single day even if the block may be cut off", () => {
    // Dropping it would leave the night board — two days old — with nothing to offer.
    const out = copyableDays([row("2026-08-07", "ana")], { maybeTruncated: true });
    expect(out).toHaveLength(1);
  });

  it("offers ten days at most", () => {
    const rows = Array.from({ length: 20 }, (_, i) => row(`2026-07-${String(i + 10).padStart(2, "0")}`, "ana"));
    expect(copyableDays(rows, { maybeTruncated: false })).toHaveLength(10);
  });

  it("is empty when nobody worked", () => {
    expect(copyableDays([], { maybeTruncated: false })).toEqual([]);
  });
});
