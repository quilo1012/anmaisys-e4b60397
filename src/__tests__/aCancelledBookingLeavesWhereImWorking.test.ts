import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * 23/10/2026: Rosana cancelled her Monday overtime in My Overtime and "Where I'm
 * working" kept listing it. A cancellation leaves decision = 'accepted' on purpose (the
 * record of what was agreed) and writes overtime_outcomes; `my_attendance` and the
 * board writer only ever looked at the decision.
 *
 * The SQL test (supabase/tests/cancelled_overtime_leaves_where_im_working_test.sql)
 * runs the whole story against a database. This is the version that runs on every
 * commit, because each rule below is one clause long and deleting it would still pass
 * every other test.
 */
const MIGRATION = resolve(
  __dirname, "../../supabase/migrations/20261023200000_cancelled_overtime_leaves_where_im_working.sql",
);
const sql = () => readFileSync(MIGRATION, "utf8");

/** The body of one `create or replace function`, from its name to the closing `$$;`. */
function fn(name: string): string {
  const s = sql();
  const start = s.search(new RegExp(`create or replace function public\\.${name}\\(`, "i"));
  expect(start, `${name} is in the migration`).toBeGreaterThanOrEqual(0);
  const end = s.indexOf("$$;", s.indexOf("as $$", start) + 5);
  return s.slice(start, end);
}

const CANCELLED = /x?o?\.outcome in \('cancelled_in_time', 'cancelled_late'\)/;

describe("a cancelled booking leaves Where I'm working", () => {
  it("my_attendance's overtime list leaves out bookings with a cancellation outcome", () => {
    const body = fn("my_attendance");
    const overtime = body.slice(body.indexOf("'overtime', coalesce("), body.indexOf("'requests', coalesce("));
    expect(overtime).toMatch(/r\.decision = 'accepted'/);
    expect(overtime).toMatch(/not exists \(select 1 from public\.overtime_outcomes x/);
    expect(overtime).toMatch(CANCELLED);
  });

  it("still answers only for the signed-in person, and not to anon", () => {
    const body = fn("my_attendance");
    expect(body).toMatch(/v_emp := public\.my_employee_id\(\)/);
    expect(body).toMatch(/security definer set search_path = public/i);
    expect(sql()).toMatch(/revoke all on function public\.my_attendance\(date, date\) from public, anon;/);
  });

  it("the board writer refuses to put a cancelled booking back, but still removes", () => {
    const body = fn("overtime_board_apply");
    const removal = body.indexOf("if not p_accepted then");
    const guard = body.search(CANCELLED);
    const insert = body.indexOf("insert into public.daily_allocations");
    expect(removal).toBeGreaterThan(0);
    expect(guard).toBeGreaterThan(removal);
    expect(insert).toBeGreaterThan(guard);
    expect(sql()).toMatch(/revoke all on function public\.overtime_board_apply\(uuid, uuid, boolean\) from public, anon, authenticated;/);
  });

  it("a supervisor's cancellation takes the row off the board too, and undoing it puts it back", () => {
    const body = fn("record_overtime_outcome");
    expect(body).toMatch(/can_manage_overtime\(auth\.uid\(\)\)/);
    expect(body).toMatch(/overtime_board_apply\(v_req\.id, v_resp\.employee_id, false\)/);
    expect(body).toMatch(/v_before in \('cancelled_in_time', 'cancelled_late'\)[\s\S]*overtime_board_apply\(v_req\.id, v_resp\.employee_id, true\)/);
  });

  it("the repair deletes only rows an ask wrote, for cancelled bookings, before the shift starts", () => {
    const deletes = [...sql().matchAll(/delete\s+from\s+public\.daily_allocations([\s\S]*?);/gi)];
    expect(deletes.length).toBe(2); // the board writer's own removal, and the repair
    for (const d of deletes) expect(d[1]).toMatch(/overtime_request_id\s*=/i);
    const repair = deletes[1][1];
    expect(repair).toMatch(CANCELLED);
    expect(repair).toMatch(/\(q\.on_date \+ q\.starts_at\) > \(now\(\) at time zone 'Europe\/London'\)/);
    // Nothing else is deleted: the cancellation record and the audit stay.
    expect(sql()).not.toMatch(/delete\s+from\s+public\.overtime_(outcomes|responses|audit)/i);
  });
});
