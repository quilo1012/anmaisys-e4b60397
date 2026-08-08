-- The clocks decide what kind of day off it was.
--
-- Two records of the same absences drifted apart. TimeMoto has an `Absence Name` on
-- the day itself — Vacation, Unpaid Leave — and the board has a status a supervisor
-- typed. On 29 days they disagreed, and the disagreement was not cosmetic:
--
--   * Dirlei Junior, 20–24/07: the board said holiday, the clocks said Unpaid Leave.
--     Five days of annual entitlement were being spent on leave that was never paid.
--   * Miguel Pereira, 20/07: the reverse — the board said unpaid, the clocks said
--     Vacation, so he was short a holiday day he had actually taken.
--   * Sixteen days where the clocks recorded an absence and the board had no row at
--     all, so the Leave screen and the finance close simply could not see them.
--   * Seven days the board still called `present` for somebody who never badged in.
--
-- TimeMoto wins here because it is the record the payroll is run from and because an
-- absence type on it came from the office, not from a tablet at the end of a shift.
--
-- Only days where the two actually disagree are touched, so this is idempotent: run it
-- twice and the second run matches nothing. `daily_allocations` is deliberately left
-- alone — thirteen of these days have somebody placed on a line, and that is what the
-- board recorded at the time. Rewriting where people stood a fortnight ago is a
-- separate decision from recording what kind of day off they were having.

WITH clocked AS (
  SELECT
    d.employee_id,
    d.on_date,
    CASE d.absence_name
      WHEN 'Vacation'     THEN 'holiday'
      WHEN 'Unpaid Leave' THEN 'unpaid'
    END AS status
  FROM public.attendance_days d
  WHERE d.absence_name IN ('Vacation', 'Unpaid Leave')
    -- A day off on a day the contract never scheduled is not a day off, and inserting
    -- one would spend a holiday somebody still has.
    AND COALESCE(d.scheduled_minutes, 0) > 0
),
disagreeing AS (
  SELECT c.*
  FROM clocked c
  LEFT JOIN public.employee_attendance a
    ON a.employee_id = c.employee_id AND a.on_date = c.on_date
  WHERE a.status IS DISTINCT FROM c.status
)
INSERT INTO public.employee_attendance (employee_id, on_date, status, note)
SELECT employee_id, on_date, status, 'Set from the TimeMoto absence name'
FROM disagreeing
ON CONFLICT (employee_id, on_date) DO UPDATE
  SET status     = EXCLUDED.status,
      -- Keeps whatever a human wrote and says who overruled it, rather than erasing
      -- the note that may be the only explanation of the day.
      note       = COALESCE(NULLIF(public.employee_attendance.note, '') || ' · ', '')
                   || 'Set from the TimeMoto absence name (was '
                   || public.employee_attendance.status || ')',
      updated_at = now();
