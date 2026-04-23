-- 1) Junction table: device <-> allowed lines
CREATE TABLE IF NOT EXISTS public.device_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  line_id uuid NOT NULL REFERENCES public.lines(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (device_id, line_id)
);

CREATE INDEX IF NOT EXISTS idx_device_lines_device ON public.device_lines(device_id);
CREATE INDEX IF NOT EXISTS idx_device_lines_line ON public.device_lines(line_id);

ALTER TABLE public.device_lines ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read (operator needs to see its own allowed list)
CREATE POLICY "Authenticated can view device_lines"
  ON public.device_lines FOR SELECT
  TO authenticated
  USING (true);

-- Only admin/manager can mutate
CREATE POLICY "Admins managers can insert device_lines"
  ON public.device_lines FOR INSERT
  TO authenticated
  WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role));

CREATE POLICY "Admins managers can delete device_lines"
  ON public.device_lines FOR DELETE
  TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role));

-- 2) Backfill from existing single-line pairings
INSERT INTO public.device_lines (device_id, line_id)
SELECT id, line_id FROM public.devices
WHERE line_id IS NOT NULL
ON CONFLICT (device_id, line_id) DO NOTHING;

-- 3) Resolver: array of allowed line IDs for the calling device token
CREATE OR REPLACE FUNCTION public.current_device_line_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(array_agg(dl.line_id), ARRAY[]::uuid[])
  FROM public.device_lines dl
  JOIN public.devices d ON d.id = dl.device_id
  WHERE d.device_token = public.current_device_token();
$$;

-- 4) Atomic multi-line pairing function (admin/manager only)
CREATE OR REPLACE FUNCTION public.pair_device_lines(
  _token text,
  _line_ids uuid[],
  _label text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _device_id uuid;
  _primary_line uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role)) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  -- Find or auto-register device row
  SELECT id INTO _device_id FROM public.devices WHERE device_token = _token;
  IF _device_id IS NULL THEN
    INSERT INTO public.devices(device_token, label, paired_by, paired_at)
    VALUES (_token, _label, auth.uid(), now())
    RETURNING id INTO _device_id;
  ELSE
    UPDATE public.devices
      SET label = COALESCE(_label, label),
          paired_by = auth.uid(),
          paired_at = now()
      WHERE id = _device_id;
  END IF;

  -- Replace the allowed-line set atomically
  DELETE FROM public.device_lines WHERE device_id = _device_id;

  IF _line_ids IS NOT NULL AND array_length(_line_ids, 1) > 0 THEN
    INSERT INTO public.device_lines (device_id, line_id)
    SELECT _device_id, lid
    FROM unnest(_line_ids) AS lid
    ON CONFLICT (device_id, line_id) DO NOTHING;

    -- Update legacy cache to the first line for backward compat
    _primary_line := _line_ids[1];
    UPDATE public.devices SET line_id = _primary_line WHERE id = _device_id;
  ELSE
    UPDATE public.devices SET line_id = NULL WHERE id = _device_id;
  END IF;
END;
$$;

-- 5) Update unpair to also clear junction
CREATE OR REPLACE FUNCTION public.unpair_device(_device_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role)) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  DELETE FROM public.device_lines WHERE device_id = _device_id;
  UPDATE public.devices
    SET line_id = NULL, paired_by = NULL, paired_at = NULL
    WHERE id = _device_id;
END;
$$;

-- 6) Update RLS on work_orders to use the new array helper
DROP POLICY IF EXISTS "Operators view own line WOs (device-scoped)" ON public.work_orders;
DROP POLICY IF EXISTS "Operators create WOs on device line" ON public.work_orders;

CREATE POLICY "Operators view own line WOs (device-scoped)"
  ON public.work_orders FOR SELECT
  TO authenticated
  USING (
    has_role(auth.uid(), 'engineer'::app_role)
    OR has_role(auth.uid(), 'admin'::app_role)
    OR (
      has_role(auth.uid(), 'operator'::app_role)
      AND line_id IS NOT NULL
      AND line_id = ANY(public.current_device_line_ids())
      AND operator_id = auth.uid()
    )
  );

CREATE POLICY "Operators create WOs on device line"
  ON public.work_orders FOR INSERT
  TO authenticated
  WITH CHECK (
    operator_id = auth.uid()
    AND has_role(auth.uid(), 'operator'::app_role)
    AND line_id IS NOT NULL
    AND line_id = ANY(public.current_device_line_ids())
  );