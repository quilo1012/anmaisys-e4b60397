import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * BLOCO 122. Two scheduler jobs carried the cron key as plain text in their command, and
 * the same key sits in migration 20260807140000, so it is in git history for good. What can
 * still be done is stop adding to it: the migration that moves the jobs to the vault must
 * not contain a key of its own, and must refuse to run against an empty vault.
 */
const root = resolve(__dirname, "../..");
const sql = readFileSync(resolve(root, "supabase/migrations/20261021250000_cron_jobs_read_the_key_from_the_vault.sql"), "utf8");

describe("the cron jobs read the key from the vault", () => {
  it("contains no key of its own", () => {
    expect(sql).not.toMatch(/'[0-9a-fA-F]{32,}'/);
  });
  it("does nothing when the vault has no CRON_SECRET, instead of sending an empty header", () => {
    expect(sql).toMatch(/The vault has no CRON_SECRET; leaving the jobs as they are/);
    expect(sql.indexOf("The vault has no CRON_SECRET")).toBeLessThan(sql.indexOf("cron.alter_job"));
  });
  it("refuses a rewrite that still carries a literal", () => {
    expect(sql).toMatch(/v_new = j\.command or v_new ~ c_old/);
  });
});
