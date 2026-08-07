-- Tue–Fri days: 22.5 dias de férias, não 21.5.
--
-- The leave matrix of 05/08 gave this rota 21.5 while the other three four-day,
-- forty-four hour rotas — Mon–Thu days, Mon–Thu nights and Fri–Mon — all had 22.5.
-- One of four being different by exactly one day was the shape of a typo, and it is.
-- Forty-three people, a day each.
UPDATE public.shift_patterns SET annual_leave_days = 22.5 WHERE name = 'Tue–Fri days';

-- O quadro passa a ter duas bandas: Production e Sectors.
--
-- Lab, Office and the Blender Room join production — they are part of running the
-- lines, not a separate half of the screen. Sectors keeps the four that serve the
-- whole floor: WH Team, Maintenance, Hygiene and Quality.
UPDATE public.headcount_areas SET section = 'production'
WHERE name IN ('Lab', 'Office', 'Blender Room');
