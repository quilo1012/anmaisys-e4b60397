-- The cron log that has been growing since June, and the secret sitting in every row.
--
-- Sibling of 20260905090000. That one is about `net._http_response`, which is BLOATED —
-- 53 MB of heap for 0.1 MB of data. This one is a different failure with the same cause
-- upstream of it: `cron.job_run_details` has never been swept either, but its 94 MB is
-- mostly real. Measured on 26/08/2026:
--
--   rows                          152708
--   approximate real data          58 MB
--   table                          94 MB
--   older than 7 days             131679   <- 86% of it
--   older than 30 days             86819
--   autovacuum_count                   0   last_autovacuum: (null)
--   n_live_tup                         0   <- the statistics are wrong here too
--
-- pg_cron writes one row per job run and NEVER deletes any. There are two jobs firing
-- every minute (`intouch-poll-60s`, `intouch-status-log-60s`) plus eight more, which is
-- roughly 1.8 MB a day, every day, since 24/06. Nothing was ever going to stop it.
--
-- This is not a theoretical cost. `cron.job_run_details` already holds 165 rows reading
-- `job startup timeout` — pg_cron unable to open a connection — and the incident note in
-- 20260905090000 records a single-row insert here taking 99 seconds while the instance
-- was starved.
--
-- THE SECOND REASON, which is why this is not just housekeeping. Each row stores the
-- command that ran, and two of the active jobs carry their `x-cron-secret` as a literal
-- in that command rather than reading it from the vault:
--
--   rows in cron.job_run_details containing the secret in clear text:  114925
--
-- So the shared secret for `intouch-poll` and `calculate-shift-targets` is not in one
-- place that can be tidied — it is in a hundred and fifteen thousand log rows going back
-- to June. Seven-day retention removes 86% of those immediately and the rest within the
-- week.
--
-- WHAT THIS DOES NOT DO, said plainly: it does not rotate the secret, and retention is
-- not a substitute for rotating it. The value has been readable for two months and has
-- to be considered compromised. Rotation needs the edge functions' `CRON_SECRET`
-- environment variable and the job definitions changed together — one without the other
-- returns 401 every minute — and the environment variable is not reachable from a
-- migration. See docs/apply-passo-3/00-LEIA-PRIMEIRO.md for the procedure.
--
-- Nor does it reclaim the 94 MB. A plain VACUUM makes the pages reusable, which is what
-- keeps the table from growing past today's size once 86% of the rows are gone. Handing
-- the space back needs `VACUUM (FULL, ANALYZE) cron.job_run_details;` by hand, alongside
-- the one 20260905090000 already asks for.

-- =====================================================================
-- 1. Delete the backlog
--
-- Seven days is what pg_cron's own documentation suggests and what makes the failure
-- history still useful: the 165 startup timeouts worth investigating are from this week,
-- not from June. Bounded by end_time so a run still in flight is never removed.
-- =====================================================================

DO $$
DECLARE
  _apagadas bigint;
BEGIN
  IF to_regclass('cron.job_run_details') IS NULL THEN
    RAISE NOTICE 'pg_cron nao esta instalado. Nada a limpar.';
    RETURN;
  END IF;

  DELETE FROM cron.job_run_details
   WHERE end_time IS NOT NULL
     AND end_time < now() - interval '7 days';

  GET DIAGNOSTICS _apagadas = ROW_COUNT;
  RAISE NOTICE 'cron.job_run_details: % execucoes com mais de 7 dias apagadas.', _apagadas;
END $$;

-- =====================================================================
-- 2. Keep it that way
--
-- Hourly, at :47 — off the hour, and off :17 where 20260905090000 puts the pg_net
-- vacuum, so the two sweeps never contend for the same minute.
-- =====================================================================

DO $$
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'pg_cron nao esta instalado. Sem retencao.';
    RETURN;
  END IF;

  PERFORM cron.unschedule('purge-cron-history')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-cron-history');

  PERFORM cron.schedule(
    'purge-cron-history',
    '47 * * * *',
    $cmd$DELETE FROM cron.job_run_details WHERE end_time IS NOT NULL AND end_time < now() - interval '7 days'$cmd$
  );

  PERFORM cron.unschedule('vacuum-cron-history')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'vacuum-cron-history');

  PERFORM cron.schedule(
    'vacuum-cron-history',
    '52 * * * *',
    'VACUUM (ANALYZE) cron.job_run_details'
  );
END $$;

-- =====================================================================
-- 3. An autovacuum policy, for the same reason as the pg_net table
--
-- n_live_tup reads 0 on a table with 152708 rows, so a policy expressed as a percentage
-- of that number can never be reached. Absolute thresholds instead. As with the pg_net
-- table, treat this as the belt and the cron above as the trousers: the hourly VACUUM is
-- what is actually keeping the table down.
-- =====================================================================

DO $$
BEGIN
  EXECUTE $ddl$
    ALTER TABLE cron.job_run_details SET (
      autovacuum_enabled              = true,
      autovacuum_vacuum_threshold     = 1000,
      autovacuum_vacuum_scale_factor  = 0.0,
      autovacuum_analyze_threshold    = 1000,
      autovacuum_analyze_scale_factor = 0.0
    )
  $ddl$;
EXCEPTION
  WHEN undefined_table OR insufficient_privilege THEN
    RAISE NOTICE 'cron.job_run_details nao e alteravel aqui. A retencao horaria continua a ser a unica defesa.';
END $$;
