-- 20260728020000 is called `office_admin_broad_access`. It was not broad enough.
--
-- `production_office_admin` arrived on 28/07 with a matrix entry, a menu, and a
-- migration granting it access. That migration covered `work_orders` and
-- `production_targets` and stopped. Five tables it was given rights to in the matrix
-- never heard of it: machines, line_leaders, mobile_assets, problem_descriptions and
-- products.
--
-- These are not five independent oversights. They are one migration that stopped
-- halfway, and the symptom has been the same on all five for a month: the switch on
-- the Permissions page is on, the menu draws the screen, the person clicks Save and
-- gets an RLS refusal. A button that fails with a Postgres error is not a finished
-- system.
--
-- The write policies are replaced rather than added to. Each table had one policy per
-- role — "Admins can manage machines", "Managers can manage machines", "Supervisors
-- can manage machines" — which is the same hand-written second list of roles that
-- `has_action` exists to remove, and adding a sixth policy would have grown it. One
-- policy per table now, reading the Permissions page.
--
-- TWO ROLES BEYOND production_office_admin MOVE, and they are named here rather than
-- worked around:
--
--   * mobile_assets gains maintenance_manager
--   * problem_descriptions gains supervisor
--
-- Both hold those actions in the matrix and have been refused by the database since
-- the tables were made. The alternative was a baseline of "whatever the old policies
-- happened to allow, plus one role", which is a third list agreeing with neither the
-- matrix nor the policies — exactly the defect being removed. The matrix is the
-- baseline, or there is no point.
--
-- SELECT policies are untouched: who may READ these tables is a separate question and
-- this migration does not answer it. `products` keeps its admin-only DELETE, because
-- deleting a part is not `stock.manage` and StockPage already says so.

-- machines — machines.manage
DROP POLICY IF EXISTS "Admins can manage machines" ON public.machines;
DROP POLICY IF EXISTS "Managers can manage machines" ON public.machines;
DROP POLICY IF EXISTS "Supervisors can manage machines" ON public.machines;
CREATE POLICY "machines write by matrix" ON public.machines
  FOR ALL TO authenticated
  USING (public.has_action(auth.uid(), 'machines.manage',
         ARRAY['admin','manager','supervisor','production_office_admin']::app_role[]))
  WITH CHECK (public.has_action(auth.uid(), 'machines.manage',
         ARRAY['admin','manager','supervisor','production_office_admin']::app_role[]));

-- line_leaders — leaders.manage
DROP POLICY IF EXISTS "line_leaders_write_mgr" ON public.line_leaders;
CREATE POLICY "line_leaders write by matrix" ON public.line_leaders
  FOR ALL TO authenticated
  USING (public.has_action(auth.uid(), 'leaders.manage',
         ARRAY['admin','manager','production_office_admin']::app_role[]))
  WITH CHECK (public.has_action(auth.uid(), 'leaders.manage',
         ARRAY['admin','manager','production_office_admin']::app_role[]));

-- mobile_assets — assets.manage (also restores maintenance_manager)
DROP POLICY IF EXISTS "Admins manage mobile_assets" ON public.mobile_assets;
DROP POLICY IF EXISTS "Managers manage mobile_assets" ON public.mobile_assets;
CREATE POLICY "mobile_assets write by matrix" ON public.mobile_assets
  FOR ALL TO authenticated
  USING (public.has_action(auth.uid(), 'assets.manage',
         ARRAY['admin','manager','maintenance_manager','production_office_admin']::app_role[]))
  WITH CHECK (public.has_action(auth.uid(), 'assets.manage',
         ARRAY['admin','manager','maintenance_manager','production_office_admin']::app_role[]));

-- problem_descriptions — problems.manage (also restores supervisor)
DROP POLICY IF EXISTS "Admins can manage problem_descriptions" ON public.problem_descriptions;
DROP POLICY IF EXISTS "Managers can manage problem_descriptions" ON public.problem_descriptions;
CREATE POLICY "problem_descriptions write by matrix" ON public.problem_descriptions
  FOR ALL TO authenticated
  USING (public.has_action(auth.uid(), 'problems.manage',
         ARRAY['admin','manager','supervisor','production_office_admin']::app_role[]))
  WITH CHECK (public.has_action(auth.uid(), 'problems.manage',
         ARRAY['admin','manager','supervisor','production_office_admin']::app_role[]));

-- products — stock.manage. INSERT and UPDATE only: DELETE stays admin-only, and the
-- price column stays behind stock.pricing (20260831090000).
DROP POLICY IF EXISTS "Admins can insert products" ON public.products;
DROP POLICY IF EXISTS "Admins can update products" ON public.products;
DROP POLICY IF EXISTS "Managers can insert products" ON public.products;
DROP POLICY IF EXISTS "Managers can update products" ON public.products;
DROP POLICY IF EXISTS "Maint mgr and supervisor insert products" ON public.products;
DROP POLICY IF EXISTS "Maint mgr and supervisor update products" ON public.products;
CREATE POLICY "products insert by matrix" ON public.products
  FOR INSERT TO authenticated
  WITH CHECK (public.has_action(auth.uid(), 'stock.manage',
         ARRAY['admin','manager','supervisor','maintenance_manager','production_office_admin']::app_role[]));
CREATE POLICY "products update by matrix" ON public.products
  FOR UPDATE TO authenticated
  USING (public.has_action(auth.uid(), 'stock.manage',
         ARRAY['admin','manager','supervisor','maintenance_manager','production_office_admin']::app_role[]))
  WITH CHECK (public.has_action(auth.uid(), 'stock.manage',
         ARRAY['admin','manager','supervisor','maintenance_manager','production_office_admin']::app_role[]));
