-- Tue–Thu days: 17 days of annual leave.
--
-- Left null when the rota was created, because the leave matrix had no three-day
-- figure and guessing one would have put a number on a payslip. BrightPay has it:
-- 17 days for the leave year 01 Aug 2026 – 31 Jul 2027, which is the year
-- `leaveYearOf()` already uses.
UPDATE public.shift_patterns SET annual_leave_days = 17 WHERE name = 'Tue–Thu days';
