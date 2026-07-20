CREATE OR REPLACE FUNCTION public.add_wo_collaborator(_wo_id uuid, _pin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  _actor uuid := auth.uid();
  _collab_id uuid;
  _collab_name text;
  _primary uuid;
  _status text;
BEGIN
  IF _actor IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  IF _pin IS NULL OR length(_pin) < 4 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_pin');
  END IF;

  SELECT p.id, COALESCE(p.name, 'Engineer')
    INTO _collab_id, _collab_name
  FROM public.profiles p
  WHERE p.pin_hash IS NOT NULL
    AND p.pin_hash = extensions.crypt(_pin, p.pin_hash)
    AND public.has_role(p.id, 'engineer'::app_role)
  LIMIT 1;

  IF _collab_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_pin');
  END IF;

  SELECT locked_engineer_id, status::text
    INTO _primary, _status
  FROM public.work_orders
  WHERE id = _wo_id;

  IF _primary IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'wo_not_accepted_yet');
  END IF;

  IF _status NOT IN ('received', 'arrived', 'in_progress') THEN
    RETURN jsonb_build_object('success', false, 'error', 'wo_not_active');
  END IF;

  IF _collab_id = _primary THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_primary');
  END IF;

  UPDATE public.work_orders
  SET
    collaborator_ids = CASE
      WHEN _collab_id = ANY(COALESCE(collaborator_ids, ARRAY[]::uuid[]))
        THEN collaborator_ids
      ELSE array_append(COALESCE(collaborator_ids, ARRAY[]::uuid[]), _collab_id)
    END,
    collaborator_names = CASE
      WHEN _collab_id = ANY(COALESCE(collaborator_ids, ARRAY[]::uuid[]))
        THEN collaborator_names
      ELSE array_append(COALESCE(collaborator_names, ARRAY[]::text[]), _collab_name)
    END
  WHERE id = _wo_id;

  BEGIN
    INSERT INTO public.work_order_logs (work_order_id, engineer_id, engineer_name, action)
    VALUES (_wo_id, _collab_id, _collab_name, 'collaborator_joined');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'engineer_id', _collab_id,
    'engineer_name', _collab_name
  );
END;
$$;