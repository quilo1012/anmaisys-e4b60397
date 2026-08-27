import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The hourly VACUUM on `net._http_response` is not belt-and-braces. It is the belt.
 *
 * On 26/08/2026 that table held 372 rows in 18585 pages — 52 MB of heap for 0.1 MB of
 * data — and every screen in the app timed out at once while the sweep walked it. The
 * migration that closes it does two things, and only one of them can actually fire.
 *
 * Measured twice, twelve minutes apart, against the live database:
 *
 *   rows 372 → 372 (steady, newest response 53s old — the sweep IS running)
 *   n_tup_ins 8 → 8, n_tup_del 0 → 0, n_dead_tup 0 → 0 (frozen)
 *
 * pg_net inserts and deletes every minute and the statistics collector records none of
 * it. Autovacuum triggers on `n_dead_tup > threshold + scale_factor * n_live_tup`, so a
 * left-hand side that is permanently zero never fires — not at a threshold of 100, not
 * at 1. ANALYZE does not rescue it either: ANALYZE recounts live rows, and nothing ever
 * recounts dead ones.
 *
 * So the storage parameters in that migration are inert, and the cron is the whole fix.
 * This test exists because the parameters LOOK like the fix — a future reader tidying up
 * "a redundant hourly VACUUM on a table that already has an autovacuum policy" would
 * restore the outage in the time it takes autovacuum to not run.
 *
 * If this fails, do not delete the test. Put the schedule back.
 */

const MIGRATION_DIR = resolve(__dirname, "../..", "supabase/migrations");
const TARGET = /net\._http_response/;

/** The migrations that touch the table at all — found by content, not by a pinned name. */
function migrationsTouchingTheSweep(): string[] {
  return readdirSync(MIGRATION_DIR)
    .filter((f) => f.endsWith(".sql"))
    .filter((f) => TARGET.test(readFileSync(resolve(MIGRATION_DIR, f), "utf8")));
}

describe("the pg_net response sweep", () => {
  const files = migrationsTouchingTheSweep();
  const sql = files.map((f) => readFileSync(resolve(MIGRATION_DIR, f), "utf8")).join("\n");

  it("is addressed by at least one migration", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("schedules a recurring VACUUM through pg_cron", () => {
    // The scheduling call, with the table as its command. Whitespace-tolerant so
    // reformatting the migration does not fail the test.
    expect(sql).toMatch(/cron\.schedule\(/);
    expect(sql).toMatch(/VACUUM\s*\(\s*ANALYZE\s*\)\s*net\._http_response/i);
  });

  it("names the job so re-applying cannot leave two of them", () => {
    expect(sql).toMatch(/'vacuum-pg-net-responses'/);
    expect(sql).toMatch(/cron\.unschedule\(\s*'vacuum-pg-net-responses'\s*\)/);
  });

  it("schedules it hourly, not daily — the heap is walked every minute", () => {
    // '<minute> * * * *' — any minute of every hour. A daily schedule would let a day's
    // worth of unreclaimed pages accumulate, which is the shape of the original outage.
    expect(sql).toMatch(/'\d{1,2} \* \* \* \*'/);
  });

  it("does not schedule VACUUM FULL, which would take an exclusive lock every hour", () => {
    expect(sql).not.toMatch(/cron\.schedule\([^)]*VACUUM\s*\(?\s*FULL/i);
  });

  it("records why the autovacuum policy alone cannot fire", () => {
    // The reasoning is the load-bearing part. Without it the next reader sees storage
    // parameters plus a cron and reasonably concludes one of them is redundant.
    expect(sql).toMatch(/n_dead_tup/);
  });
});
