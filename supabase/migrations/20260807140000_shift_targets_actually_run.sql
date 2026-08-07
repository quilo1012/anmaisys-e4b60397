-- Os targets de turno nunca foram calculados porque ninguém chamava a função.
--
-- `calculate-shift-targets` works out each item's target from the SKU's rate and the
-- 660 minutes in a shift, and it has existed all along. Nothing invoked it: no cron
-- job, no client call. `production_targets` holds zero rows and only 34 of 233
-- production items carry a target, so every "output vs target" figure in the system
-- reads "no data" for the other 199.
--
-- The data to fill them is there — 1054 of 1256 SKUs carry a rate, and 177 items have
-- both a SKU and a rate, 149 of them still without a target.
--
-- Every half hour rather than once a shift: items are entered while the shift runs, so
-- a single call at the start would find an empty session. The function only fills an
-- item whose target is still zero, so repeating it is free.
SELECT cron.schedule(
  'calculate-shift-targets-30min',
  '*/30 * * * *',
  $job$
  SELECT net.http_post(
    url:='https://ybtrzqzliepknpzqdajx.supabase.co/functions/v1/calculate-shift-targets',
    headers:=jsonb_build_object(
      'Content-Type','application/json',
      'x-cron-secret','5335a3071375cd94ffbd89b2db58db32afe86a77ecef43b1f67df22fed34a984'
    ),
    body:=jsonb_build_object('source','cron-30min')
  );
  $job$
);
