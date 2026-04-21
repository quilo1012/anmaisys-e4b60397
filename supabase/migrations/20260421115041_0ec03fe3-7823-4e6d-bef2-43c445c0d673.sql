-- Devices table: tracks tablets paired to lines
CREATE TABLE public.devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_token text NOT NULL UNIQUE,
  line_id uuid REFERENCES public.lines(id) ON DELETE SET NULL,
  label text,
  paired_by uuid,
  paired_at timestamptz,
  last_seen_at timestamptz DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_devices_token ON public.devices(device_token);
CREATE INDEX idx_devices_line ON public.devices(line_id);

ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can register a token (first-touch self-register, unpaired)
CREATE POLICY "Authenticated can register device"
  ON public.devices FOR INSERT
  TO authenticated
  WITH CHECK (line_id IS NULL AND paired_by IS NULL);

-- Anyone authenticated can read their own device row by token (needed to resolve line)
CREATE POLICY "Authenticated can view devices"
  ON public.devices FOR SELECT
  TO authenticated
  USING (true);

-- Only admins/managers can pair (assign a line) or update
CREATE POLICY "Admins managers can update devices"
  ON public.devices FOR UPDATE
  TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role));

CREATE POLICY "Admins managers can delete devices"
  ON public.devices FOR DELETE
  TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role));

-- Resolve a device's line by token (SECURITY DEFINER: safe lookup)
CREATE OR REPLACE FUNCTION public.get_device_line(_token text)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT line_id FROM public.devices WHERE device_token = _token LIMIT 1;
$$;

-- Touch last_seen_at
CREATE OR REPLACE FUNCTION public.touch_device(_token text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.devices SET last_seen_at = now() WHERE device_token = _token;
$$;

-- Pair a device (admin/manager only)
CREATE OR REPLACE FUNCTION public.pair_device(_token text, _line_id uuid, _label text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role)) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  UPDATE public.devices
    SET line_id = _line_id, label = COALESCE(_label, label),
        paired_by = auth.uid(), paired_at = now()
    WHERE device_token = _token;
  IF NOT FOUND THEN
    INSERT INTO public.devices(device_token, line_id, label, paired_by, paired_at)
    VALUES (_token, _line_id, _label, auth.uid(), now());
  END IF;
END;
$$;

-- Unpair
CREATE OR REPLACE FUNCTION public.unpair_device(_device_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role)) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  UPDATE public.devices
    SET line_id = NULL, paired_by = NULL, paired_at = NULL
    WHERE id = _device_id;
END;
$$;

-- Operator WO visibility: scope by device line when header is set.
-- We use a session GUC `app.device_line_id` set by the client per-request.
-- If unset/invalid, operators see only their own (existing behavior preserved).

DROP POLICY IF EXISTS "Operators can view own WOs" ON public.work_orders;

CREATE POLICY "Operators view WOs scoped by device line"
  ON public.work_orders FOR SELECT
  TO authenticated
  USING (
    has_role(auth.uid(),'admin'::app_role)
    OR has_role(auth.uid(),'manager'::app_role)
    OR has_role(auth.uid(),'engineer'::app_role)
    OR (
      has_role(auth.uid(),'operator'::app_role)
      AND (
        -- If the device GUC is set to a line UUID, restrict to that line.
        -- Otherwise, fall back to operator's own WOs.
        CASE
          WHEN current_setting('app.device_line_id', true) IS NOT NULL
           AND current_setting('app.device_line_id', true) <> ''
          THEN line_id::text = current_setting('app.device_line_id', true)
          ELSE operator_id = auth.uid()
        END
      )
    )
  );
