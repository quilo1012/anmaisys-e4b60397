-- Add engineer lock columns to work_orders
ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS locked_engineer_id UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;

-- RPC: accept WO with PIN, lock to engineer
CREATE OR REPLACE FUNCTION public.accept_wo_with_pin(
  _wo_id UUID, _pin TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  _user_id UUID := auth.uid();
  _pin_valid BOOLEAN;
  _wo_locked UUID;
  _engineer_name TEXT;
BEGIN
  IF _user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  -- Validate PIN against caller's profile
  SELECT public.verify_engineer_pin(_user_id, _pin) INTO _pin_valid;
  IF NOT COALESCE(_pin_valid, false) THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_pin');
  END IF;

  -- Already locked to a different engineer?
  SELECT locked_engineer_id INTO _wo_locked
    FROM public.work_orders WHERE id = _wo_id;
  IF _wo_locked IS NOT NULL AND _wo_locked <> _user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'locked_to_other');
  END IF;

  SELECT name INTO _engineer_name FROM public.profiles WHERE id = _user_id;

  UPDATE public.work_orders SET
    status = 'received'::wo_status,
    engineer_id = _user_id,
    engineer_name = _engineer_name,
    locked_engineer_id = _user_id,
    locked_at = COALESCE(locked_at, now()),
    received_at = COALESCE(received_at, now())
  WHERE id = _wo_id;

  -- Best-effort log; ignore unique violation
  BEGIN
    INSERT INTO public.work_order_logs (work_order_id, engineer_id, engineer_name, action)
    VALUES (_wo_id, _user_id, COALESCE(_engineer_name, 'Engineer'), 'received');
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  RETURN jsonb_build_object('success', true, 'engineer_id', _user_id, 'engineer_name', _engineer_name);
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_wo_with_pin(UUID, TEXT) TO authenticated;

-- RPC: finish WO with PIN, only for the locked engineer
CREATE OR REPLACE FUNCTION public.finish_wo_with_pin(
  _wo_id UUID, _pin TEXT, _signed_by_name TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  _user_id UUID := auth.uid();
  _pin_valid BOOLEAN;
  _wo_locked UUID;
  _engineer_name TEXT;
BEGIN
  IF _user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT public.verify_engineer_pin(_user_id, _pin) INTO _pin_valid;
  IF NOT COALESCE(_pin_valid, false) THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_pin');
  END IF;

  SELECT locked_engineer_id INTO _wo_locked
    FROM public.work_orders WHERE id = _wo_id;
  IF _wo_locked IS NOT NULL AND _wo_locked <> _user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'locked_to_other');
  END IF;

  SELECT name INTO _engineer_name FROM public.profiles WHERE id = _user_id;

  UPDATE public.work_orders SET
    status = 'finished'::wo_status,
    finished_at = now(),
    signed_by_name = COALESCE(_signed_by_name, signed_by_name)
  WHERE id = _wo_id;

  BEGIN
    INSERT INTO public.work_order_logs (work_order_id, engineer_id, engineer_name, action)
    VALUES (_wo_id, _user_id, COALESCE(_engineer_name, 'Engineer'), 'finished');
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.finish_wo_with_pin(UUID, TEXT, TEXT) TO authenticated;