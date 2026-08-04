-- The rest of the BrightPay entitlements, and whether bank holidays are inside them.
--
-- Mon–Fri is 28 days, Sunday-only is 5.5, and a three-day Tue/Wed/Thu pattern would
-- be 17 — entitlement counted in working days of the person's own rota, so the
-- number falls with the length of their week. All nine patterns are covered now:
-- 172 of 172 people.
--
-- Matched on `days` rather than the pattern name. The name-matching version proposed
-- alongside these figures reads `includes('fri') && includes('mon')`, which "Mon–Fri
-- 09:00–17:00" also satisfies — it depends on the order of its own if-statements to
-- come out right. The weekday array cannot be ambiguous: [1,2,3,4,5] is Mon–Fri and
-- nothing else, whatever anybody renames it to.
--
-- `leave_includes_bank_holidays` is the other half of the figure. Fri–Mon and the
-- Sunday crews get theirs on top; everyone else has them inside the total. Paying one
-- as though it were the other is a real day per person per year.

ALTER TABLE public.shift_patterns
  ADD COLUMN IF NOT EXISTS leave_includes_bank_holidays boolean;

COMMENT ON COLUMN public.shift_patterns.leave_includes_bank_holidays IS
  'True when annual_leave_days already contains the bank holidays; false when they are on top.';

UPDATE public.shift_patterns SET annual_leave_days = 28.0, leave_includes_bank_holidays = true
 WHERE days::int[] = ARRAY[1,2,3,4,5];
UPDATE public.shift_patterns SET annual_leave_days = 5.5, leave_includes_bank_holidays = false
 WHERE days::int[] = ARRAY[7];
UPDATE public.shift_patterns SET annual_leave_days = 17.0, leave_includes_bank_holidays = true
 WHERE days::int[] = ARRAY[2,3,4];
UPDATE public.shift_patterns SET leave_includes_bank_holidays = true
 WHERE days::int[] IN (ARRAY[1,2,3,4], ARRAY[2,3,4,5]);
UPDATE public.shift_patterns SET leave_includes_bank_holidays = false
 WHERE days::int[] = ARRAY[5,6,7,1];
