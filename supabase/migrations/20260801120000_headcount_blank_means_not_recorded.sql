-- Nobody worked that shift, or nobody wrote it down?
--
-- All 231 production sessions carried staff_actual = 0 and staff_planned = 0. Not one
-- was ever set: the columns are written as 0 by the importer and by session creation,
-- and no screen has ever offered a way to change them.
--
-- Zero is a claim — "this line ran with no people on it" — and it is false on every one
-- of those rows. NULL is the honest value: nobody recorded it. It also lets the new
-- Team column in Production Control show an empty cell rather than a confident 0, so
-- the first shift that fills it in is visibly different from the 231 that did not.
UPDATE public.production_sessions SET staff_actual  = NULL WHERE staff_actual  = 0;
UPDATE public.production_sessions SET staff_planned = NULL WHERE staff_planned = 0;
