-- Add ack column on work_orders
ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS engineer_notified_acknowledged_at timestamptz;

-- RPC: engineer (or admin) acknowledges the critical alert for a WO
CREATE OR REPLACE FUNCTION public.acknowledge_wo_alert(_wo_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE public.work_orders
     SET engineer_notified_acknowledged_at = COALESCE(engineer_notified_acknowledged_at, now())
   WHERE id = _wo_id
     AND (
       engineer_id IS NULL
       OR engineer_id = _uid
       OR locked_engineer_id = _uid
       OR public.has_role(_uid, 'admin'::app_role)
       OR public.has_role(_uid, 'engineer'::app_role)
     );
END $$;

GRANT EXECUTE ON FUNCTION public.acknowledge_wo_alert(uuid) TO authenticated;

-- Backfill: any WO already past 'open' is implicitly acknowledged so alerts
-- don't replay on reconnect/refresh.
UPDATE public.work_orders
   SET engineer_notified_acknowledged_at = COALESCE(received_at, finished_at, closed_at, now())
 WHERE engineer_notified_acknowledged_at IS NULL
   AND status <> 'open';