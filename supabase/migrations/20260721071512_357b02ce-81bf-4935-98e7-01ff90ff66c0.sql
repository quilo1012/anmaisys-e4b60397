ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS wo_type text NOT NULL DEFAULT 'production',
  ADD COLUMN IF NOT EXISTS warehouse_location text;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'work_orders_wo_type_check'
  ) THEN
    ALTER TABLE public.work_orders
      ADD CONSTRAINT work_orders_wo_type_check
      CHECK (wo_type IN ('production','warehouse_service'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_work_orders_wo_type ON public.work_orders(wo_type);