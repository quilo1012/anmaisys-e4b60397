-- The gap at the handover: a shift stays writable for thirty minutes after it ends.
--
-- Production is entered at the end of a run, not while the machine is filling, so an
-- operator who finishes at 17:55 is still typing at 18:05. The window has been 15
-- minutes since 30/07 (20260730100000), which was enough for the database — the write
-- at 18:05 was never refused.
--
-- What was wrong was upstream of the database. The screen picked the shift from the
-- clock, and the clock flips to NIGHT at 18:00 on the dot, so a day operator writing
-- up at 18:05 had already been handed the night's session. The quantity was accepted
-- and filed under the wrong shift. Nothing errored, which is why it went unnoticed:
-- the day came up short and the night came up long, and both looked like real numbers.
--
-- The screen now asks which shift is being written whenever both are open, and the
-- window widens from 15 to 30 minutes to fit what the floor actually does. Widening it
-- is only safe BECAUSE the question is asked: the reason it was cut from an hour to 15
-- minutes on 30/07 was that a silent window that long lets the incoming crew log a full
-- run into the shift before theirs. With an explicit choice at the door, the length of
-- the window stops being the thing that protects the record.
--
-- Only operators are gated by this. admin, manager and maintenance_manager writes never
-- consult is_session_locked(), so a late correction is still possible and still audited.

CREATE OR REPLACE FUNCTION public.session_write_deadline(_session_date date, _shift text)
RETURNS timestamptz LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $function$
  SELECT CASE UPPER(COALESCE(_shift, 'DAY'))
    WHEN 'NIGHT' THEN ((_session_date + 1)::text || ' 06:30')::timestamp AT TIME ZONE 'Europe/London'
    ELSE (_session_date::text || ' 18:30')::timestamp AT TIME ZONE 'Europe/London'
  END;
$function$;

COMMENT ON FUNCTION public.session_write_deadline(date, text) IS
  'Last moment an operator may write to a shift: 18:30 for DAY, 06:30 next day for NIGHT (Europe/London) — 30 minutes after the shift ends. Mirrored by SHIFT_GRACE_MINUTES in src/lib/shifts.ts; the two must move together.';
