-- Somebody who came in and went home early.
--
-- The board could say "in" or "not in" and nothing between, so a person who worked
-- the morning and left at two was recorded as a full day. `half_day` did not cover it:
-- that column is half a day OFF and only ever applies to an absence or a holiday.
-- This is the opposite fact — a day WORKED that got cut short — and it needs the time,
-- because "he went early" is only useful to a supervisor if it says how early.
--
-- Null is the normal case: they worked the shift out.
ALTER TABLE public.daily_allocations
  ADD COLUMN IF NOT EXISTS left_early_at time;

COMMENT ON COLUMN public.daily_allocations.left_early_at IS
  'The person came in and went home before the shift ended, at this time. Null means they worked the whole shift. Distinct from half_day, which is half a day OFF (absence/holiday); this one is a day WORKED that was cut short.';
