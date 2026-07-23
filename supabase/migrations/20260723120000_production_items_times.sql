-- Per-batch production start/finish timestamps, captured by the operator
-- (Start/Finish buttons + editable time). Enables real throughput per SKU.
ALTER TABLE public.production_items ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE public.production_items ADD COLUMN IF NOT EXISTS finished_at timestamptz;
