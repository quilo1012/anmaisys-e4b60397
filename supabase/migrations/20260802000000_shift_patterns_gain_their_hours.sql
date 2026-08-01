-- The nine real rotas, with the times that make them mean something.
--
-- shift_patterns has carried starts_at and ends_at since it was created and never a
-- single value in them, so a pattern could say which days somebody works and never
-- how long. With the hours in, the same table answers what a week is supposed to be —
-- which is the number overtime is measured against.
--
-- The arithmetic confirms the break rule rather than assuming it. Every twelve-hour
-- rota is four days long, and 4 × (12 − 1) is exactly 44: the contractual week falls
-- out of the times and the one-hour break without anybody rounding anything.
--
--   Mon–Thu 06:00–18:00   4 × 11h = 44h
--   Tue–Fri 06:00–18:00   4 × 11h = 44h
--   Fri–Mon 06:00–18:00   4 × 11h = 44h
--   Mon–Thu 18:00–06:00   4 × 11h = 44h   (nights, crosses midnight)
--
-- Four rotas do not reach 44, and that is the point of recording them: 25h, 35h, 40h
-- and 7h weeks are real contracts, not shortfalls. A flat 44-hour target would show
-- somebody on 09:00–17:00 nine hours in deficit every week of their working life.
UPDATE public.shift_patterns SET name = 'Mon–Thu days', starts_at = '06:00', ends_at = '18:00'
 WHERE name = 'Mon–Thu';
UPDATE public.shift_patterns SET name = 'Tue–Fri days', starts_at = '06:00', ends_at = '18:00'
 WHERE name = 'Tue–Fri';
UPDATE public.shift_patterns SET name = 'Fri–Mon days', starts_at = '06:00', ends_at = '18:00'
 WHERE name = 'Fri–Mon';

INSERT INTO public.shift_patterns (name, days, starts_at, ends_at) VALUES
  -- Nights. ends_at is earlier than starts_at because the shift finishes the next
  -- morning; anything reading this has to take the difference modulo 24 hours.
  ('Mon–Thu nights',    ARRAY[1,2,3,4]::smallint[],   '18:00', '06:00'),
  ('Mon–Fri 09:00–15:00', ARRAY[1,2,3,4,5]::smallint[], '09:00', '15:00'),
  ('Mon–Fri 09:00–17:00', ARRAY[1,2,3,4,5]::smallint[], '09:00', '17:00'),
  ('Mon–Fri 08:00–17:00', ARRAY[1,2,3,4,5]::smallint[], '08:00', '17:00'),
  ('Sun 08:00–16:00',     ARRAY[7]::smallint[],         '08:00', '16:00'),
  ('Sun 09:00–17:00',     ARRAY[7]::smallint[],         '09:00', '17:00')
ON CONFLICT (name) DO UPDATE
  SET days = EXCLUDED.days, starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at;
