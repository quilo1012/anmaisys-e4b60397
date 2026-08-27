import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Five people lead shifts and cannot open their own scorecard, and no screen said so.
 *
 * `line_leaders` is the factory's record of who led what — it is the target of
 * production_sessions.leader_id. `leader_pins` holds the PIN, and
 * `leader_self_scorecard()` identifies a leader BY the PIN. Six line_leaders have no PIN
 * row, and five of them have led real sessions:
 *
 *   Webister 3, Fabricio 3, Josiel 1, Marcella 1, Alice 1, Junior 0
 *
 * Manage Users lists `leader_pins`, so somebody with no PIN is not MISSING from the
 * list — they were never on it. Nothing was broken and nothing errored; the only way to
 * find this was to compare two tables by hand, which is how the audit found it.
 *
 * So the screen now asks the other question too. This test holds three things it would
 * be easy to lose: that the question is asked at all, that a database without the
 * migration degrades quietly instead of shouting, and — the one that matters — that no
 * PIN is ever generated here.
 */

const SRC = resolve(__dirname, "..");
const MIGRATION_DIR = resolve(SRC, "..", "supabase/migrations");
const MANAGE = readFileSync(resolve(SRC, "pages/users/ManageUsers.tsx"), "utf8");

const migration = () => {
  const file = readdirSync(MIGRATION_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .reverse()
    .find((f) => /leaders_without_pin/.test(readFileSync(resolve(MIGRATION_DIR, f), "utf8")));
  if (!file) throw new Error("No migration defines leaders_without_pin");
  return readFileSync(resolve(MIGRATION_DIR, file), "utf8");
};

describe("a leader with no PIN", () => {
  const sql = migration();

  it("invents no PIN, here or in the migration", () => {
    // The assertion this file exists for. A PIN is a secret its owner has to know;
    // generating five and writing them into a migration in a public repository would be
    // worse than the problem it solves. The screen shows who needs one — a person gives
    // it to them.
    expect(sql).not.toMatch(/INSERT INTO public\.leader_pins/i);
    expect(sql).not.toMatch(/pin_hash\s*=/i);
    expect(sql).not.toMatch(/crypt\s*\(/i);
    expect(sql).not.toMatch(/gen_random_uuid\(\)::text/i);
  });

  it("is listed on the screen that can give them one", () => {
    expect(MANAGE).toMatch(/leaders_without_pin/);
    expect(MANAGE).toMatch(/without a PIN/);
  });

  it("is counted by sessions led, so the list starts with whoever leads now", () => {
    // Junior has never led a session and Alice led last week. Alphabetical order would
    // have put Alice fifth. The ordering is the difference between a list and a queue.
    expect(sql).toMatch(/ORDER BY 5 DESC/);
  });

  it("does not put an error over the leader list when the migration is absent", () => {
    // The panel is a courtesy. On a database that has not had this applied, the RPC 404s,
    // and a toast there would be shouting about the absence of a nicety.
    // Delimited by the function's own body. Slicing to the next declaration is what a
    // "not.toMatch" should never rely on: if the end marker misses, indexOf returns -1,
    // slice happily reads to the end of the file, and the assertion fails on unrelated
    // code — which is what it did first time round.
    const inicio = MANAGE.indexOf("const fetchLeadersWithoutPin");
    expect(inicio).toBeGreaterThan(-1);
    const fim = MANAGE.indexOf("\n  };", inicio);
    expect(fim).toBeGreaterThan(inicio);
    const bloco = MANAGE.slice(inicio, fim);
    expect(bloco).toMatch(/console\.warn/);
    // The CALL, not the word: the code's own comment says "Not a toast", and matching
    // on the bare word failed on that. Second time I have written a test that reads
    // source and had it trip over prose — worth the extra six characters.
    expect(bloco).not.toMatch(/toast\s*[.(]/);
    expect(bloco).toMatch(/setSemPin\(\[\]\)/);
  });

  it("is refreshed after anything that could give somebody a PIN", () => {
    // Creating a leader is exactly what makes a name leave this list. A panel that does
    // not refresh would go on naming somebody who was just dealt with.
    const chamadas = MANAGE.match(/fetchLeadersWithoutPin\(\)/g) ?? [];
    expect(chamadas.length).toBeGreaterThanOrEqual(4);
  });

  it("joins the two leader tables by a key from now on", () => {
    // The other half: leader_pins and line_leaders held the same people with nothing
    // connecting them but matching names, which is what produced 20260906090000.
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS line_leader_id uuid REFERENCES public\.line_leaders\(id\)/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS leader_pins_line_leader_id_key/);
    // Backfilled by name because a name is all there was; not guessed at when it fails.
    expect(sql).toMatch(/WHERE p\.line_leader_id IS NULL/);
  });
});
