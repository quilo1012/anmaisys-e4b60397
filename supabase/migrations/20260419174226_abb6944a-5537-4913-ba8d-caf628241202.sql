-- 1. Restrict profiles.pin column read access (only owner/admin via SECURITY DEFINER funcs should access)
REVOKE SELECT (pin) ON public.profiles FROM authenticated;
REVOKE SELECT (pin) ON public.profiles FROM anon;

-- 2. Re-confirm engineers.pin_hash is locked down (idempotent)
REVOKE SELECT (pin_hash) ON public.engineers FROM authenticated;
REVOKE SELECT (pin_hash) ON public.engineers FROM anon;

-- 3. Prevent engineers from forging work_order_logs entries
DROP POLICY IF EXISTS "Authenticated can insert work_order_logs" ON public.work_order_logs;
CREATE POLICY "Authenticated can insert work_order_logs"
ON public.work_order_logs
FOR INSERT
TO authenticated
WITH CHECK (
  engineer_id = auth.uid()
  AND (has_role(auth.uid(), 'engineer'::app_role) OR has_role(auth.uid(), 'admin'::app_role))
);