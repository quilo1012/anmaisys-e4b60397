import { describe, expect, it } from "vitest";
import { mergeClockRowsPerDay, type ClockRow } from "@/lib/timeMotoSheet";

const row = (p: Partial<ClockRow>): ClockRow => ({
  employee_id: "ana", on_date: "2026-08-03",
  worked_minutes: 0, balance_minutes: 0, scheduled_minutes: 480, overtime_adj_minutes: 0,
  start_time: null, end_time: null, absence_name: null, remarks: null, source: "timemoto",
  ...p,
});

describe("mergeClockRowsPerDay", () => {
  /**
   * The failure this exists for.
   *
   * The sheet is matched by NAME into a `Map<name, employeeId>`, so two spellings of
   * one person — "J. Silva" and "Joao Silva" — both resolve to the same id. Two rows
   * for one `(employee_id, on_date)` then reached an upsert keyed on exactly that
   * pair, and Postgres refused the WHOLE import with "ON CONFLICT DO UPDATE command
   * cannot affect row a second time". Nobody was named in the message.
   */
  it("gives one row per person per day, however many the sheet had", () => {
    const out = mergeClockRowsPerDay([
      row({ worked_minutes: 240 }),
      row({ worked_minutes: 180 }),
    ]);
    expect(out).toHaveLength(1);
  });

  /**
   * Summed, because two entries for one person on one day is what a split shift looks
   * like coming out of this sheet — clocked out for an appointment and back in.
   * Keeping one and dropping the other would quietly shorten somebody's day.
   */
  it("adds the minutes rather than letting one win", () => {
    const [m] = mergeClockRowsPerDay([
      row({ worked_minutes: 240, balance_minutes: -60, overtime_adj_minutes: 15 }),
      row({ worked_minutes: 180, balance_minutes: 30, overtime_adj_minutes: 5 }),
    ]);
    expect(m.worked_minutes).toBe(420);
    expect(m.balance_minutes).toBe(-30);
    expect(m.overtime_adj_minutes).toBe(20);
  });

  /**
   * NOT summed. What the contract said the day should be is a property of the day, not
   * of how many times somebody passed the door — doubling it turns a split shift into
   * a day owed twice over, and the balance is read against it.
   */
  it("never doubles what the day was scheduled for", () => {
    const [m] = mergeClockRowsPerDay([
      row({ scheduled_minutes: 480 }),
      row({ scheduled_minutes: 480 }),
    ]);
    expect(m.scheduled_minutes).toBe(480);
  });

  it("takes the outer edges of the day", () => {
    const [m] = mergeClockRowsPerDay([
      row({ start_time: "08:00", end_time: "12:00" }),
      row({ start_time: "13:00", end_time: "17:30" }),
    ]);
    expect(m.start_time).toBe("08:00");
    expect(m.end_time).toBe("17:30");
  });

  it("keeps what the office wrote on either entry", () => {
    const [m] = mergeClockRowsPerDay([
      row({ remarks: "left for dentist", absence_name: null }),
      row({ remarks: "back 13:00", absence_name: "Medical" }),
    ]);
    expect(m.remarks).toBe("left for dentist · back 13:00");
    expect(m.absence_name).toBe("Medical");
  });

  it("does not repeat the same note twice", () => {
    const [m] = mergeClockRowsPerDay([row({ remarks: "Holiday" }), row({ remarks: "Holiday" })]);
    expect(m.remarks).toBe("Holiday");
  });

  it("leaves different people and different days alone", () => {
    const out = mergeClockRowsPerDay([
      row({ employee_id: "ana", on_date: "2026-08-03" }),
      row({ employee_id: "bruno", on_date: "2026-08-03" }),
      row({ employee_id: "ana", on_date: "2026-08-04" }),
    ]);
    expect(out).toHaveLength(3);
  });

  /**
   * Null is "the sheet said nothing", and two nothings are still nothing — not zero,
   * which on this table reads as "was here and worked no time".
   */
  it("keeps a missing figure missing rather than turning it into a zero", () => {
    const [m] = mergeClockRowsPerDay([
      row({ worked_minutes: null, balance_minutes: null }),
      row({ worked_minutes: null, balance_minutes: null }),
    ]);
    expect(m.worked_minutes).toBeNull();
    expect(m.balance_minutes).toBeNull();
  });

  it("counts a real figure even when the other entry had none", () => {
    const [m] = mergeClockRowsPerDay([
      row({ worked_minutes: null }),
      row({ worked_minutes: 300 }),
    ]);
    expect(m.worked_minutes).toBe(300);
  });

  it("has nothing to merge in an empty import", () => {
    expect(mergeClockRowsPerDay([])).toEqual([]);
  });
});
