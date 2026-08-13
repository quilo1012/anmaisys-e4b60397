-- Somebody who came in late.
--
-- The board learnt to say "went home early" and never learnt the other half. A person
-- who was due at six and walked in at nine was recorded exactly like a person who was
-- there at six: `status` said assigned, the headcount counted them, and the three hours
-- the line ran a body short existed nowhere.
--
-- It is the same fact as `left_early_at` seen from the other end — a day WORKED that was
-- cut short — so it is stored the same way, as the time and not a flag. "He was late" is
-- only useful to a supervisor if it says how late, and only useful to payroll if it can
-- be turned into hours.
--
-- The two can both be true on one day: in at nine, home at two. The hours are worked out
-- from the window between them, in `partDay`, so the break is deducted once and only from
-- somebody who was still there when it fell.
--
-- Null is the normal case: they were in on time.
ALTER TABLE public.daily_allocations
  ADD COLUMN IF NOT EXISTS arrived_late_at time;

COMMENT ON COLUMN public.daily_allocations.arrived_late_at IS
  'The person came in after the shift had started, at this time. Null means they were in on time. The mirror of left_early_at, and both can be set on the same day; neither is an absence — the person was on the line for the part between them.';

-- You cannot be late for a day you were never at. The same rule `left_early_at` carries,
-- for the same reason: a holiday row holding a clock-in time is a row two screens read
-- two different ways.
ALTER TABLE public.daily_allocations
  DROP CONSTRAINT IF EXISTS daily_allocations_arrived_late_only_when_working;
ALTER TABLE public.daily_allocations
  ADD CONSTRAINT daily_allocations_arrived_late_only_when_working
  CHECK (arrived_late_at IS NULL OR status IN ('assigned','overtime'));
