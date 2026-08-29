-- Uma matriz para cada tipo de dia, e o dia escolhe-a.
--
-- The day board had two standards — `normal` and `changeover` — and somebody chose
-- between them every morning. That was the right shape while there were two, and it
-- stopped being right here: `changeover` was one answer to two different days. Monday
-- is Fri–Mon finishing as Mon–Thu starts; Friday is Tue–Fri finishing as Fri–Mon
-- starts. They are not the same crews, they are not the same size, and a single
-- standard saved from one of them was wrong on the other.
--
-- So the day board gets four, one per kind of day, and the date names which:
--
--   Monday      Fri–Mon finishing   +  Mon–Thu starting      -> 'monday'
--   Tue–Thu     Mon–Thu             +  Tue–Fri               -> 'full'
--   Friday      Tue–Fri finishing   +  Fri–Mon starting      -> 'friday'
--   Sat, Sun    Fri–Mon                                      -> 'weekend'
--
-- The night board is not touched. Nights are one crew planned by hand, and its two
-- standards keep both their names and their rows.
--
-- What is still NOT stored here, for the same reasons the table was built on:
-- the rota, which is read live so somebody moved between crews moves standard on
-- their own; leadership, which is a fact about a day; and attendance, which the
-- matrix has never claimed to know.
ALTER TABLE public.headcount_matrix
  DROP CONSTRAINT IF EXISTS headcount_matrix_kind_check;
ALTER TABLE public.headcount_matrix
  ADD CONSTRAINT headcount_matrix_kind_check
  CHECK (kind IN ('normal', 'changeover', 'monday', 'full', 'friday', 'weekend'));

-- Friday is seeded from `changeover` before `changeover` becomes Monday, because it
-- was the standard for both days and is the closest thing either of them has to a
-- board somebody already checked. Copied rather than split: each one is now refined by
-- saving a real Monday and a real Friday, and a standard that starts empty is one
-- nobody can use on the first morning they reach for it.
INSERT INTO public.headcount_matrix (shift, kind, employee_id, area_id, saved_from, saved_by)
SELECT shift, 'friday', employee_id, area_id, saved_from, saved_by
  FROM public.headcount_matrix
 WHERE shift = 'Day' AND kind = 'changeover'
ON CONFLICT (shift, kind, employee_id) DO NOTHING;

UPDATE public.headcount_matrix SET kind = 'monday' WHERE shift = 'Day' AND kind = 'changeover';
UPDATE public.headcount_matrix SET kind = 'full'   WHERE shift = 'Day' AND kind = 'normal';
