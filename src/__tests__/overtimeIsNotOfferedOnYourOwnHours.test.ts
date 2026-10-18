import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The schedule rule has to live where the answer is written, not only on the screen.
 *
 * `MyOvertimePage` hides an ask that lands on the person's own shift, but the screen is
 * a suggestion: one `rpc('answer_overtime')` from a console gets past a `.filter()`.
 * The guard is a trigger on `overtime_responses` rather than a new `answer_overtime`,
 * because the catch-up paste redefines that function and the two copies would undo
 * each other. The SQL that proves Postgres refuses is
 * supabase/tests/overtime_schedule_clash_test.sql; nothing in CI has a database, so
 * this pins the text the database will run.
 */

const sql = readFileSync(resolve(__dirname,
  "../../supabase/migrations/20261018090000_overtime_is_not_offered_on_hours_already_rostered.sql"), "utf8");

const guard = () => {
  const at = sql.indexOf("function public.overtime_response_schedule_guard()");
  return sql.slice(at, sql.indexOf("$$;", at));
};

describe("a yes on the person's own hours is refused where it is written", () => {
  it("runs before the row is written, on insert and on a changed answer", () => {
    expect(sql).toMatch(/before insert or update of answer on public\.overtime_responses/);
  });

  it("asks the schedule rule, for a yes only", () => {
    const body = guard();
    const yesOnly = body.indexOf("new.answer is distinct from 'yes'");
    const check = body.indexOf("overtime_schedule_clash(new.employee_id, new.request_id)");
    expect(yesOnly).toBeGreaterThan(0);
    expect(check).toBeGreaterThan(yesOnly);
  });

  it("does not redefine answer_overtime, which the catch-up paste owns", () => {
    expect(sql.toLowerCase()).not.toMatch(/function public\.answer_overtime/);
  });
});
