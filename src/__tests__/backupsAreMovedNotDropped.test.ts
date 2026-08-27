import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Nineteen backup tables left `public`. None of them was deleted, and that is the point.
 *
 * The audit filed them as clutter — 19 of the 138 tables in `public`, unread by any
 * file in src/, carrying nothing but an admin-only policy. All true. But clutter and
 * expendable are different words: those rows are the "before" side of corrections made
 * to attendance, overtime, allocations and employee records, including the pre-backfill
 * state of 276 line stops. If a July figure is ever questioned, they are the only place
 * the previous answer still exists.
 *
 * So they move to `archive`, which gets what the finding wanted — out of the schema, and
 * out of PostgREST's reach, which is stricter than the policies they had — and keeps the
 * door open. Deleting them is a decision with a date on it, and belongs to whoever
 * decides those corrections are settled.
 */

const MIGRATION_DIR = resolve(__dirname, "../..", "supabase/migrations");

const migration = () => {
  const file = readdirSync(MIGRATION_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .reverse()
    .find((f) => /CREATE SCHEMA IF NOT EXISTS archive/.test(readFileSync(resolve(MIGRATION_DIR, f), "utf8")));
  if (!file) throw new Error("No migration creates the archive schema");
  return readFileSync(resolve(MIGRATION_DIR, file), "utf8");
};

/** The 19, as the audit counted them. */
const BACKUPS = [
  "_line_stopped_backfill_bak", "_wo_linestop_fix_bak_20260804", "absence_rename_bak_20260805",
  "attendance_backfill_bak_20260804", "attendance_days_bak_20260804", "daily_allocations_backup_0308",
  "daily_allocations_bak_20260805", "downtime_events_dedupe_backup_20260804", "employees_backup_dedupe",
  "employees_backup_dept_spelling", "overtime_entries_backup_20260802", "sku_batch_dupes_20260729",
  "sku_products_backup", "wo802_backup_20260804", "wo803_deleted_backup_20260804",
  "wo803_events_backup_20260804", "wo804_backup_20260804", "wo_dedupe_backup_20260804",
  "wo_shiftclose_bak_20260804",
];

describe("the backup tables", () => {
  const sql = migration();

  it("are moved, never dropped", () => {
    // The single assertion this file exists for. A later edit turning the ALTER into a
    // DROP would look like finishing the job and would be unrecoverable.
    expect(sql).toMatch(/ALTER TABLE public\.%I SET SCHEMA archive/);
    expect(sql).not.toMatch(/DROP TABLE/i);
    expect(sql).not.toMatch(/TRUNCATE/i);
    expect(sql).not.toMatch(/DROP SCHEMA/i);
  });

  it("are named one by one, never matched by pattern", () => {
    // A LIKE '%backup%' sweep eventually catches a real table somebody named badly, and
    // this is exactly the kind of statement that gets copied into the next migration.
    expect(sql).not.toMatch(/relname\s+(LIKE|~)/i);
    expect(sql).not.toMatch(/information_schema\.tables/i);
    for (const t of BACKUPS) {
      expect(sql, `${t} must be listed explicitly`).toContain(`'${t}'`);
    }
  });

  it("moves all nineteen and nothing else", () => {
    const bloco = sql.slice(sql.indexOf("_tabelas constant text[]"), sql.indexOf("];", sql.indexOf("_tabelas constant")));
    const listadas = [...bloco.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
    expect(listadas.sort()).toEqual([...BACKUPS].sort());
  });

  it("puts the schema out of the API's reach", () => {
    // PostgREST serves the schemas it is configured for, and archive is not one. The
    // REVOKE says so rather than depending on it.
    expect(sql).toMatch(/REVOKE ALL ON SCHEMA archive FROM anon, authenticated/);
  });

  it("skips a table that is already gone instead of failing", () => {
    // Re-applying the package must not error on a table moved by an earlier run.
    expect(sql).toMatch(/to_regclass\('public\.' \|\| quote_ident\(_t\)\) IS NOT NULL/);
  });

  it("records that these are not expendable", () => {
    // The reasoning is the load-bearing part: without it the next reader sees nineteen
    // untouched backup tables in a schema called archive and finishes the job.
    expect(sql).toMatch(/COMMENT ON SCHEMA archive/);
    // Matched on the word alone: the sentence is split across concatenated SQL string
    // literals, so anchoring on the phrase makes the test fragile to reflowing a
    // comment — which is not what it is guarding.
    const comentario = sql.slice(sql.indexOf("COMMENT ON SCHEMA archive"));
    expect(comentario).toMatch(/descartaveis/i);
    expect(comentario).toMatch(/Apagar so quando/i);
  });
});
