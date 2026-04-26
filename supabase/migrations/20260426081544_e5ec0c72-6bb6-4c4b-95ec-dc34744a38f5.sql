
-- 1) Restrict managers from reading the labor_rate column on profiles.
-- Strategy: revoke column-level SELECT on labor_rate for the authenticated role,
-- and re-grant SELECT on all other profile columns. Admins continue to read
-- labor rates through the SECURITY DEFINER RPCs (list_profile_labor_rates,
-- get_profile_labor_rate). Owners can still read their own labor_rate via
-- the get_own_labor_rate() SECURITY DEFINER function.

REVOKE SELECT ON public.profiles FROM authenticated;

GRANT SELECT
  (id, name, email, active, created_at, updated_at, last_seen_at,
   shift, ui_preferences)
  ON public.profiles TO authenticated;

-- Keep INSERT/UPDATE behaviour unchanged (RLS still applies on top of grants).
GRANT INSERT, UPDATE ON public.profiles TO authenticated;

-- 2) Scope SELECT on work_order_logs so that:
--    - admins, managers, engineers see all logs (operational visibility)
--    - operators only see logs for work orders they created / are linked to
DROP POLICY IF EXISTS "Authenticated can view work_order_logs" ON public.work_order_logs;

CREATE POLICY "Scoped work_order_logs select"
ON public.work_order_logs
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'manager'::app_role)
  OR has_role(auth.uid(), 'engineer'::app_role)
  OR EXISTS (
    SELECT 1 FROM public.work_orders wo
    WHERE wo.id = work_order_logs.work_order_id
      AND (
        wo.operator_id = auth.uid()
        OR wo.engineer_id = auth.uid()
        OR wo.locked_engineer_id = auth.uid()
      )
  )
);
