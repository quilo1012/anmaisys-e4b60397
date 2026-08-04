-- Holiday entitlement is per shift pattern, not a flat number for everybody.
--
-- BrightPay counts it in working days of the person's own rota: 22.5 for Mon–Thu,
-- 21.5 for Tue–Fri, 22.5 for Fri–Mon. A flat 28 would hand the Tue–Fri crew days they
-- do not have and short everybody else, because their weeks are different lengths.
--
-- Matched on `days` rather than on the pattern name: "Mon–Thu days" and "Mon–Thu
-- nights" are two rows with the same four weekdays and the same entitlement, and a
-- name match would have to know that.
--
-- Mon–Fri and Sun are deliberately left null — BrightPay has not supplied them, and
-- nine people are on those patterns. Null reads as "not set" on the screen; a zero
-- would read as "no days left", which is a different and wrong thing to tell somebody.

ALTER TABLE public.shift_patterns
  ADD COLUMN IF NOT EXISTS annual_leave_days numeric;

COMMENT ON COLUMN public.shift_patterns.annual_leave_days IS
  'Annual entitlement in working days of this pattern, from BrightPay. Null means not supplied yet.';

UPDATE public.shift_patterns SET annual_leave_days = 22.5 WHERE days::int[] = ARRAY[1,2,3,4];
UPDATE public.shift_patterns SET annual_leave_days = 21.5 WHERE days::int[] = ARRAY[2,3,4,5];
UPDATE public.shift_patterns SET annual_leave_days = 22.5 WHERE days::int[] = ARRAY[5,6,7,1];

-- The sheet books half days, so the count has to hold them.
ALTER TABLE public.leave_requests ALTER COLUMN working_days TYPE numeric;
