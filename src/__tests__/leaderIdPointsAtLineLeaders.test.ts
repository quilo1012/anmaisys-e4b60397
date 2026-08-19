import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A line leader is not a user, and `quality_actions.leader_id` was told otherwise.
 *
 * The column shipped on 24/06 as `leader_id uuid REFERENCES auth.users(id)`, copied
 * from `production_sessions` in the same migration. Line leaders have no accounts —
 * the PIN is a second factor, not a login — so no id the log form can offer has ever
 * existed in `auth.users`. Every save that named a leader failed with
 * `quality_actions_leader_id_fkey`.
 *
 * It stayed quiet for two months because nothing wrote the column: the form carried
 * `leader_name` and left the id null, and null passes a foreign key. The safety work
 * of 15–17/08 made `leader_id` load-bearing — `scorecard_safety_counts` counts
 * `WHERE leader_id = _leader_id` rather than by name — so the form began sending it,
 * and the constraint has been rejecting saves ever since.
 *
 * `production_sessions` had exactly this bug and was repointed at `line_leaders` on
 * 27/06. `quality_actions` was not included in that fix. This test is the pin that
 * stops the pair drifting apart a second time.
 *
 * WHAT THIS TEST DOES NOT DO: it does not execute SQL and there is no Postgres in
 * this run, so it cannot prove what the live database holds — only what the
 * migrations instruct. In this repo those are different things: nothing here applies
 * migrations, so a green tick means the fix is written, never that it is deployed.
 */
const MIGRATION_DIR = resolve(__dirname, "../..", "supabase/migrations");

/**
 * The LAST migration that constrains the column, not a named one — a later migration
 * may drop and re-add the key, and a test pinned to the first would go on approving a
 * definition that is no longer in force.
 */
/**
 * Comments are stripped before anything is matched, and that is not a detail.
 *
 * Migrations in this repo explain themselves at length and quote the SQL they are
 * replacing — the fix for this very bug opens by reprinting the broken
 * `REFERENCES auth.users(id)` line so the next reader knows what was wrong. Matching
 * raw file text, this test read that quotation as the live definition and stayed red
 * against a migration that had already fixed the problem. A test that cannot tell a
 * statement from a sentence about a statement reports on the prose.
 *
 * Line comments only. `/* *\/` blocks and `--` inside a string literal are not
 * handled; no migration here contains either, and inventing a SQL parser to check a
 * foreign key would be a worse trade than this sentence.
 */
const stripComments = (sql: string) => sql.replace(/--[^\n]*/g, "");

function lastStatementFor(table: string): { file: string; statement: string } {
  const add = new RegExp(
    `ADD\\s+CONSTRAINT\\s+${table}_leader_id_fkey[\\s\\S]*?;|ADD\\s+COLUMN[^,;]*leader_id[^,;]*REFERENCES[^,;]*`,
    "i",
  );
  const files = readdirSync(MIGRATION_DIR).filter((f) => f.endsWith(".sql")).sort().reverse();
  for (const file of files) {
    const sql = stripComments(readFileSync(resolve(MIGRATION_DIR, file), "utf8"));
    // Only the section that alters THIS table: one migration alters several, and a
    // naive whole-file search reads its neighbour's constraint as this one's.
    const section = sql.split(/ALTER\s+TABLE\s+/i).find((s) => new RegExp(`^public\\.${table}\\b`, "i").test(s.trim()));
    const found = (section ?? "").match(add) ?? (new RegExp(`public\\.${table}`, "i").test(sql) ? sql.match(add) : null);
    if (found) return { file, statement: found[0] };
  }
  throw new Error(`No migration constrains ${table}.leader_id`);
}

describe("leader_id names a line leader, not an account", () => {
  it("quality_actions.leader_id references line_leaders", () => {
    const { statement } = lastStatementFor("quality_actions");
    expect(statement).toMatch(/public\.line_leaders/i);
    expect(statement).not.toMatch(/auth\.users/i);
  });

  it("production_sessions.leader_id still does too — the pair must not drift", () => {
    const { statement } = lastStatementFor("production_sessions");
    expect(statement).toMatch(/public\.line_leaders/i);
    expect(statement).not.toMatch(/auth\.users/i);
  });
});
