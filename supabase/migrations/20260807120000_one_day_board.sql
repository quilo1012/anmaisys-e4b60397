-- Um quadro de dia, com a equipa dita em cada pessoa.
--
-- The board had one wall chart per crew: Day, Night, Weekend, and the two warehouse
-- ones folded into those. The factory does not plan that way — their headcount sheets
-- draw a single sheet per day carrying everybody whose shift runs while the lines do,
-- the Fri–Mon crew beside the Mon–Thu crew beside the warehouse, and only the night
-- crew apart.
--
-- Keeping them split cost more than it explained. A weekend-crew person's approved
-- holiday landed on a board holding nothing but that holiday. Thirty-one days sat on
-- two boards at once. And the Day picker would not offer a Fri–Mon name, so a Saturday
-- call-in could not be placed on the board their own allocation was already on.
--
-- `boardShiftFor` now answers Night or Day and nothing else, and the crew is shown as
-- a badge on the card — FRI–MON, WH, WH FRI–MON. It has not stopped mattering: it says
-- which days somebody is due in, which is what the shift balance counts. It is just
-- not a separate wall chart.
UPDATE public.daily_allocations a SET shift = 'Day'
WHERE a.shift = 'Weekend'
  AND NOT EXISTS (SELECT 1 FROM public.daily_allocations d
                  WHERE d.employee_id = a.employee_id AND d.on_date = a.on_date AND d.shift = 'Day');
