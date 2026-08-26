import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * pg_cron writes a row per run and deletes none of them, ever.
 *
 * Measured on 26/08/2026: `cron.job_run_details` held 152708 rows in 94 MB, growing at
 * roughly 1.8 MB a day since 24/06 — two jobs fire every minute — with autovacuum never
 * having run and `n_live_tup` reading 0 on all of it. 165 of those rows say
 * `job startup timeout`: pg_cron unable to open a connection while the instance was
 * starved.
 *
 * Unlike `net._http_response` this table is not mostly bloat. 58 MB of the 94 is real,
 * which is the point — it is not a table that needs vacuuming, it is a table that needs
 * a retention policy, and those are different fixes. Vacuuming an unbounded log just
 * tidies a thing that should not be there.
 *
 * The second reason it matters: each row stores the command that ran, and two active
 * jobs carry their x-cron-secret as a literal. 114925 rows held the secret in clear
 * text. Retention is what removes them.
 *
 * This pins the retention. It deliberately does NOT pin the secret rotation, which
 * cannot live in a migration — the edge functions read CRON_SECRET from Deno.env, so
 * rotating needs both sides changed together. That procedure is in
 * docs/apply-passo-3/00-LEIA-PRIMEIRO.md, and the last test here holds it to existing.
 */

const MIGRATION_DIR = resolve(__dirname, "../..", "supabase/migrations");
const DEFINES = /purge-cron-history/;

const migration = () => {
  const file = readdirSync(MIGRATION_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .reverse()
    .find((f) => DEFINES.test(readFileSync(resolve(MIGRATION_DIR, f), "utf8")));
  if (!file) throw new Error("No migration schedules purge-cron-history");
  return readFileSync(resolve(MIGRATION_DIR, file), "utf8");
};

describe("the cron run log", () => {
  const sql = migration();

  it("deletes the backlog once, and keeps deleting on a schedule", () => {
    // Both halves are needed: the one-off clears 131679 rows, the schedule stops the
    // next 131679 accumulating. Either alone leaves the table unbounded or full.
    expect(sql).toMatch(/DELETE FROM cron\.job_run_details/);
    expect(sql).toMatch(/cron\.schedule\(\s*'purge-cron-history'/);
  });

  it("bounds the delete by end_time, so a run still in flight survives it", () => {
    // end_time IS NULL means the job has not finished. Deleting on start_time would
    // remove the record of a run while it was still going.
    const deletes = [...sql.matchAll(/DELETE FROM cron\.job_run_details[\s\S]*?(?=;|\$cmd\$)/g)];
    expect(deletes.length).toBeGreaterThan(0);
    for (const [d] of deletes) {
      expect(d).toMatch(/end_time IS NOT NULL/i);
      expect(d).toMatch(/end_time\s*<\s*now\(\)\s*-\s*interval/i);
    }
  });

  it("keeps a week, which is what makes the failure history still worth reading", () => {
    expect(sql).toMatch(/interval '7 days'/);
  });

  it("does not collide with the pg_net vacuum from 20260905090000", () => {
    // That one runs at :17. Two sweeps in the same minute on an instance that has
    // already been starved once is the shape of the original incident.
    const minutos = [...sql.matchAll(/'(\d{1,2}) \* \* \* \*'/g)].map((m) => Number(m[1]));
    expect(minutos.length).toBeGreaterThan(0);
    expect(minutos).not.toContain(17);
    expect(new Set(minutos).size).toBe(minutos.length);
  });

  it("unschedules by name first, so re-applying cannot leave two", () => {
    for (const job of ["purge-cron-history", "vacuum-cron-history"]) {
      expect(sql).toMatch(new RegExp(`cron\\.unschedule\\(\\s*'${job}'\\s*\\)`));
    }
  });

  it("says out loud that retention is not rotation", () => {
    // The failure mode this guards is somebody reading "114925 rows deleted" as the
    // secret being dealt with. It was readable for two months; deleting the log does
    // not unread it.
    expect(sql).toMatch(/does not rotate the secret/i);
  });

  it("leaves the rotation procedure written down where the person applying will look", () => {
    const readme = readFileSync(
      resolve(__dirname, "../..", "docs/apply-passo-3/00-LEIA-PRIMEIRO.md"),
      "utf8",
    );
    expect(readme).toMatch(/CRON_SECRET/);
    // The two facts that make the naive fix break production: the vault is empty, and
    // the edge functions read the environment rather than the vault.
    expect(readme).toMatch(/vault.*vazio|vazio.*vault/i);
    expect(readme).toMatch(/Deno\.env/);
  });
});
