-- Type is no longer mandatory when logging a quality action (labels cover
-- categorisation). Make the FK column nullable.
ALTER TABLE public.quality_actions ALTER COLUMN action_type_id DROP NOT NULL;
