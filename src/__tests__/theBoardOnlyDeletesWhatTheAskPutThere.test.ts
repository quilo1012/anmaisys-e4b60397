import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The bridge's dangerous half is the delete, not the insert.
 *
 * An ask being cancelled removes rows from `daily_allocations`, which is the table
 * the factory reads at six in the morning and the one a planner spends a morning
 * filling by hand. A delete that reached one row too far would take somebody's work
 * with it and leave a line short, and the board gives no sign of what used to be on
 * it — there is no undo and nothing to compare against.
 *
 * So every delete this flow performs must be filtered by `overtime_request_id`, the
 * column that exists for exactly this. A row with no id on it was not put there by an
 * ask and is not an ask's to remove. The SQL test exercises that against a database;
 * this is the version that runs on every commit, and it is here because the rule is
 * one word long and deleting that word would still pass every other test.
 */

const MIGRATION = resolve(
  __dirname, "../../supabase/migrations/20261007120000_an_accepted_ask_reaches_the_board.sql",
);
const sql = () => readFileSync(MIGRATION, "utf8");

describe("the overtime → board bridge", () => {
  it("adds the key as a nullable reference, so ordinary allocations are untouched", () => {
    const s = sql();
    expect(s).toMatch(/add column if not exists overtime_request_id uuid null/i);
    expect(s).toMatch(/references public\.overtime_requests\(id\)/i);
    // Not cascade: a day somebody worked is history and must survive its ask.
    expect(s).toMatch(/on delete set null/i);
  });

  it("filters every delete of daily_allocations by the ask that wrote the row", () => {
    const s = sql();
    const deletes = [...s.matchAll(/delete\s+from\s+public\.daily_allocations([\s\S]*?);/gi)];
    expect(deletes.length).toBeGreaterThan(0);
    for (const d of deletes) {
      expect(d[1]).toMatch(/overtime_request_id\s*=/i);
    }
  });

  it("never deletes from the board on anything but a cancellation", () => {
    // A closed ask has run its course and the people accepted worked it. Taking them
    // off afterwards would erase the shift from the record that pays for it.
    const s = sql();
    expect(s).toMatch(/new\.status\s*=\s*'cancelled'/i);
    expect(s).not.toMatch(/new\.status\s*=\s*'closed'/i);
  });

  it("fires on the decision and on the status, which are the two ways in", () => {
    const s = sql();
    expect(s).toMatch(/after insert or update of decision on public\.overtime_responses/i);
    expect(s).toMatch(/after update of status on public\.overtime_requests/i);
  });

  it("puts nobody on the board for an answer — only for a decision", () => {
    const s = sql();
    expect(s).toMatch(/decision\s*=\s*'accepted'/i);
    // `answer` belongs to the employee and says availability. If the bridge ever
    // reads it, the board stops being the list of who is in.
    expect(s).not.toMatch(/new\.answer/i);
  });

  it("hands the bridge a real boolean, because null is not false in SQL", () => {
    // Found in production review, before this ever ran. `decision` is null for every
    // answer nobody has decided on yet, and `null = 'accepted'` is null — so
    // `if not p_accepted` was neither true nor false, the guard was skipped, and
    // execution fell through to the insert. Every employee who said yes would have
    // landed on the board with no supervisor involved, and undoing a decision would
    // have created the allocation instead of removing it.
    //
    // The bare comparison reads correctly in every language with two-valued logic,
    // which is why it survived a design review and a reading. It is asserted here
    // rather than trusted.
    const s = sql();
    expect(s).toMatch(/coalesce\(new\.decision = 'accepted', false\)/);
    expect(s).not.toMatch(/overtime_board_apply\(\s*\n?\s*new\.request_id, new\.employee_id, new\.decision = 'accepted'\)/);
  });

  it("reuses the factory's own day/night line instead of writing 06 and 18 again", () => {
    const s = sql();
    expect(s).toMatch(/factory_shift_of/);
    const body = s.slice(s.indexOf("create or replace function public.overtime_board_shift"));
    // The two numbers appear in the prose above; what must not happen is a second
    // implementation of the rule inside the function that claims to reuse it.
    expect(body.slice(0, 600)).not.toMatch(/between\s+6\s+and\s+17|hour\s*>=\s*18/i);
  });

  it("writes the payroll mirror without overwriting what is already there", () => {
    const s = sql();
    expect(s).toMatch(/insert into public\.employee_attendance/i);
    const att = s.slice(s.indexOf("insert into public.employee_attendance"));
    expect(att.slice(0, 300)).toMatch(/on conflict \(employee_id, on_date\) do nothing/i);
  });

  it("refuses to put anybody on the board for an ask that was cancelled", () => {
    expect(sql()).toMatch(/v_req\.status\s*=\s*'cancelled'\s*then return/i);
  });
});
