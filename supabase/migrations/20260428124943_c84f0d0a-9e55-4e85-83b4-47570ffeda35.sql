ALTER TABLE public.work_orders
  DROP CONSTRAINT IF EXISTS work_orders_locked_engineer_id_fkey;

ALTER TABLE public.work_orders
  DROP CONSTRAINT IF EXISTS work_orders_engineer_id_fkey;