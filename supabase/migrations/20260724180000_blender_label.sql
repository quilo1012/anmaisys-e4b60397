-- Operators run combined blenders ("7/8"), which a smallint can't hold. Keep
-- blender_number (first number, used for numeric reporting) and add the raw label,
-- which is what now identifies an entry within a production item.
ALTER TABLE public.production_blender_entries ADD COLUMN IF NOT EXISTS blender_label text;
UPDATE public.production_blender_entries SET blender_label = blender_number::text WHERE blender_label IS NULL;
