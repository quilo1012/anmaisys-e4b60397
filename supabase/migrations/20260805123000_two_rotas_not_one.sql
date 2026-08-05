-- Two rotas, not one rota with an odd Friday.
--
-- The previous migration read "06:00–18:00 Tuesday to Thursday / 09:00–18:00 Friday"
-- as a single Tue–Fri rota whose Friday started later. It is two separate rotas, and
-- the second runs Monday to Friday rather than only on the Friday.
--
-- Safe to drop: it was created minutes earlier and never assigned to anybody. The
-- guard is there so a replay on a database where somebody HAS been put on it leaves
-- it alone rather than cascading their rota away.
DELETE FROM public.shift_patterns p
WHERE p.name = 'Tue–Fri days (Fri 09:00)'
  AND NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.shift_pattern_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM public.employee_shift_history h WHERE h.shift_pattern_id = p.id);

-- 3 × (12 − 1) = 33 h a week. `annual_leave_days` is deliberately null: the leave
-- matrix runs from four-day rotas to one-day ones and has no three-day figure, and a
-- guess here becomes a number on somebody's payslip. The Leave screen already reads
-- null as "not set" rather than as zero days remaining.
INSERT INTO public.shift_patterns
  (name, days, starts_at, ends_at, break_minutes, active, annual_leave_days, leave_includes_bank_holidays)
SELECT 'Tue–Thu days', ARRAY[2,3,4], '06:00', '18:00', 60, true, NULL, true
WHERE NOT EXISTS (SELECT 1 FROM public.shift_patterns WHERE name = 'Tue–Thu days');

-- 5 × (9 − 1) = 40 h. Entitlement 28, matching the other Mon–Fri rotas: the leave
-- matrix gives 28 to Mon–Fri 09:00–15:00 and 09:00–17:00 alike, so it follows the
-- days worked and not the hours in them.
INSERT INTO public.shift_patterns
  (name, days, starts_at, ends_at, break_minutes, active, annual_leave_days, leave_includes_bank_holidays)
SELECT 'Mon–Fri 09:00–18:00', ARRAY[1,2,3,4,5], '09:00', '18:00', 60, true, 28, true
WHERE NOT EXISTS (SELECT 1 FROM public.shift_patterns WHERE name = 'Mon–Fri 09:00–18:00');
