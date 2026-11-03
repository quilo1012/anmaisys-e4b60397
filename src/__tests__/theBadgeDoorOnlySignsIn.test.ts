import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The badge door signs a person in. It no longer makes the account.
 *
 * `employee-signin` used to have a second mode, `register`: invite code + an active
 * badge number with no account yet + a password, and it created the auth user, gave it
 * `employee`, linked it to that employees row and handed back a session. Nothing in it
 * proved the caller was holding that badge. Since 11/10/2026 the invite code is public
 * by decision (`signup_invite_code()` answers anon, the login screen puts it in a link),
 * so the only thing standing between anyone on the internet and another person's
 * overtime, attendance and chat was knowing an unclaimed badge number — and the 404 and
 * 409 answers said which numbers were unclaimed. Audit 2026-11-02, SEC-001.
 *
 * Nobody calls that mode: PR #737 took the Employee ID option off Create account and
 * left the server half behind. Accounts for the floor come from the admin's invite and
 * the email door; the badge is for signing in once an account is linked.
 */
const SOURCE = readFileSync(
  resolve(__dirname, "../../supabase/functions/employee-signin/index.ts"),
  "utf8",
);

describe("employee-signin", () => {
  it("accepts only the sign-in mode", () => {
    const schema = SOURCE.match(/mode:\s*z\.enum\(\[([^\]]*)\]\)/);
    expect(schema, "the body schema should still name its modes").not.toBeNull();
    expect(schema![1]).not.toMatch(/register/);
  });

  it("never creates an auth user, a role or a link to an employee", () => {
    expect(SOURCE).not.toMatch(/auth\.admin\.createUser/);
    expect(SOURCE).not.toMatch(/from\("user_roles"\)\s*\.upsert/);
    expect(SOURCE).not.toMatch(/\.update\(\{\s*user_id/);
  });

  it("answers a badge with no account the same way as a wrong password", () => {
    // No 404/409 left to tell a stranger which badge numbers are still unclaimed.
    expect(SOURCE).not.toMatch(/,\s*404\)/);
    expect(SOURCE).not.toMatch(/,\s*409\)/);
  });
});
