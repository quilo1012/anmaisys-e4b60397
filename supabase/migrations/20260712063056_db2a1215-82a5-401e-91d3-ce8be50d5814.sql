
-- production_sessions: allow maintenance_manager in addition to admin/manager
DROP POLICY IF EXISTS "production_sessions insert admin/manager" ON public.production_sessions;
DROP POLICY IF EXISTS "production_sessions update admin/manager" ON public.production_sessions;
DROP POLICY IF EXISTS "production_sessions delete admin/manager" ON public.production_sessions;

CREATE POLICY "production_sessions insert admin/manager" ON public.production_sessions
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'manager') OR has_role(auth.uid(),'maintenance_manager'));

CREATE POLICY "production_sessions update admin/manager" ON public.production_sessions
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'manager') OR has_role(auth.uid(),'maintenance_manager'))
  WITH CHECK (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'manager') OR has_role(auth.uid(),'maintenance_manager'));

CREATE POLICY "production_sessions delete admin/manager" ON public.production_sessions
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'manager') OR has_role(auth.uid(),'maintenance_manager'));

-- production_items: same widening
DROP POLICY IF EXISTS "production_items insert admin/manager" ON public.production_items;
DROP POLICY IF EXISTS "production_items update admin/manager" ON public.production_items;
DROP POLICY IF EXISTS "production_items delete admin/manager" ON public.production_items;

CREATE POLICY "production_items insert admin/manager" ON public.production_items
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'manager') OR has_role(auth.uid(),'maintenance_manager'));

CREATE POLICY "production_items update admin/manager" ON public.production_items
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'manager') OR has_role(auth.uid(),'maintenance_manager'))
  WITH CHECK (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'manager') OR has_role(auth.uid(),'maintenance_manager'));

CREATE POLICY "production_items delete admin/manager" ON public.production_items
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'manager') OR has_role(auth.uid(),'maintenance_manager'));
