
-- Add 'rejected' to wo_status enum
ALTER TYPE wo_status ADD VALUE IF NOT EXISTS 'rejected';

-- Add rejection tracking columns
ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_by uuid REFERENCES auth.users(id);

-- Secure RPC to reject a WO
CREATE OR REPLACE FUNCTION public.reject_wo(_wo_id uuid, _reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _uname text;
  _wo record;
BEGIN
  IF _uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  IF _reason IS NULL OR length(trim(_reason)) < 3 THEN
    RETURN jsonb_build_object('success', false, 'error', 'reason_required');
  END IF;

  IF NOT (
    public.has_role(_uid, 'admin'::app_role) OR
    public.has_role(_uid, 'manager'::app_role) OR
    public.has_role(_uid, 'maintenance_manager'::app_role) OR
    public.has_role(_uid, 'engineer'::app_role)
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  SELECT id, status::text, intouch_machine_id, wo_number
    INTO _wo FROM public.work_orders WHERE id = _wo_id;

  IF _wo.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'wo_not_found');
  END IF;

  IF _wo.status <> 'open' THEN
    RETURN jsonb_build_object('success', false, 'error', 'only_open_can_be_rejected');
  END IF;

  IF _wo.intouch_machine_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'itouching_wo_cannot_be_rejected');
  END IF;

  SELECT COALESCE(name, email, 'Engineer') INTO _uname FROM public.profiles WHERE id = _uid;

  UPDATE public.work_orders SET
    status = 'rejected'::wo_status,
    rejection_reason = trim(_reason),
    rejected_at = now(),
    rejected_by = _uid,
    line_stopped = false,
    line_resumed_at = COALESCE(line_resumed_at, now()),
    line_resumed_by = COALESCE(line_resumed_by, _uid)
  WHERE id = _wo_id;

  -- Close any open downtime episode
  UPDATE public.downtime_events
    SET resumed_at = COALESCE(resumed_at, now())
  WHERE work_order_id = _wo_id AND resumed_at IS NULL;

  BEGIN
    INSERT INTO public.work_order_logs (work_order_id, engineer_id, engineer_name, action)
    VALUES (_wo_id, _uid, _uname, 'rejected: ' || trim(_reason));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('success', true, 'wo_number', _wo.wo_number);
END;
$$;

REVOKE ALL ON FUNCTION public.reject_wo(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_wo(uuid, text) TO authenticated;
