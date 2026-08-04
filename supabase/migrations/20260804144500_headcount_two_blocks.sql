-- The board reads like the factory's own sheet: two blocks, not four.
--
-- `section` decides which block an area is drawn in and `kind` decides what the
-- totals count it as. They were the same four values on every row, so the
-- distinction existed on paper only. Now they genuinely differ: Hygiene, Quality and
-- Runner are `kind = support` and sit in the production block, because that is where
-- the sheet puts them — the people planning the day read them alongside the lines
-- they serve.
--
-- No `kind` is touched, so no total moves.

UPDATE public.headcount_areas
   SET section = CASE
     WHEN name IN ('Hygiene','Quality','Runner') THEN 'production'
     WHEN kind = 'production' THEN 'production'
     ELSE 'support'
   END;
