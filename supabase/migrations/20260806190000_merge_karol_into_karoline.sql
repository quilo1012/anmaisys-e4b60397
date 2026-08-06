-- "Karol" e "Karoline Goncalves" são a mesma pessoa.
--
-- I created the "Karol" record when importing the factory's sheets, taking the short
-- spelling for somebody the system did not have. It has no payroll reference and every
-- one of its thirteen board days duplicates a day Karoline Goncalves (E081) already had
-- — same area on eleven of them.
--
-- The sheets settle it. Across the twenty-seven days that mention either spelling,
-- twenty-six carry only one of them. The single exception is 24/07, where "Karoline"
-- sits in an area column and "karol" under Overtime staff: one person listed twice on
-- one day, which is exactly how the sheet marks somebody working an overtime day.
--
-- That overtime is the one fact the duplicate held that Karoline's row did not, so it
-- moves across before the record goes.
UPDATE public.daily_allocations SET status = 'overtime', area_id = NULL
WHERE on_date = '2026-07-24'
  AND employee_id = (SELECT id FROM public.employees WHERE full_name = 'Karoline Goncalves');

DELETE FROM public.daily_allocations
WHERE employee_id IN (SELECT id FROM public.employees WHERE full_name = 'Karol');
DELETE FROM public.employee_attendance
WHERE employee_id IN (SELECT id FROM public.employees WHERE full_name = 'Karol');
DELETE FROM public.employees WHERE full_name = 'Karol';
