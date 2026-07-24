-- Operators log a batch code alongside the assembly number (blender_ref). Quality
-- actions match/pull the SKU by this batch code (falling back to blender_ref for
-- rows logged before this column existed).
ALTER TABLE public.production_items ADD COLUMN IF NOT EXISTS batch_code text;
