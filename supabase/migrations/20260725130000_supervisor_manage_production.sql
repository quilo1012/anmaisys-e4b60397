-- Production Control lets admin/manager import sessions, correct the SKU on a
-- line, and edit actuals. The supervisor now gets the same on the frontend, but
-- every write is gated to admin/manager/maintenance_manager in the database, so
-- the inline edits and import would fail for them. Widen the write policies on
-- production_sessions and production_items to include supervisor.
--
-- Operator's own-line policies are untouched.

-- ── production_sessions ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "production_sessions insert admin/manager" ON public.production_sessions;
CREATE POLICY "production_sessions insert admin/manager/supervisor"
  ON public.production_sessions FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role)
    OR has_role(auth.uid(), 'maintenance_manager'::app_role) OR has_role(auth.uid(), 'supervisor'::app_role)
  );

DROP POLICY IF EXISTS "production_sessions update admin/manager" ON public.production_sessions;
CREATE POLICY "production_sessions update admin/manager/supervisor"
  ON public.production_sessions FOR UPDATE TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role)
    OR has_role(auth.uid(), 'maintenance_manager'::app_role) OR has_role(auth.uid(), 'supervisor'::app_role)
  )
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role)
    OR has_role(auth.uid(), 'maintenance_manager'::app_role) OR has_role(auth.uid(), 'supervisor'::app_role)
  );

-- ── production_items ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "production_items insert admin/manager" ON public.production_items;
CREATE POLICY "production_items insert admin/manager/supervisor"
  ON public.production_items FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role)
    OR has_role(auth.uid(), 'maintenance_manager'::app_role) OR has_role(auth.uid(), 'supervisor'::app_role)
  );

DROP POLICY IF EXISTS "production_items update admin/manager" ON public.production_items;
CREATE POLICY "production_items update admin/manager/supervisor"
  ON public.production_items FOR UPDATE TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role)
    OR has_role(auth.uid(), 'maintenance_manager'::app_role) OR has_role(auth.uid(), 'supervisor'::app_role)
  )
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role)
    OR has_role(auth.uid(), 'maintenance_manager'::app_role) OR has_role(auth.uid(), 'supervisor'::app_role)
  );

-- Correcting a wrongly imported line means removing it, so supervisor gets delete too.
DROP POLICY IF EXISTS "production_items delete admin/manager" ON public.production_items;
CREATE POLICY "production_items delete admin/manager/supervisor"
  ON public.production_items FOR DELETE TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role)
    OR has_role(auth.uid(), 'maintenance_manager'::app_role) OR has_role(auth.uid(), 'supervisor'::app_role)
  );
