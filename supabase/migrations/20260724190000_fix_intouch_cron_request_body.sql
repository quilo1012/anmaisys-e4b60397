-- intouch-sync-production validates its body with a zod .strict() schema, which
-- rejects any key it doesn't declare. All three cron jobs were sending a
-- "trigger" field that the schema never had, so every call since the schema was
-- tightened came back 400 with an empty error object ({"error":{}}) — zod reports
-- unrecognised keys as a form error, and the handler only serialises fieldErrors.
--
-- Result: no production sync since 2026-07-19, and intouch-sync-actuals-5min
-- burning 288 failed calls a day against the iTouching rate limit.
--
-- The night job had a second problem: it sent shift "night" instead of "NIGHT".
-- Both are fixed here so the whole set is defined in one place.

SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'intouch-sync-production-day'),
  command := $job$
  SELECT net.http_post(
    url:='https://ybtrzqzliepknpzqdajx.supabase.co/functions/v1/intouch-sync-production',
    headers:=jsonb_build_object(
      'Content-Type','application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='CRON_SECRET' LIMIT 1)
    ),
    body:='{"shift":"DAY"}'::jsonb
  );
$job$);

SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'intouch-sync-production-night'),
  command := $job$
  SELECT net.http_post(
    url:='https://ybtrzqzliepknpzqdajx.supabase.co/functions/v1/intouch-sync-production',
    headers:=jsonb_build_object(
      'Content-Type','application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='CRON_SECRET' LIMIT 1)
    ),
    body:='{"shift":"NIGHT"}'::jsonb
  );
$job$);

SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'intouch-sync-actuals-5min'),
  command := $job$
  SELECT net.http_post(
    url := 'https://ybtrzqzliepknpzqdajx.supabase.co/functions/v1/intouch-sync-production',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1)
    ),
    body := jsonb_build_object(
      'auto', CASE WHEN EXTRACT(HOUR FROM (now() AT TIME ZONE 'Europe/London')) BETWEEN 6 AND 17
                   THEN 'evening' ELSE 'morning' END
    )
  );
$job$);

-- Two pollers hit the same endpoint on overlapping schedules (every minute and
-- every two minutes), which is what tripped iTouching's "100 calls per minute"
-- limit on 2026-07-04. One is enough.
SELECT cron.unschedule('intouch-poll-120s')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'intouch-poll-120s');
