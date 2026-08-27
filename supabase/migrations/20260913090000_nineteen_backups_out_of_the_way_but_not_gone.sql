-- Nineteen backup tables, moved out of `public` rather than dropped.
--
-- They accumulated between 29/07 and 05/08 from dedupe and backfill work, and none of
-- them is read by anything: no file in src/ names one, no view depends on one, and the
-- only policy each carries is "admin only". They are not a leak. They are 19 of the 138
-- tables in `public`, which is how a schema stops being readable at a glance.
--
--   _line_stopped_backfill_bak                276 rows
--   sku_products_backup                      1549
--   daily_allocations_bak_20260805           1028
--   attendance_days_bak_20260804              690
--   sku_batch_dupes_20260729                  324
--   overtime_entries_backup_20260802           59
--   absence_rename_bak_20260805                39
--   daily_allocations_backup_0308              35
--   attendance_backfill_bak_20260804            8
--   employees_backup_dept_spelling              5
--   _wo_linestop_fix_bak_20260804               4
--   wo_dedupe_backup_20260804                   2
--   wo_shiftclose_bak_20260804                  2
--   downtime_events_dedupe_backup_20260804      2
--   employees_backup_dedupe                     1
--   wo802/wo803_deleted/wo803_events/wo804      1 each
--
-- WHY NOT DROP, which is what the audit's own finding said to do. Because "clutter" and
-- "expendable" are not the same word. Those rows are the receipt for corrections
-- somebody made to attendance, overtime, allocations and employee records — the before
-- side of a dedupe, the pre-backfill state of 276 line stops. If a figure from July is
-- ever questioned, this is the only place the previous answer still exists. Dropping
-- them is a one-way door, and nothing here is urgent enough to justify one.
--
-- Moving them achieves what the finding actually wanted:
--   * they leave `public`, so `list_tables` and the schema diff stop showing them
--   * PostgREST exposes only the schemas it is configured for — `public` — so they
--     become unreachable through the API entirely, which is stricter than the
--     admin-only policies they have now
--   * and it reverses with one statement per table, which DROP does not
--
-- WHEN TO ACTUALLY DELETE THEM: when somebody decides the corrections they document are
-- settled. That is a decision with a date on it, not a tidy-up, and it is not this
-- migration's to take.

CREATE SCHEMA IF NOT EXISTS archive;

COMMENT ON SCHEMA archive IS
  'Tabelas de backup tiradas a mao durante correccoes de dados (dedupe, backfill), fora do '
  'public para nao poluirem o esquema nem serem alcancaveis pela API. Nada as le. Nao sao '
  'descartaveis: sao o lado "antes" de correccoes a assiduidade, horas extra, alocacoes e '
  'registos de pessoal. Apagar so quando alguem decidir que essas correccoes estao encerradas. '
  'Ver 20260913090000.';

-- The API reaches `public` and nothing else here; this makes that explicit rather than
-- relying on it. `postgres` and the service role are unaffected — they bypass this.
REVOKE ALL ON SCHEMA archive FROM anon, authenticated;

DO $$
DECLARE
  _t text;
  _movidas int := 0;
  _tabelas constant text[] := ARRAY[
    '_line_stopped_backfill_bak',
    '_wo_linestop_fix_bak_20260804',
    'absence_rename_bak_20260805',
    'attendance_backfill_bak_20260804',
    'attendance_days_bak_20260804',
    'daily_allocations_backup_0308',
    'daily_allocations_bak_20260805',
    'downtime_events_dedupe_backup_20260804',
    'employees_backup_dedupe',
    'employees_backup_dept_spelling',
    'overtime_entries_backup_20260802',
    'sku_batch_dupes_20260729',
    'sku_products_backup',
    'wo802_backup_20260804',
    'wo803_deleted_backup_20260804',
    'wo803_events_backup_20260804',
    'wo804_backup_20260804',
    'wo_dedupe_backup_20260804',
    'wo_shiftclose_bak_20260804'
  ];
BEGIN
  FOREACH _t IN ARRAY _tabelas LOOP
    -- Named one by one, never by pattern. A LIKE '%backup%' sweep would eventually
    -- catch a real table somebody named badly, and this is the kind of statement that
    -- gets copied into the next migration.
    IF to_regclass('public.' || quote_ident(_t)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I SET SCHEMA archive', _t);
      _movidas := _movidas + 1;
    END IF;
  END LOOP;

  RAISE NOTICE '% tabelas de backup movidas de public para archive.', _movidas;
END $$;
