-- A stoppage cannot outlive the shift it happened in.
--
-- production_downtimes rows are opened when iTouching reports a machine down and
-- closed when it reports it healthy again. When the poll stops running — a quota
-- pause, a deactivated cron, an outage — nothing closes them, and the next successful
-- poll closes everything at that moment. Six rows carry the identical ended_at of
-- 2026-07-28 13:10:01, which is the instant the poll came back, not the instant the
-- machines did.
--
-- The damage measured before the repair: 29 rows spanning past their own shift,
-- 233,710 minutes between them, against 10,150 once capped. One "Drill Cleaning" on
-- Line 3 read 33,596 minutes — 23 days — and "Alarm" 8,480 across eight stops of
-- roughly 17 hours each. Most of the excess was No Planned Shift, which downtime
-- calculations already exclude, but 42,542 minutes of it was not: Drill Cleaning,
-- Alarm, Breaks and Shift Change Over, all counted as real stoppage.
--
-- The rule is the same one the production log already follows: the shift is the
-- boundary. A machine still down at 18:00 starts a new stop on the night shift; it
-- does not accumulate one number across a fortnight.

CREATE OR REPLACE FUNCTION public.production_downtime_shift_end(_occurred_date date, _shift text)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT CASE UPPER(COALESCE(_shift,'DAY'))
    WHEN 'NIGHT' THEN ((_occurred_date + 1)::text || ' 06:00')::timestamp AT TIME ZONE 'Europe/London'
    ELSE (_occurred_date::text || ' 18:00')::timestamp AT TIME ZONE 'Europe/London'
  END;
$function$;

COMMENT ON FUNCTION public.production_downtime_shift_end(date, text) IS
  'End of the shift a downtime row belongs to: 18:00 for DAY, 06:00 next day for NIGHT (Europe/London).';

CREATE OR REPLACE FUNCTION public.close_stale_production_downtimes()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _n integer := 0;
BEGIN
  WITH capped AS (
    SELECT d.id, public.production_downtime_shift_end(d.occurred_date, d.shift) AS shift_end
    FROM public.production_downtimes d
    WHERE d.started_at < public.production_downtime_shift_end(d.occurred_date, d.shift)
      AND (d.ended_at IS NULL OR d.ended_at > public.production_downtime_shift_end(d.occurred_date, d.shift))
  )
  UPDATE public.production_downtimes d
  SET ended_at = c.shift_end,
      duration_minutes = GREATEST(1, ROUND(EXTRACT(EPOCH FROM (c.shift_end - d.started_at)) / 60)),
      -- Said on the record rather than silently: a capped stop is a measurement that
      -- was interrupted, and anyone reading the row deserves to know which.
      notes = COALESCE(d.notes || ' ', '') || '[Capped at the end of its shift — the stop was still open when the shift ended.]'
  FROM capped c
  WHERE d.id = c.id;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END
$function$;

REVOKE ALL ON FUNCTION public.close_stale_production_downtimes() FROM PUBLIC, anon, authenticated;

-- Hourly, so a stop is capped within an hour of its shift ending rather than growing
-- until somebody notices.
SELECT cron.unschedule('cap-stale-production-downtimes')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cap-stale-production-downtimes');

SELECT cron.schedule(
  'cap-stale-production-downtimes',
  '21 * * * *',
  $$SELECT public.close_stale_production_downtimes();$$
);
