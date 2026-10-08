import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

/**
 * The eligibility rule had one reader, and it was the screen.
 *
 * `requestIsForEmployee` narrows the list a person sees: an ask with a department is
 * for that department, an ask with a shift group is for that shift group. It runs in
 * `MyOvertimePage` and nowhere else.
 *
 * Under it, `overtime_requests_read` is `using (true)` — every signed-in person reads
 * every ask — and `answer_overtime` checked three things: that a login has an employee,
 * that the answer is yes or no, and that the ask is open. Not department. Not shift
 * group. So the rule was a filter on a list, not a rule: one `rpc('answer_overtime')`
 * from the console put a night-shift packer into a day-shift ask, and the supervisor's
 * screen showed them as interested with no way to tell they should not be.
 *
 * This reads the function as it will actually run. A rule that lives in a `.filter()`
 * is a suggestion.
 */

const MIGRATIONS = resolve(__dirname, "../../supabase/migrations");

/** The last definition wins — that is the one the database is running. */
function currentAnswerOvertime(): string {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  let body = "";
  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS, f), "utf8");
    // The definition, not the `grant execute on function …` that follows it.
    const at = sql.toLowerCase().lastIndexOf("replace function public.answer_overtime");
    if (at === -1) continue;
    const end = sql.indexOf("$$;", at);
    body = sql.slice(at, end === -1 ? undefined : end);
  }
  return body;
}

describe("answer_overtime", () => {
  it("is defined somewhere, or this test is measuring nothing", () => {
    expect(currentAnswerOvertime().length).toBeGreaterThan(100);
  });

  it("refuses an ask that was narrowed to another department", () => {
    const body = currentAnswerOvertime();
    expect(body).toMatch(/department/);
  });

  it("refuses an ask that was narrowed to another shift group", () => {
    const body = currentAnswerOvertime();
    expect(body).toMatch(/shift_group/);
  });

  it("checks eligibility before it writes, not after", () => {
    // An insert that happens first and is rolled back by a later raise would still be
    // correct in Postgres — but it reads as though the write is the point and the rule
    // an afterthought, and the next person to edit it moves the raise.
    const body = currentAnswerOvertime();
    const guard = Math.max(body.indexOf("department"), body.indexOf("shift_group"));
    const write = body.indexOf("insert into");
    expect(guard).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(write);
  });

  it("still keeps out a person blocked for a missed shift", () => {
    // Every definition replaces the whole function. The first draft of the eligibility
    // guard was written against the version before 20261006220000 and dropped the block
    // without a word; production would have let a no-show sign straight back up.
    const body = currentAnswerOvertime();
    expect(body).toContain("overtime_block_for(v_emp)");
    expect(body).toMatch(/if p_answer = 'yes' then\s+select \* into v_block/);
    expect(body).toContain("You can''t sign up for overtime until %.");
  });

  it("runs both rules before the write, so neither can be skipped by the other", () => {
    const body = currentAnswerOvertime();
    const write = body.indexOf("insert into");
    for (const guard of ["v_req.department", "v_req.shift_group", "overtime_block_for"]) {
      const at = body.indexOf(guard);
      expect(at, guard).toBeGreaterThan(-1);
      expect(at, guard).toBeLessThan(write);
    }
  });

  it("leaves an ask that names nobody open to everybody", () => {
    // Null on the ask is "not narrowed": each guard fires only when the ask set a value.
    const body = currentAnswerOvertime();
    expect(body).toContain("v_req.department is not null and v_req.department is distinct from v_dept");
    expect(body).toContain("v_req.shift_group is not null and v_req.shift_group is distinct from v_shift");
  });

  it("names the two columns the screen's own rule narrows on", () => {
    // Parity with `requestIsForEmployee`: same two narrowings, same direction — a null
    // on the ask means "not narrowed", and nobody is quietly included.
    const rule = readFileSync(resolve(__dirname, "../lib/overtimeRequests.ts"), "utf8");
    const fn = rule.slice(rule.indexOf("export function requestIsForEmployee"));
    const narrowings = ["department", "shift_group"].filter((c) => fn.slice(0, 400).includes(c));
    const body = currentAnswerOvertime();
    for (const c of narrowings) expect(body).toContain(c);
  });
});
