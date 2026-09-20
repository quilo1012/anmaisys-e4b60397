-- Headcount board areas only. Nothing in `lines` is touched: RAG, scorecards and
-- downtime read those rows.

-- Retired rather than deleted: daily_allocations rows point at them and the history
-- of every board already drawn has to keep reading back.
UPDATE public.headcount_areas
   SET active = false, sheet_group = NULL
 WHERE name IN ('Capsules Machine 1', 'Capsules Machine 2');

-- The column the workbook calls "Pill line". line_id stays null: the Headcount board
-- never reads it (areas such as Gel Room, Hygiene and Quality have none either), and
-- inventing a link would tie a headcount column to a production line it is not.
INSERT INTO public.headcount_areas (name, kind, section, department, sheet_label, sort_order, active)
SELECT 'Pill Line', 'production', 'production', 'Production', 'Pill line', 80, true
 WHERE NOT EXISTS (SELECT 1 FROM public.headcount_areas WHERE name = 'Pill Line');

-- The night workbook has a Wrapping column.
INSERT INTO public.headcount_areas (name, kind, section, department, sheet_label, sort_order, active)
SELECT 'Wrapping', 'production', 'production', 'Production', 'Wrapping', 155, true
 WHERE NOT EXISTS (SELECT 1 FROM public.headcount_areas WHERE name = 'Wrapping');

-- The night workbook writes it "GELL ROOM". sheet_label takes a comma-separated list.
UPDATE public.headcount_areas
   SET sheet_label = 'Gel Room, GELL ROOM'
 WHERE name = 'Gel Room' AND (sheet_label IS NULL OR sheet_label = 'Gel Room');
