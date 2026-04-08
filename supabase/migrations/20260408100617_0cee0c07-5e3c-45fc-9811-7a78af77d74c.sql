
ALTER TABLE public.parts_used ADD COLUMN engineer_name text NOT NULL DEFAULT '';
ALTER TABLE public.work_orders ADD COLUMN pause_reason text NOT NULL DEFAULT '';
