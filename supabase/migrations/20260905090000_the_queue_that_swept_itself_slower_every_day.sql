-- The cleanup that got slower every day until it took the database with it.
--
-- On 26/08/2026, between 03:06 and 04:38 UTC (04:06–05:38 on the floor), every screen
-- in the app timed out at once: production_items, work_orders, profiles,
-- quality_options, rpc:get_user_role — tables with nothing in common. That pattern is
-- never one slow query. It is the instance itself with no I/O left.
--
-- WHAT IT WAS. `pg_net` keeps every HTTP response it has made in `net._http_response`
-- and sweeps the table on a timer, deleting anything past `pg_net.ttl` (6 hours,
-- default). Measured on 26/08:
--
--   net._http_response      372 live rows
--                        18585 pages, 52 MB heap        <- 1000x more than the rows need
--                          664 kB index, for 372 rows
--   sum(length(content))    0.1 MB                      <- the actual data
--   last_autovacuum        (null)                       <- has NEVER run
--   autovacuum_count            0
--   n_live_tup                  8                       <- the stats say 8. There are 372.
--
-- And in pg_stat_statements, the sweep itself:
--
--   WITH rows AS (SELECT ctid FROM net._http_response WHERE created < now() - $1
--                 ORDER BY created LIMIT $2) DELETE ...
--     calls 71322 · mean 323 ms · MAX 1227182 ms   <- 20.5 minutes, in one run
--
-- THE CYCLE, which is why it never recovered on its own. The sweep deletes rows every
-- minute; the dead tuples are never reported to the stats collector, so autovacuum
-- reads "8 live, 0 dead" and concludes there is nothing to do; the space is never
-- reclaimed; the heap grows; the next sweep has more pages to walk to find the same few
-- rows. Each day it is slower than the day before. At 20 minutes of random I/O it
-- starves everything else, which is when pg_cron starts reporting `job startup timeout`
-- (126 times that morning — it could not even open a connection) and a one-row
-- `insert into cron.job_run_details` takes 99 seconds.
--
-- WHAT THIS FIXES AND WHAT IT DOES NOT. This file stops the cycle from restarting: it
-- gives the table an autovacuum policy that does not depend on the broken statistics,
-- and an hourly VACUUM that keeps the pages reusable. It CANNOT reclaim the 52 MB
-- already lost — that needs `VACUUM FULL`, which takes an ACCESS EXCLUSIVE lock and
-- cannot run inside a transaction, so it cannot live in a migration. Run it once, by
-- hand, and see docs/apply-passo-3 for the note:
--
--   VACUUM (FULL, ANALYZE) net._http_response;
--
-- On 372 rows it takes well under a second. Without it, this file prevents the next
-- 52 MB but still walks today's.
--
-- WHY NOT JUST LOWER pg_net.ttl. It is a `configuration file` setting, so changing it
-- needs a restart of a managed instance, and it treats the symptom: at 6 hours the
-- table holds roughly a thousand rows, which is nothing. The table is not big. It is
-- BLOATED, and a shorter TTL deletes more often into the same unreclaimed heap.
--
-- The table is UNLOGGED (relpersistence = 'u'), holds HTTP responses nobody reads back,
-- and is emptied on any crash by design. Nothing here risks business data.

-- =====================================================================
-- 1. An autovacuum policy that does not trust the statistics
--
-- Absolute thresholds with a scale factor of zero: "after 100 changes", not "after 20%
-- of a row count we know to be wrong". The scale factor is exactly what made the
-- default policy unreachable on a table whose n_live_tup reads 8.
-- =====================================================================

DO $$
BEGIN
  EXECUTE $ddl$
    ALTER TABLE net._http_response SET (
      autovacuum_enabled                  = true,
      autovacuum_vacuum_threshold         = 100,
      autovacuum_vacuum_scale_factor      = 0.0,
      autovacuum_analyze_threshold        = 100,
      autovacuum_analyze_scale_factor     = 0.0,
      autovacuum_vacuum_cost_delay        = 0
    )
  $ddl$;
EXCEPTION
  -- A database without pg_net, or one where the extension's tables are not ours to
  -- alter, is not a reason to fail the whole package. Said out loud rather than
  -- swallowed: if this notice appears, the sweep is still unbounded.
  WHEN undefined_table OR insufficient_privilege THEN
    RAISE NOTICE 'net._http_response nao existe ou nao e alteravel aqui. A limpeza do pg_net continua sem politica.';
END $$;

-- =====================================================================
-- 2. An hourly VACUUM. THIS is the fix — section 1 cannot fire on its own.
--
-- Measured twice, twelve minutes apart, on 26/08/2026 (13:19 and 13:31 UTC):
--
--                        13:19    13:31
--   rows in the table      372      372   <- steady: it inserts and deletes every minute
--   newest response         --   13:31:00 <- 53 seconds old. pg_net is working right now
--   n_tup_ins                8        8   <- frozen
--   n_tup_del                0        0   <- frozen
--   n_dead_tup               0        0   <- frozen
--
-- The sweep is demonstrably running and the collector records none of it. So the earlier
-- reading of this — "the policy helps once the stats are right, and ANALYZE makes them
-- right" — is only half true. ANALYZE fixes n_live_tup, because it counts the rows it
-- finds. Nothing ever fixes n_dead_tup: autovacuum triggers on
-- `n_dead_tup > threshold + scale_factor * n_live_tup`, and the left-hand side is
-- permanently 0. A threshold of 100 never fires. Neither would a threshold of 1.
--
-- Section 1 is therefore a belt with no trousers: harmless, correct if the extension is
-- ever fixed upstream, and inert today. THE CRON BELOW IS THE ONLY THING KEEPING THIS
-- TABLE ALIVE. Do not remove it on the grounds that "the autovacuum policy covers it".
--
-- pg_cron runs its command OUTSIDE a transaction, which is the one place a plain VACUUM
-- can run from in this database — there is no shell here, and a VACUUM sent through the
-- SQL tooling is rejected with "VACUUM cannot run inside a transaction block".
--
-- Not VACUUM FULL: no exclusive lock on a table pg_net writes to every minute. A plain
-- VACUUM marks the pages reusable, which is all that is needed once the heap has been
-- rebuilt by hand the first time.
-- =====================================================================

DO $$
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'pg_cron nao esta instalado. Sem limpeza horaria.';
    RETURN;
  END IF;

  -- Idempotent: unschedule by name first, so re-applying the package does not leave two.
  PERFORM cron.unschedule('vacuum-pg-net-responses')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'vacuum-pg-net-responses');

  PERFORM cron.schedule(
    'vacuum-pg-net-responses',
    '17 * * * *',   -- off the hour: every other job in this database fires on :00
    'VACUUM (ANALYZE) net._http_response'
  );
END $$;

COMMENT ON EXTENSION pg_net IS
  'HTTP a partir do Postgres. net._http_response e varrida por TTL a cada minuto e a sua '
  'autovacuum nunca correu por si — ver 20260905090000. Se as chamadas comecarem a '
  'expirar em todas as tabelas ao mesmo tempo, medir pg_relation_size(''net._http_response'') '
  'antes de procurar a query lenta: em 26/08/2026 eram 18585 paginas para 372 linhas.';
