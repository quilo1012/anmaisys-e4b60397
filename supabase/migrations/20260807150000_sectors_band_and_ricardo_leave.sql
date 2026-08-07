-- Uma banda para os setores, e umas férias que foram escritas por cima.
--
-- WH Team and Maintenance sat under Support beside Lab and Office; Hygiene and Quality
-- sat under Production beside the lines. They are neither: they serve the whole floor,
-- and split across the two bands a supervisor checking hygiene cover looked in the
-- wrong half of the screen first.
UPDATE public.headcount_areas SET section = 'sectors'
WHERE name IN ('WH Team', 'Maintenance', 'Hygiene', 'Quality');

-- Ricardo Fernandes, 11/08. His holiday was approved at 11:18 and somebody planned him
-- onto Line 6 that afternoon; the board upsert overwrote the day and said nothing, so
-- the leave request read approved while the board read Line 6.
--
-- `daily_allocations` has no trigger maintaining `updated_at`, so both rows carried the
-- insert stamp and the overwrite left no trace in the table at all. It was only
-- provable from the leave request's own decision time.
--
-- The request wins here: 11/08 is still ahead and no sheet says otherwise. Anderson
-- Cavalcante's 03/08 is the same collision and is deliberately left alone — the
-- factory's own sheet has him working that day, which is evidence the request is not.
UPDATE public.daily_allocations SET status = 'holiday', area_id = NULL
WHERE on_date = '2026-08-11'
  AND employee_id = (SELECT id FROM public.employees WHERE full_name = 'Ricardo Fernandes');

UPDATE public.employee_attendance SET status = 'holiday'
WHERE on_date = '2026-08-11'
  AND employee_id = (SELECT id FROM public.employees WHERE full_name = 'Ricardo Fernandes');
