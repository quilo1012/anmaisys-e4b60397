-- The same rules, asked once per query instead of once per row.
--
-- Measured on production, 349 work orders, the query the orders list actually runs:
--
--   as service role (no RLS)   0.4 ms      181 buffers
--   as an authenticated user   89.1 ms   3,935 buffers
--
-- Two hundred and twenty times slower, and the plan says why: every has_role() call
-- in every policy is evaluated per row, and the two policies with an EXISTS against
-- operator_line_accounts run a scan 338 times — once per order. The work order
-- screen fires twelve queries, so this is paid twelve times over on every open.
--
-- It also grows with the table. At 349 orders it is 89 ms; the cost is linear, so at
-- 3,500 it is nearly a second, per query.
--
-- The fix is the wrapping, not the rules. auth.uid() and has_role() do not depend on
-- the row, so `(SELECT has_role(...))` lets Postgres hoist them into an InitPlan
-- evaluated once. THE BOOLEAN LOGIC BELOW IS UNCHANGED, clause for clause, from what
-- pg_policies reported before this migration — who can see what is identical, and
-- that is the only thing that matters when touching a permissions table.
--
-- An index on operator_line_accounts(user_id) is added too. On its own it took the
-- query from 89 ms to 65 ms; the table holds ten rows, so the planner still prefers a
-- scan, and the wrapping is what removes the repetition.

CREATE INDEX IF NOT EXISTS operator_line_accounts_user_idx
  ON public.operator_line_accounts (user_id);

-- ---------------------------------------------------------------- simple role reads
DROP POLICY IF EXISTS "Admins can view all WOs" ON public.work_orders;
CREATE POLICY "Admins can view all WOs" ON public.work_orders FOR SELECT
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)));

DROP POLICY IF EXISTS "Engineers can view WOs" ON public.work_orders;
CREATE POLICY "Engineers can view WOs" ON public.work_orders FOR SELECT
  USING ((SELECT public.has_role((SELECT auth.uid()), 'engineer'::app_role)));

DROP POLICY IF EXISTS "Managers can view WOs" ON public.work_orders;
CREATE POLICY "Managers can view WOs" ON public.work_orders FOR SELECT
  USING ((SELECT public.has_role((SELECT auth.uid()), 'manager'::app_role)));

DROP POLICY IF EXISTS "Maintenance managers can view WOs" ON public.work_orders;
CREATE POLICY "Maintenance managers can view WOs" ON public.work_orders FOR SELECT
  USING ((SELECT public.has_role((SELECT auth.uid()), 'maintenance_manager'::app_role)));

DROP POLICY IF EXISTS supervisor_read_access ON public.work_orders;
CREATE POLICY supervisor_read_access ON public.work_orders FOR SELECT
  USING ((SELECT public.has_role((SELECT auth.uid()), 'supervisor'::app_role)));

DROP POLICY IF EXISTS "Anplanner leaders can view their own WOs" ON public.work_orders;
CREATE POLICY "Anplanner leaders can view their own WOs" ON public.work_orders FOR SELECT
  USING (
    (SELECT public.has_role((SELECT auth.uid()), 'operator'::app_role))
    AND operator_id = (SELECT auth.uid())
  );

-- ------------------------------------------------------- warehouse service requests
DROP POLICY IF EXISTS "Warehouse can view warehouse_service WOs" ON public.work_orders;
CREATE POLICY "Warehouse can view warehouse_service WOs" ON public.work_orders FOR SELECT
  USING (
    (SELECT EXISTS (
      SELECT 1 FROM public.user_roles ur
       WHERE ur.user_id = (SELECT auth.uid()) AND ur.role::text = 'warehouse'
    ))
    AND wo_type = 'warehouse_service'
  );

-- ------------------------------------------------------------------- line scoping
-- The two expensive ones. Only the row-dependent halves — operator_id, line_id and
-- the line_ids membership — stay per row; everything else is hoisted.
DROP POLICY IF EXISTS "Operators strictly scoped to own line" ON public.work_orders;
CREATE POLICY "Operators strictly scoped to own line" ON public.work_orders FOR SELECT
  USING (
    (SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role))
    OR (SELECT public.has_role((SELECT auth.uid()), 'manager'::app_role))
    OR (SELECT public.has_role((SELECT auth.uid()), 'engineer'::app_role))
    OR NOT (SELECT public.has_role((SELECT auth.uid()), 'operator'::app_role))
    OR operator_id = (SELECT auth.uid())
    OR (line_id IS NOT NULL AND line_id = ANY ((SELECT public.current_device_line_ids())))
    OR (line_id IS NOT NULL AND line_id = ANY (
      SELECT unnest(ola.line_ids) FROM public.operator_line_accounts ola
       WHERE ola.user_id = (SELECT auth.uid())
    ))
  );

DROP POLICY IF EXISTS "Operators view own or assigned-line WOs" ON public.work_orders;
CREATE POLICY "Operators view own or assigned-line WOs" ON public.work_orders FOR SELECT
  USING (
    (SELECT public.has_role((SELECT auth.uid()), 'operator'::app_role))
    AND NOT (SELECT public.has_role((SELECT auth.uid()), 'engineer'::app_role))
    AND NOT (SELECT public.has_role((SELECT auth.uid()), 'manager'::app_role))
    AND NOT (SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role))
    AND (
      operator_id = (SELECT auth.uid())
      OR (line_id IS NOT NULL AND line_id = ANY (
        SELECT unnest(ola.line_ids) FROM public.operator_line_accounts ola
         WHERE ola.user_id = (SELECT auth.uid())
      ))
      OR (line_id IS NOT NULL AND line_id = ANY ((SELECT public.current_device_line_ids())))
    )
  );

-- ------------------------------------------------------------------ office admin
DROP POLICY IF EXISTS office_admin_all ON public.work_orders;
DROP POLICY IF EXISTS "office_admin all" ON public.work_orders;
CREATE POLICY "office_admin all" ON public.work_orders FOR ALL
  USING ((SELECT public.has_role((SELECT auth.uid()), 'production_office_admin'::app_role)))
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'production_office_admin'::app_role)));

-- ------------------------------------------------------------- duplicate indexes
-- Identical pairs, each one paid for on every insert and update of a work order and
-- never read. Kept the older name of each pair.
DROP INDEX IF EXISTS public.idx_work_orders_created_at;   -- same as idx_work_orders_created
DROP INDEX IF EXISTS public.idx_work_orders_engineer_id;  -- same as idx_work_orders_engineer
DROP INDEX IF EXISTS public.idx_work_orders_operator_id;  -- same as idx_work_orders_operator
