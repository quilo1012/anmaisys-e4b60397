import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

/**
 * The schedule rule has to live where the answer is written, not only on the screen.
 *
 * `MyOvertimePage` hides an ask that lands on the person's own shift, but the screen is
 * a suggestion: one `rpc('answer_overtime')` from a console gets past a `.filter()`.
 * The SQL that proves Postgres refuses is supabase/tests/overtime_schedule_clash_test.sql;
 * nothing in CI has a database, so this pins the text the database will run.
 */

const MIGRATIONS = resolve(__dirname, "../../supabase/migrations");

/** The last definition wins — that is the one the database is running. */
function currentAnswerOvertime(): string {
  let body = "";
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(MIGRATIONS, f), "utf8");
    const at = sql.toLowerCase().lastIndexOf("replace function public.answer_overtime");
    if (at === -1) continue;
    const end = sql.indexOf("$$;", at);
    body = sql.slice(at, end === -1 ? undefined : end);
  }
  return body;
}

describe("answer_overtime and the person's own hours", () => {
  it("asks the schedule rule before a yes is written", () => {
    const body = currentAnswerOvertime();
    const check = body.indexOf("overtime_schedule_clash(v_emp, p_request_id)");
    expect(check).toBeGreaterThan(0);
    expect(check).toBeLessThan(body.indexOf("insert into public.overtime_responses"));
  });

  it("only for a yes: a no is information and is always allowed", () => {
    const body = currentAnswerOvertime();
    const yes = body.indexOf("if p_answer = 'yes' then");
    const check = body.indexOf("overtime_schedule_clash(v_emp, p_request_id)");
    expect(yes).toBeGreaterThan(0);
    expect(check).toBeGreaterThan(yes);
  });

  it("keeps the rules the earlier versions had", () => {
    const body = currentAnswerOvertime();
    for (const rule of ["v_req.department", "v_req.shift_group", "overtime_block_for", "answered_for_date"]) {
      expect(body).toContain(rule);
    }
  });
});
