-- Use the existing Runner area and its history; Wrapping was an alternate label for that Headcount position.
UPDATE public.headcount_areas
SET active = true, kind = 'production', section = 'production', department = 'Production',
    sheet_label = 'Runner, Wrapping', sort_order = 130
WHERE name = 'Runner';

-- Retain all six saved Wrapping placements by moving them to the same Runner board area.
UPDATE public.daily_allocations
SET area_id = (SELECT id FROM public.headcount_areas WHERE name = 'Runner')
WHERE area_id = (SELECT id FROM public.headcount_areas WHERE name = 'Wrapping');

UPDATE public.headcount_areas SET active = false, sheet_label = NULL
WHERE name = 'Wrapping';