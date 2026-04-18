-- 1. Remove obsolete received/arrived log rows (no longer part of split flow)
DELETE FROM public.work_order_logs WHERE action IN ('received','arrived');

-- 2. Deduplicate existing rows: keep only the earliest (work_order_id, engineer_id, action)
DELETE FROM public.work_order_logs a
USING public.work_order_logs b
WHERE a.id <> b.id
  AND a.work_order_id = b.work_order_id
  AND a.engineer_id   = b.engineer_id
  AND a.action        = b.action
  AND a.created_at > b.created_at;

-- 3. Add a partial unique index to prevent future duplicates of key actions
CREATE UNIQUE INDEX IF NOT EXISTS idx_work_order_logs_unique_action
  ON public.work_order_logs (work_order_id, engineer_id, action)
  WHERE action IN ('accept','start','finish','machine_back_to_work','started','finished');