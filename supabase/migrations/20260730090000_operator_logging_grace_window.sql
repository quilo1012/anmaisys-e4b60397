-- Give the operator a guaranteed window to finish logging after the shift ends.
--
-- Production is logged at the end of a run, not while the machine is filling, so
-- an operator finishing at 17:55 is still writing up at 18:10. Until now any lock
-- on the session refused those writes outright, and the operator only saw
-- "new row violates row-level security policy for table production_items".
-- On 30/07 the Line 4 night operator hit that seven times between 05:18 and 05:23
-- and stopped trying; that shift's output was never recorded at all.
--
-- The window is one hour past the end of the shift: 19:00 for a day shift,
-- 07:00 the following morning for a night shift, both London time.
--
-- Trade-off, stated plainly: inside the window the operator can write even to a
-- session a supervisor has already locked. That is the point — the operator is
-- guaranteed time to record what the line made. A supervisor who needs the data
-- frozen can lock it after the window closes, and admin / manager writes are not
-- gated by this at all.

CREATE OR REPLACE FUNCTION public.session_write_deadline(_session_date date, _shift text)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT CASE UPPER(COALESCE(_shift, 'DAY'))
    WHEN 'NIGHT' THEN ((_session_date + 1)::text || ' 07:00')::timestamp AT TIME ZONE 'Europe/London'
    ELSE (_session_date::text || ' 19:00')::timestamp AT TIME ZONE 'Europe/London'
  END;
$function$;

COMMENT ON FUNCTION public.session_write_deadline(date, text) IS
  'Last moment an operator may write to a shift: 19:00 for DAY, 07:00 next day for NIGHT (Europe/London). One hour after the shift ends.';

CREATE OR REPLACE FUNCTION public.is_session_locked(_session_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE((
    SELECT CASE
      -- Inside the grace window the shift is writable regardless of the flag.
      WHEN now() < public.session_write_deadline(s.session_date, s.shift) THEN false
      ELSE COALESCE(s.locked, false)
    END
    FROM public.production_sessions s
    WHERE s.id = _session_id
  ), false);
$function$;

GRANT EXECUTE ON FUNCTION public.session_write_deadline(date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_session_locked(uuid) TO authenticated;
