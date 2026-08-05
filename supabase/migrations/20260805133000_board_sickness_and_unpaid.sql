-- Sickness and unpaid on the board, in place of one unexplained "absence".
--
-- The board could say somebody did not come in and nothing about why, and the why is
-- what decides whether the day is paid. `absence` became `unpaid`, and `sick` joins
-- it, so the reason is recorded at the moment somebody knows it rather than guessed
-- from a note weeks later at the pay close.
--
-- The 33 existing `absence` rows become `unpaid`. That asserts a reason nobody stated
-- when they were marked, and some of them were probably sickness — so they are copied
-- first, and the 21 people they belong to can be corrected on the board now that
-- there is a button for it.
CREATE TABLE IF NOT EXISTS public.absence_rename_bak_20260805 AS
SELECT 'daily_allocations' AS origem, employee_id, on_date, status, now() AS saved_at
FROM public.daily_allocations WHERE status = 'absence'
UNION ALL
SELECT 'employee_attendance', employee_id, on_date, status, now()
FROM public.employee_attendance WHERE status = 'absent';

ALTER TABLE public.absence_rename_bak_20260805 ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins only" ON public.absence_rename_bak_20260805;
CREATE POLICY "Admins only" ON public.absence_rename_bak_20260805 FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role)) WITH CHECK (has_role(auth.uid(),'admin'::app_role));

ALTER TABLE public.daily_allocations DROP CONSTRAINT IF EXISTS daily_allocations_status_check;
UPDATE public.daily_allocations SET status = 'unpaid' WHERE status = 'absence';
ALTER TABLE public.daily_allocations ADD CONSTRAINT daily_allocations_status_check
  CHECK (status = ANY (ARRAY['assigned','overtime','sick','unpaid','holiday']));

-- The payroll side of the same marks. `absent` stays in the employee_attendance check
-- constraint for now: TimeMoto may still import a day under that name, and dropping a
-- value an import can produce would fail the import rather than the row.
UPDATE public.employee_attendance SET status = 'unpaid' WHERE status = 'absent';
