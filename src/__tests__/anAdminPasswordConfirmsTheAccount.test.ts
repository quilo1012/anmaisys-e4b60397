import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Auth emails do not reach people from this project — no confirmation, no recovery
 * link. The way back into an account is an administrator setting the password in Manage
 * Users, and that only works if the same call confirms the address: GoTrue refuses an
 * unconfirmed email at sign-in whatever the password is.
 */
const src = readFileSync(resolve(__dirname, "../../supabase/functions/update-user/index.ts"), "utf8");

describe("update-user", () => {
  it("confirms the email in the same call that sets the password", () => {
    expect(src).toMatch(/updateUserById\(userId,\s*\{\s*password,\s*email_confirm:\s*true\s*\}\)/);
  });
});
