-- Where somebody worked on a day, rather than where they are.
--
-- The board wrote employees.headcount_area_id, which holds one value. Moving somebody
-- to Line 2 on Tuesday overwrote Monday, so Monday's board silently became a lie
-- about a day that had already happened — and nobody moves through the same lines
-- every day, which is the whole reason the sheet is filled in daily.
--
-- employee_attendance was already the right shape: one row per person per day, with
-- UNIQUE (employee_id, on_date). The area joins the status it belongs beside.
--
-- The column on employees stays and changes meaning: it is now the DEFAULT — where
-- this person usually is — which seeds a day nobody has allocated yet. Keeping both
-- is what makes the board open pre-filled instead of empty every morning, without
-- pretending the default was a record of the day.
ALTER TABLE public.employee_attendance
  ADD COLUMN IF NOT EXISTS headcount_area_id uuid
  REFERENCES public.headcount_areas(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS employee_attendance_area_idx
  ON public.employee_attendance (on_date, headcount_area_id);

COMMENT ON COLUMN public.employee_attendance.headcount_area_id IS
  'Where this person worked on this day. Null means they were where employees.headcount_area_id says they usually are.';

COMMENT ON COLUMN public.employees.headcount_area_id IS
  'Where this person usually works. A starting point for a new day, not a record of any day.';
