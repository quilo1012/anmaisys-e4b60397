-- Os períodos de pagamento a partir de setembro estavam uma semana adiantados.
--
-- 07/09 to 11/10 is thirty-five days — five weeks, not four. The table had it as
-- 07/09–04/10, and every period after that inherited the missing week: October read
-- 05/10 where it should read 12/10, November 02/11 instead of 09/11, and so on.
--
-- Nothing was attached to them — `overtime_entries` is empty — so they are replaced
-- outright rather than shifted.
--
-- Worth knowing for anything that measures a period: they are NOT all four weeks. A
-- rule that assumes twenty-eight days drifts by a week from 07/09 onward, which is
-- exactly what the expected-shifts calculation does when it counts weekdays in a range
-- rather than multiplying.
DELETE FROM public.workforce_payroll_periods WHERE start_date >= '2026-09-07';

INSERT INTO public.workforce_payroll_periods (name, start_date, end_date) VALUES
  ('September 2026', '2026-09-07', '2026-10-11'),
  ('October 2026',   '2026-10-12', '2026-11-08'),
  ('November 2026',  '2026-11-09', '2026-12-06'),
  ('December 2026',  '2026-12-07', '2027-01-03');

-- Twenty-eight day cycles after that, so a close never runs without a period. December
-- may move; these are only a floor.
INSERT INTO public.workforce_payroll_periods (name, start_date, end_date)
SELECT to_char(d::date + 27, 'FMMonth YYYY'), d::date, d::date + 27
FROM generate_series('2027-01-04'::date, '2028-06-01'::date, '28 days') d;
