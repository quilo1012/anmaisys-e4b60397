
-- Helper: line names accessible to current user
CREATE OR REPLACE FUNCTION public.current_user_line_names()
RETURNS text[]
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(DISTINCT l.name), ARRAY[]::text[])
  FROM public.operator_line_accounts ola
  JOIN public.lines l ON l.id = ANY(ola.line_ids)
  WHERE ola.user_id = auth.uid();
$$;

-- 1) intouch_machine_map: restrict SELECT
DROP POLICY IF EXISTS "authenticated read intouch map" ON public.intouch_machine_map;
CREATE POLICY "staff read intouch map" ON public.intouch_machine_map
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(),'admin'::app_role)
    OR has_role(auth.uid(),'manager'::app_role)
    OR has_role(auth.uid(),'maintenance_manager'::app_role)
    OR has_role(auth.uid(),'engineer'::app_role)
  );

-- 2) mobile_assets: restrict SELECT to real staff roles
DROP POLICY IF EXISTS "Authenticated can view mobile_assets" ON public.mobile_assets;
CREATE POLICY "Staff can view mobile_assets" ON public.mobile_assets
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(),'admin'::app_role)
    OR has_role(auth.uid(),'manager'::app_role)
    OR has_role(auth.uid(),'maintenance_manager'::app_role)
    OR has_role(auth.uid(),'engineer'::app_role)
    OR has_role(auth.uid(),'operator'::app_role)
  );

-- 3) production_items: scope SELECT by line
DROP POLICY IF EXISTS "production_items read all auth" ON public.production_items;
CREATE POLICY "production_items scoped read" ON public.production_items
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(),'admin'::app_role)
    OR has_role(auth.uid(),'manager'::app_role)
    OR has_role(auth.uid(),'maintenance_manager'::app_role)
    OR has_role(auth.uid(),'engineer'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.production_sessions ps
      WHERE ps.id = production_items.session_id
        AND ps.line = ANY(public.current_user_line_names())
    )
  );

-- 4) quality_actions: scope SELECT by line
DROP POLICY IF EXISTS "quality_actions read all auth" ON public.quality_actions;
CREATE POLICY "quality_actions scoped read" ON public.quality_actions
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(),'admin'::app_role)
    OR has_role(auth.uid(),'manager'::app_role)
    OR has_role(auth.uid(),'maintenance_manager'::app_role)
    OR has_role(auth.uid(),'engineer'::app_role)
    OR quality_actions.line = ANY(public.current_user_line_names())
  );

-- 5) profiles.labor_rate column-level: revoke from authenticated so managers
--    cannot read this PII column directly. Admins access via
--    get_profile_labor_rate() (SECURITY DEFINER); users read own via get_own_labor_rate().
REVOKE SELECT (labor_rate) ON public.profiles FROM authenticated;
REVOKE SELECT (labor_rate) ON public.profiles FROM anon;

-- 6) user_roles: enforce one role per user to block manager role-escalation races
DELETE FROM public.user_roles a
USING public.user_roles b
WHERE a.user_id = b.user_id AND a.ctid < b.ctid;

ALTER TABLE public.user_roles
  DROP CONSTRAINT IF EXISTS user_roles_user_id_key;
ALTER TABLE public.user_roles
  ADD CONSTRAINT user_roles_user_id_key UNIQUE (user_id);
