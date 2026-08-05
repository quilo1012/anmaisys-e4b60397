-- Duas incoerências encontradas na verificação, e as regras que as impedem de voltar.
--
-- 1. `employee_attendance` is keyed by person and day with no shift, while
--    `daily_allocations` allows one row per shift. Anthony Paulo and Jack Granite were
--    on the weekend board working on Sunday 02/08 AND in the day sheet's absence
--    column, and the backfill chose between them by shift name — alphabetically —
--    so payroll recorded unpaid for a Sunday they were on a line.
--
--    The rule is that working wins. Somebody on a line was there, whatever another
--    column said. It now lives in `src/lib/attendanceFromBoard.ts`, used by both the
--    hand-marking path and the sheet import, because the two copies had already
--    drifted apart twice.
INSERT INTO public.employee_attendance (employee_id, on_date, status)
SELECT DISTINCT ON (a.employee_id, a.on_date)
  a.employee_id, a.on_date,
  CASE a.status WHEN 'holiday' THEN 'holiday' WHEN 'sick' THEN 'sick'
                WHEN 'unpaid' THEN 'unpaid' ELSE 'present' END
FROM public.daily_allocations a
ORDER BY a.employee_id, a.on_date,
  CASE a.status WHEN 'assigned' THEN 0 WHEN 'overtime' THEN 0
                WHEN 'holiday' THEN 1 WHEN 'sick' THEN 2 ELSE 3 END
ON CONFLICT (employee_id, on_date) DO UPDATE SET status = EXCLUDED.status;

-- 2. Danilo Miranda, 15/07: marked unpaid and carrying `left_early_at 07:45`. The
--    sheet said "Danilo (LEFT AT 7:45)" in the absence column — he came in and went
--    home. "Left early" is a fact about somebody who was there, so it cannot sit on a
--    day recorded as away. The time moves to the note rather than being deleted; what
--    it means for his pay is not this migration's to decide.
UPDATE public.daily_allocations
SET note = coalesce(note || ' · ', '') || 'Folha diz: LEFT AT 07:45',
    left_early_at = NULL
WHERE left_early_at IS NOT NULL AND status NOT IN ('assigned','overtime');

ALTER TABLE public.daily_allocations
  DROP CONSTRAINT IF EXISTS daily_allocations_left_early_only_when_working;
ALTER TABLE public.daily_allocations
  ADD CONSTRAINT daily_allocations_left_early_only_when_working
  CHECK (left_early_at IS NULL OR status IN ('assigned','overtime'));
