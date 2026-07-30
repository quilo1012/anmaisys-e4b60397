-- Operators log production inside a window that ends one hour after the shift:
-- 19:00 for a day shift, 07:00 the next morning for a night shift (Europe/London).
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
-- The window replaces the lock for operators, in both directions: it overrides a
-- lock set before the deadline, and it closes the shift after the deadline even if
-- nobody locked it. Retroactive entry then needs admin or manager, which is
-- recorded in the audit log rather than happening quietly.

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
  -- The window is the whole rule now: writable until the deadline, closed after it,
  -- whether or not anyone set the lock. That cuts both ways deliberately.
  --
  -- It opens the shift, so an operator writing up a run at 18:10 is never refused by
  -- a lock a supervisor set at 18:00. And it closes the shift on its own, instead of
  -- staying open indefinitely because nobody remembered to lock it — most sessions
  -- were never locked, so before this the deadline was advisory at best.
  --
  -- Safe to enforce: of 130 operator entries in the 30 days to 30/07, none were made
  -- after their shift's deadline. The rule matches what the floor already does.
  --
  -- Only operators are gated. admin, manager and maintenance_manager writes never
  -- consult this, so a late correction is still possible and leaves an audit trail.
  SELECT COALESCE((
    SELECT now() >= public.session_write_deadline(s.session_date, s.shift)
    FROM public.production_sessions s
    WHERE s.id = _session_id
  ), false);
$function$;

GRANT EXECUTE ON FUNCTION public.session_write_deadline(date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_session_locked(uuid) TO authenticated;
