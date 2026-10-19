import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * 20261019100000 as text. On 19/10/2026 production answered
 * has_function_privilege('anon', 'public.my_attendance(date,date)') = true, and the
 * SQL test an_employee_sees_only_their_own failed on it. Revoking from PUBLIC is not
 * enough in this schema; the revoke has to name anon.
 */
const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");
const SQL = read("supabase/migrations/20261019100000_login_only_functions_shut_out_anon.sql");

describe("login-only functions are revoked from anon by name", () => {
  it("revokes from anon", () => {
    expect(SQL).toMatch(/revoke execute on function %s from anon/);
  });

  it.each([
    "public.my_attendance(date, date)",
    "public.login_link_candidates()",
    "public.link_login_to_employee(uuid, uuid)",
    "public.unlink_login_from_employee(uuid)",
    "public.overtime_block_for(uuid)",
    "public.record_overtime_outcome(uuid, text, text)",
  ])("covers %s", (fn) => {
    expect(SQL).toContain(`'${fn}'`);
  });

  it("leaves the login screen's own function open", () => {
    expect(SQL).not.toContain("'public.signup_invite_code()'");
  });
});
