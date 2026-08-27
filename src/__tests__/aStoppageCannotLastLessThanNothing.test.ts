import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A negative stoppage does not fail to count. It counts backwards.
 *
 * `v_wo_downtime_total` summed `duration_minutes` straight, and two rows in
 * `downtime_events` hold a `resumed_at` earlier than their `stopped_at`:
 *
 *   WO 498  13/07  stopped 11:56:09  resumed 11:46:50    -9 min
 *   WO 918  19/08  stopped 14:42:14  resumed 05:59:00  -523 min
 *
 * So Line 4's recorded downtime for 19/08 was eight and a half hours short, from one
 * row, and nothing anywhere said so — a subtraction looks exactly like a quiet day.
 *
 * Two out of 544, and not at random: both `is_recurrence`, both raised from the tablet
 * account named after the line, both `force_closed`. On WO 918 the inherited resume is
 * 52 seconds EARLIER than the order's own `created_at`, so it cannot have been entered
 * for that stoppage.
 *
 * Five different things write these fields, and the two I read closely are correct. With
 * that many writers and one impossible state, the guard has to sit where every writer
 * passes — a CHECK — rather than in whichever one is eventually found to be at fault.
 *
 * The historical rows are deliberately NOT rewritten: nobody knows how long those lines
 * were really down, and a fabricated 138 minutes in a KPI is worse than a visibly
 * impossible -523. The constraint is NOT VALID so they stay correctable through the
 * screen, and the view floors each event at zero so they stop distorting anything.
 */

const MIGRATION_DIR = resolve(__dirname, "../..", "supabase/migrations");
const DEFINES = /downtime_events_resumed_after_stopped/;

const migration = () => {
  const file = readdirSync(MIGRATION_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .reverse()
    .find((f) => DEFINES.test(readFileSync(resolve(MIGRATION_DIR, f), "utf8")));
  if (!file) throw new Error("No migration adds downtime_events_resumed_after_stopped");
  return readFileSync(resolve(MIGRATION_DIR, file), "utf8");
};

describe("a stoppage that ended before it started", () => {
  const sql = migration();

  it("is refused on write, in both directions", () => {
    expect(sql).toMatch(/CHECK \(resumed_at IS NULL OR resumed_at >= stopped_at\)/);
    expect(sql).toMatch(/CHECK \(duration_minutes IS NULL OR duration_minutes >= 0\)/);
  });

  it("lets an open stoppage through — resumed_at is null until the line comes back", () => {
    // The commonest state in the table. A constraint that forbade it would refuse every
    // line stop at the moment it is raised.
    const constraint = sql.slice(sql.indexOf("downtime_events_resumed_after_stopped"));
    expect(constraint).toMatch(/resumed_at IS NULL OR/);
  });

  it("does not revalidate the two historical rows", () => {
    // NOT VALID is what keeps this appliable AND keeps WO 498 and 918 updatable through
    // the corrections screen. Without it the migration fails outright.
    const bloco = sql.slice(sql.indexOf("ADD CONSTRAINT downtime_events_resumed_after_stopped"));
    expect(bloco.slice(0, 200)).toMatch(/NOT VALID/);
  });

  it("floors each event at zero, not the total", () => {
    // GREATEST inside the sum. Flooring the sum instead would let a bad row cancel a
    // good one within the same order and still report a plausible number.
    const vista = sql.slice(sql.indexOf("CREATE OR REPLACE VIEW"));
    expect(vista).toMatch(/sum\(\s*GREATEST\(/);
    expect(vista).not.toMatch(/GREATEST\(\s*COALESCE\(sum/);
  });

  it("keeps the planned-work exemption and the open-stoppage clock", () => {
    // The view is replaced wholesale, so the parts that were already right have to come
    // across intact or this fix silently drops two other behaviours.
    const vista = sql.slice(sql.indexOf("CREATE OR REPLACE VIEW"));
    expect(vista).toMatch(/WHEN COALESCE\(p\.planned, false\) THEN 0/);
    expect(vista).toMatch(/EXTRACT\(epoch FROM now\(\) - de\.stopped_at\)/);
    expect(vista).toMatch(/bool_or\(de\.resumed_at IS NULL\) AS has_open_stop/);
  });

  it("says how to finish the job once the two rows are corrected", () => {
    expect(sql).toMatch(/VALIDATE CONSTRAINT downtime_events_resumed_after_stopped/);
  });
});
