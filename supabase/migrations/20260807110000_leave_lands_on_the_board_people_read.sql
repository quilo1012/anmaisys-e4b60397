-- Férias aprovadas iam parar a um quadro que ninguém abre.
--
-- Approving leave wrote the board day using `boardShiftFor`, which maps a crew to a
-- board: Weekend crew to the Weekend board. That is the tidy answer and it is not what
-- this factory does. Their own headcount sheets draw the Fri–Mon crew, the warehouse
-- and the day shift on one sheet per day, because they all work while the lines run —
-- only nights is drawn apart. Every one of those sheets imported onto the Day board.
--
-- So Talita Melech's four days of holiday landed on the Weekend board, where they were
-- the only thing on it, while the board everybody reads showed her simply missing from
-- the plan. Two rules for one question, and the quieter one won.
--
-- Going forward the rule is in `src/lib/boardForPerson.ts`: write the day where this
-- person has actually been placed, and fall back to the crew mapping only for somebody
-- with no history at all.

-- Move what is already stranded, but only where the destination is free.
UPDATE public.daily_allocations a SET shift = 'Day'
WHERE a.shift = 'Weekend'
  AND (SELECT count(*) FROM public.daily_allocations b
       WHERE b.employee_id = a.employee_id AND b.shift = 'Day')
    > (SELECT count(*) FROM public.daily_allocations b
       WHERE b.employee_id = a.employee_id AND b.shift = 'Weekend')
  AND NOT EXISTS (SELECT 1 FROM public.daily_allocations c
                  WHERE c.employee_id = a.employee_id AND c.on_date = a.on_date AND c.shift = 'Day');

-- Thirty-one days were on BOTH boards — one person, one day, counted twice, which is
-- two shifts in every total that adds allocations up.
UPDATE public.daily_allocations d SET area_id = w.area_id
FROM public.daily_allocations w
WHERE w.shift = 'Weekend' AND d.shift = 'Day'
  AND d.employee_id = w.employee_id AND d.on_date = w.on_date
  AND d.area_id IS NULL AND w.area_id IS NOT NULL;

-- Two of them disagreed: Anthony Paulo and Jack Granite, working on one board and away
-- on the other, on Sunday 02/08. Working wins — the same rule already applied to their
-- attendance, for the same reason: a name on a line is evidence, an absence column is
-- somebody's note.
UPDATE public.daily_allocations d SET status = 'assigned', area_id = COALESCE(d.area_id, w.area_id)
FROM public.daily_allocations w
WHERE w.shift = 'Weekend' AND d.shift = 'Day'
  AND d.employee_id = w.employee_id AND d.on_date = w.on_date
  AND w.status IN ('assigned','overtime') AND d.status IN ('holiday','sick','unpaid');

DELETE FROM public.daily_allocations w
WHERE w.shift = 'Weekend'
  AND EXISTS (SELECT 1 FROM public.daily_allocations d
              WHERE d.employee_id = w.employee_id AND d.on_date = w.on_date AND d.shift = 'Day');
