-- 1) Helper: read x-device-token from request headers (safe / null on missing)
CREATE OR REPLACE FUNCTION public.current_device_token()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NULLIF(
    current_setting('request.headers', true)::json ->> 'x-device-token',
    ''
  );
$$;

-- 2) Helper: resolve current device's paired line_id (null if unpaired/missing)
CREATE OR REPLACE FUNCTION public.current_device_line()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT d.line_id
  FROM public.devices d
  WHERE d.device_token = public.current_device_token()
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.current_device_token() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_device_line() TO authenticated;

-- 3) Replace operator policies on work_orders to enforce device-line isolation

-- SELECT: operators must match device line; others keep their access
DROP POLICY IF EXISTS "Operators can view own WOs" ON public.work_orders;

CREATE POLICY "Operators view own line WOs (device-scoped)"
ON public.work_orders
FOR SELECT
TO authenticated
USING (
  -- Admins/managers/engineers keep broad access (other policies still apply)
  has_role(auth.uid(), 'engineer'::app_role)
  OR has_role(auth.uid(), 'admin'::app_role)
  OR (
    -- Operator: must be paired AND order belongs to the paired line
    has_role(auth.uid(), 'operator'::app_role)
    AND public.current_device_line() IS NOT NULL
    AND work_orders.line_id = public.current_device_line()
    AND operator_id = auth.uid()
  )
);

-- INSERT: operators can only create on their device's line
DROP POLICY IF EXISTS "Operators can create WOs" ON public.work_orders;

CREATE POLICY "Operators create WOs on device line"
ON public.work_orders
FOR INSERT
TO authenticated
WITH CHECK (
  operator_id = auth.uid()
  AND has_role(auth.uid(), 'operator'::app_role)
  AND public.current_device_line() IS NOT NULL
  AND line_id = public.current_device_line()
);
