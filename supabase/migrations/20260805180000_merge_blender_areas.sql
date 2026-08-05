-- Uma área, três nomes: Blender Room, Assembly e Blender Team.
--
-- The board drew all three side by side in the support band — Blender Room and Blender
-- Team both empty, Assembly holding five people — because the factory's sheet writes
-- the same place three ways across the same workbook, and the import created a column
-- for each. A supervisor reading the board saw two empty rooms and a team that did not
-- exist.
--
-- The allocations move rather than being deleted: 45 from Assembly and 11 from Blender
-- Team join the 5 already on Blender Room, so nobody loses a day.
UPDATE public.daily_allocations
SET area_id = (SELECT id FROM public.headcount_areas WHERE name = 'Blender Room')
WHERE area_id IN (SELECT id FROM public.headcount_areas WHERE name IN ('Assembly', 'Blender Team'));

-- `sheet_label` now takes a list, so all three headings in the company's workbook find
-- the one area. Without it two of the three come back as unknown columns on the next
-- import and everybody in them is placed again by hand.
UPDATE public.headcount_areas
SET sheet_label = 'Blender Room, Assembly, Blender Team'
WHERE name = 'Blender Room';

-- Kept, not deleted. They hold no allocations now, and a deleted area cannot be
-- brought back if one of the three turns out to be a real second place.
UPDATE public.headcount_areas SET active = false, sheet_label = NULL
WHERE name IN ('Assembly', 'Blender Team');
