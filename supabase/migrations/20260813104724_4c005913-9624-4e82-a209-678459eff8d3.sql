DO $$
DECLARE
  dup_count int;
BEGIN
  SELECT count(*) INTO dup_count
  FROM (
    SELECT work_order_id, stopped_at, resumed_at
    FROM public.downtime_events
    WHERE resumed_at IS NOT NULL
    GROUP BY work_order_id, stopped_at, resumed_at
    HAVING count(*) > 1
  ) d;

  IF dup_count > 0 THEN
    RAISE EXCEPTION 'Cannot create unique index: % duplicate closed-stoppage group(s) exist in downtime_events. Remove duplicates first.', dup_count;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS downtime_events_no_duplicate_span
  ON public.downtime_events (work_order_id, stopped_at, resumed_at)
  WHERE resumed_at IS NOT NULL;