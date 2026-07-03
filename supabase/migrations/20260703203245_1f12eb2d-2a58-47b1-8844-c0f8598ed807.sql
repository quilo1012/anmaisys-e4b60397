
-- 1. downtime: tighten INSERT check for engineers/managers to require reported_by = auth.uid()
DROP POLICY IF EXISTS "Engineers can create downtime" ON public.downtime;
CREATE POLICY "Engineers can create downtime" ON public.downtime
  FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'engineer'::app_role)
    AND (reported_by IS NULL OR reported_by = auth.uid())
  );

-- 2. Retarget 'public' role policies to 'authenticated' for machines/products/parts_used/intouch_machine_map/leader_pins

-- machines
DROP POLICY IF EXISTS "Admins can manage machines" ON public.machines;
CREATE POLICY "Admins can manage machines" ON public.machines
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));

DROP POLICY IF EXISTS "Authenticated can view machines" ON public.machines;
CREATE POLICY "Authenticated can view machines" ON public.machines
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(),'operator'::app_role)
    OR has_role(auth.uid(),'engineer'::app_role)
    OR has_role(auth.uid(),'admin'::app_role)
    OR has_role(auth.uid(),'manager'::app_role)
    OR has_role(auth.uid(),'maintenance_manager'::app_role)
    OR has_role(auth.uid(),'viewer'::app_role)
  );

-- products
DROP POLICY IF EXISTS "Admins can delete products" ON public.products;
CREATE POLICY "Admins can delete products" ON public.products
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role));

DROP POLICY IF EXISTS "Admins can insert products" ON public.products;
CREATE POLICY "Admins can insert products" ON public.products
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));

DROP POLICY IF EXISTS "Admins can update products" ON public.products;
CREATE POLICY "Admins can update products" ON public.products
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role));

DROP POLICY IF EXISTS "Engineers and admins can view products" ON public.products;
CREATE POLICY "Engineers and admins can view products" ON public.products
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(),'engineer'::app_role)
    OR has_role(auth.uid(),'admin'::app_role)
    OR has_role(auth.uid(),'manager'::app_role)
    OR has_role(auth.uid(),'maintenance_manager'::app_role)
  );

-- parts_used
DROP POLICY IF EXISTS "Engineers and admins can insert parts used" ON public.parts_used;
CREATE POLICY "Engineers and admins can insert parts used" ON public.parts_used
  FOR INSERT TO authenticated
  WITH CHECK (
    (engineer_id = auth.uid())
    AND (has_role(auth.uid(),'engineer'::app_role) OR has_role(auth.uid(),'admin'::app_role))
  );

DROP POLICY IF EXISTS "Engineers can view own parts used" ON public.parts_used;
CREATE POLICY "Engineers can view own parts used" ON public.parts_used
  FOR SELECT TO authenticated
  USING ((engineer_id = auth.uid()) OR has_role(auth.uid(),'admin'::app_role));

-- intouch_machine_map
DROP POLICY IF EXISTS "admins/managers manage intouch map" ON public.intouch_machine_map;
CREATE POLICY "admins/managers manage intouch map" ON public.intouch_machine_map
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role));

DROP POLICY IF EXISTS "authenticated read intouch map" ON public.intouch_machine_map;
CREATE POLICY "authenticated read intouch map" ON public.intouch_machine_map
  FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

-- leader_pins
DROP POLICY IF EXISTS "Admins manage leader_pins" ON public.leader_pins;
CREATE POLICY "Admins manage leader_pins" ON public.leader_pins
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));

-- 3. pm_executions: restrict INSERT to admin/manager/maintenance_manager/engineer and require done_by = auth.uid()
DROP POLICY IF EXISTS "PM executions insertable by all auth" ON public.pm_executions;
CREATE POLICY "PM executions insertable by engineers/managers/admins" ON public.pm_executions
  FOR INSERT TO authenticated
  WITH CHECK (
    (done_by = auth.uid())
    AND (
      has_role(auth.uid(),'admin'::app_role)
      OR has_role(auth.uid(),'manager'::app_role)
      OR has_role(auth.uid(),'maintenance_manager'::app_role)
      OR has_role(auth.uid(),'engineer'::app_role)
    )
  );

-- 4. problem_descriptions: retarget to authenticated
DROP POLICY IF EXISTS "Admins can manage problem_descriptions" ON public.problem_descriptions;
CREATE POLICY "Admins can manage problem_descriptions" ON public.problem_descriptions
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));

DROP POLICY IF EXISTS "Authenticated can view problem_descriptions" ON public.problem_descriptions;
CREATE POLICY "Authenticated can view problem_descriptions" ON public.problem_descriptions
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(),'operator'::app_role)
    OR has_role(auth.uid(),'engineer'::app_role)
    OR has_role(auth.uid(),'admin'::app_role)
    OR has_role(auth.uid(),'manager'::app_role)
    OR has_role(auth.uid(),'maintenance_manager'::app_role)
  );

-- 5. profiles: prevent non-admin from modifying labor_rate via trigger
CREATE OR REPLACE FUNCTION public.guard_profile_labor_rate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.labor_rate IS DISTINCT FROM OLD.labor_rate THEN
    IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
      RAISE EXCEPTION 'Only admins may modify labor_rate';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_profile_labor_rate ON public.profiles;
CREATE TRIGGER trg_guard_profile_labor_rate
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_profile_labor_rate();
