
-- 1) Add collaborator columns to work_orders for multi-engineer jobs
ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS collaborator_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS collaborator_names text[] NOT NULL DEFAULT '{}';

-- 2) Tighten the engineer UPDATE policy: only the locked engineer OR a registered
--    collaborator may modify the WO. Unlocked WOs (no engineer accepted yet) stay
--    editable by any engineer so they can Accept.
DROP POLICY IF EXISTS "Engineers can update WOs" ON public.work_orders;
CREATE POLICY "Engineers can update locked or unlocked WOs"
ON public.work_orders
FOR UPDATE
TO authenticated
USING (
  public.has_role(auth.uid(), 'engineer'::app_role) AND (
    locked_engineer_id IS NULL
    OR locked_engineer_id = auth.uid()
    OR auth.uid() = ANY(COALESCE(collaborator_ids, ARRAY[]::uuid[]))
  )
)
WITH CHECK (
  public.has_role(auth.uid(), 'engineer'::app_role) AND (
    locked_engineer_id IS NULL
    OR locked_engineer_id = auth.uid()
    OR auth.uid() = ANY(COALESCE(collaborator_ids, ARRAY[]::uuid[]))
  )
);

-- 3) RPC: add a co-engineer to an active WO (PIN-verified)
CREATE OR REPLACE FUNCTION public.add_wo_collaborator(_wo_id uuid, _pin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _ok boolean;
  _name text;
  _primary uuid;
  _status text;
BEGIN
  IF _uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT public.verify_engineer_pin(_uid, _pin) INTO _ok;
  IF NOT COALESCE(_ok, false) THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_pin');
  END IF;

  SELECT locked_engineer_id, status::text INTO _primary, _status
  FROM public.work_orders WHERE id = _wo_id;

  IF _primary IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'wo_not_accepted_yet');
  END IF;
  IF _primary = _uid THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_primary');
  END IF;
  IF _status NOT IN ('received', 'arrived', 'in_progress') THEN
    RETURN jsonb_build_object('success', false, 'error', 'wo_not_active');
  END IF;

  SELECT name INTO _name FROM public.profiles WHERE id = _uid;
  _name := COALESCE(_name, 'Engineer');

  UPDATE public.work_orders
  SET
    collaborator_ids = CASE
      WHEN _uid = ANY(COALESCE(collaborator_ids, ARRAY[]::uuid[]))
      THEN collaborator_ids
      ELSE array_append(COALESCE(collaborator_ids, ARRAY[]::uuid[]), _uid)
    END,
    collaborator_names = CASE
      WHEN _name = ANY(COALESCE(collaborator_names, ARRAY[]::text[]))
      THEN collaborator_names
      ELSE array_append(COALESCE(collaborator_names, ARRAY[]::text[]), _name)
    END
  WHERE id = _wo_id;

  BEGIN
    INSERT INTO public.work_order_logs (work_order_id, engineer_id, engineer_name, action)
    VALUES (_wo_id, _uid, _name, 'collaborator_joined');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('success', true, 'engineer_id', _uid, 'engineer_name', _name);
END;
$$;

-- 4) Allow collaborators to finish the WO too (was: only primary)
CREATE OR REPLACE FUNCTION public.finish_wo_with_pin(_wo_id uuid, _pin text, _signed_by_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  _user_id UUID := auth.uid();
  _pin_valid BOOLEAN;
  _wo_locked UUID;
  _collabs UUID[];
  _engineer_name TEXT;
  _all_names TEXT;
BEGIN
  IF _user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT public.verify_engineer_pin(_user_id, _pin) INTO _pin_valid;
  IF NOT COALESCE(_pin_valid, false) THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_pin');
  END IF;

  SELECT locked_engineer_id, COALESCE(collaborator_ids, ARRAY[]::uuid[])
    INTO _wo_locked, _collabs
    FROM public.work_orders WHERE id = _wo_id;

  IF _wo_locked IS NOT NULL
     AND _wo_locked <> _user_id
     AND NOT (_user_id = ANY(_collabs)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'locked_to_other');
  END IF;

  SELECT name INTO _engineer_name FROM public.profiles WHERE id = _user_id;

  -- Build a combined signed_by_name including all collaborators.
  SELECT
    COALESCE(_signed_by_name, _engineer_name, 'Engineer')
    || CASE
         WHEN array_length(COALESCE(collaborator_names, ARRAY[]::text[]), 1) > 0
         THEN ' + ' || array_to_string(collaborator_names, ', ')
         ELSE ''
       END
  INTO _all_names
  FROM public.work_orders WHERE id = _wo_id;

  UPDATE public.work_orders SET
    status = 'finished'::wo_status,
    finished_at = now(),
    signed_by_name = _all_names
  WHERE id = _wo_id;

  UPDATE public.wo_episodes
     SET finished_at = COALESCE(finished_at, now()),
         finish_engineer_id = COALESCE(finish_engineer_id, _user_id),
         finish_pin_verified = true
   WHERE work_order_id = _wo_id
     AND finished_at IS NULL;

  BEGIN
    INSERT INTO public.work_order_logs (work_order_id, engineer_id, engineer_name, action)
    VALUES (_wo_id, _user_id, COALESCE(_engineer_name, 'Engineer'), 'finished');
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  RETURN jsonb_build_object('success', true);
END;
$function$;
