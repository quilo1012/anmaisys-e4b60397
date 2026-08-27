-- The Permissions screen edits a matrix that 128 of 134 tables never consult.
--
-- `has_action(uid, action, baseline)` is the mechanism this project already has for
-- exactly this: it reads the user's roles, applies whatever `role_permission_overrides`
-- says — the table the Permissions screen writes — and only falls back to the baseline
-- list when there is no override. Admin is always true.
--
-- Counted on 26/08/2026:
--
--   policies in public                                    436
--     consulting the matrix via has_action()                7   across   6 tables
--     carrying a hard-coded list of has_role() ORs        365   across 128 tables
--
--   rows in role_permission_overrides                      62
--
-- So sixty-two decisions were made on that screen, and the database honours the ones
-- that happen to land on six tables. Everywhere else the screen changes what the UI
-- draws and the database goes on deciding from a list frozen into a policy months ago.
--
-- IT FAILS IN BOTH DIRECTIONS, and neither says anything:
--
--   supervisor / stock.view = FALSE      the screen hides Stock from supervisors, and
--                                        `supervisor_read_access` on products keeps
--                                        letting them read all 137 parts through the API
--
--   co_engineer / stock.view (baseline)  the matrix grants it and the route admits them,
--                                        and NO select policy on products names
--                                        co_engineer — so the screen opens and shows
--                                        nothing
--
-- The second shape is the one that hides best. A restrictive SELECT policy does not
-- raise; it returns zero rows. `describeError` reacts to 401, 403 and 42501, so nothing
-- in the app can tell "you have no access" apart from "there is nothing here" — the
-- screen just looks like an empty table. planner on machines, downtime and problems, and
-- supervisor on suppliers, have all been sitting in that state.
--
-- WHY NOT JUST ADD THE MISSING ROLES. Adding `planner` to three policies and
-- `co_engineer` to one fixes today's four and leaves the mechanism that produced them
-- exactly as it was: two copies of one decision, one in TypeScript and one frozen in
-- SQL, with nothing keeping them in step. The next role added to the matrix drifts the
-- same way, silently, and is found the same way — by somebody staring at an empty
-- screen.
--
-- So the five tables behind those four symptoms are converted to read the matrix. The
-- baselines below are copied from `MATRIX` in src/lib/permissions.ts, so the fallback and
-- the UI now say the same thing, and an override moves both together.
--
-- SCOPE, said plainly: five tables of 128. This is the pattern for the rest, not the
-- rest. The remaining 123 are listed in the audit and are a bigger, separate job — one
-- that has to be done table by table, because each carries its own ownership clauses
-- that a blanket conversion would drop.

-- =====================================================================
-- 1. products — the Stock catalogue
--
-- Five overlapping select policies replaced by one. Writes already go through
-- has_action('stock.manage'), so this makes reads consistent with them.
-- =====================================================================

DROP POLICY IF EXISTS "Engineers and admins can view products" ON public.products;
DROP POLICY IF EXISTS "Managers can view products" ON public.products;
DROP POLICY IF EXISTS "Planner and warehouse view products" ON public.products;
DROP POLICY IF EXISTS "office_admin read" ON public.products;
DROP POLICY IF EXISTS "supervisor_read_access" ON public.products;

CREATE POLICY "products select by matrix" ON public.products
  FOR SELECT TO authenticated
  USING (has_action(auth.uid(), 'stock.view', ARRAY['admin'::app_role, 'manager'::app_role, 'supervisor'::app_role, 'maintenance_manager'::app_role, 'planner'::app_role, 'engineer'::app_role, 'co_engineer'::app_role, 'warehouse'::app_role, 'production_office_admin'::app_role]));

-- =====================================================================
-- 2. machines
-- =====================================================================

DROP POLICY IF EXISTS "Authenticated can view machines" ON public.machines;
DROP POLICY IF EXISTS "supervisor_read_access" ON public.machines;

CREATE POLICY "machines select by matrix" ON public.machines
  FOR SELECT TO authenticated
  USING (has_action(auth.uid(), 'machines.view', ARRAY['admin'::app_role, 'manager'::app_role, 'supervisor'::app_role, 'maintenance_manager'::app_role, 'planner'::app_role, 'engineer'::app_role, 'co_engineer'::app_role, 'operator'::app_role, 'viewer'::app_role, 'warehouse'::app_role, 'production_office_admin'::app_role]));

-- The warehouse policy was FOR ALL, so it granted UPDATE and DELETE on every machine to a
-- role whose only machine permission in the matrix is `machines.view`. The screen never
-- offered it; the API did. Reduced to what the name always implied.
DROP POLICY IF EXISTS "Warehouse can manage machines" ON public.machines;

-- =====================================================================
-- 3. problem_descriptions
-- =====================================================================

DROP POLICY IF EXISTS "Authenticated can view problem_descriptions" ON public.problem_descriptions;
DROP POLICY IF EXISTS "supervisor_read_access" ON public.problem_descriptions;

CREATE POLICY "problem_descriptions select by matrix" ON public.problem_descriptions
  FOR SELECT TO authenticated
  USING (has_action(auth.uid(), 'problems.view', ARRAY['admin'::app_role, 'manager'::app_role, 'supervisor'::app_role, 'maintenance_manager'::app_role, 'planner'::app_role, 'engineer'::app_role, 'co_engineer'::app_role, 'operator'::app_role, 'viewer'::app_role, 'production_office_admin'::app_role]));

-- =====================================================================
-- 4. suppliers
--
-- FOUR ROLES LOSE READ ACCESS HERE, and each was checked before it was allowed to:
--
--   maintenance_manager   1 user   override suppliers.view = FALSE  — the screen already
--   production_office_admin 0      override suppliers.view = FALSE     said no; only the
--   supervisor (products)   0      override stock.view = FALSE         API disagreed
--
--   warehouse             1 user   NO override. `suppliers_select_scoped` named it; the
--                                  matrix never granted `suppliers.view` and the route
--                                  never admitted it. Checked what would break: the only
--                                  reader of this table anywhere in src/ is
--                                  SuppliersPage, which that role cannot open. So this
--                                  removes an API-only privilege that no screen has ever
--                                  used, rather than taking a feature away.
--
-- The first three are the point of the change: an override that says no is supposed to
-- mean no, and until now it only meant "hide the menu item".
-- =====================================================================

DROP POLICY IF EXISTS "suppliers_select_scoped" ON public.suppliers;

CREATE POLICY "suppliers select by matrix" ON public.suppliers
  FOR SELECT TO authenticated
  USING (has_action(auth.uid(), 'suppliers.view', ARRAY['admin'::app_role, 'manager'::app_role, 'supervisor'::app_role, 'maintenance_manager'::app_role, 'planner'::app_role, 'production_office_admin'::app_role]));

-- =====================================================================
-- 5. downtime_events — the one with an ownership clause to keep
--
-- The old policy granted four roles by name, PLUS anyone who stopped or resumed the line
-- themselves, PLUS an operator on the order's own line. Those three are not role
-- permissions and cannot come from the matrix: an operator sees their own line's
-- stoppages because it is theirs, not because of a permission somebody could switch off.
--
-- Carried over verbatim, with only the role half replaced. A blanket conversion here
-- would have taken every operator's own downtime away from them.
--
-- AND THE BASELINE IS NOT THE MATRIX HERE, which is the one deliberate departure in this
-- file. `downtime.view` is granted to every role including operator and viewer, because
-- it gates the Downtime SCREEN — and the route already keeps operators out of that
-- screen. Copying it into the baseline would have handed all twelve operator accounts
-- read access to every stoppage on every line through the API, which no screen offers
-- and nothing asked for. Simulated before writing: operator and viewer both flipped from
-- no-access to full-access on this table alone.
--
-- So the baseline is the management set — the roles the Downtime route actually admits,
-- plus engineer and co_engineer who read stoppages from the order detail — and operators
-- keep reaching their own through the ownership clause below, exactly as before. This is
-- the one table in this migration where "who may open the screen" and "which rows may be
-- read" are genuinely different questions.
-- =====================================================================

DROP POLICY IF EXISTS "Scoped downtime_events select" ON public.downtime_events;
DROP POLICY IF EXISTS "supervisor_read_access" ON public.downtime_events;

CREATE POLICY "downtime_events select by matrix or ownership" ON public.downtime_events
  FOR SELECT TO authenticated
  USING (
    has_action(auth.uid(), 'downtime.view', ARRAY['admin'::app_role, 'manager'::app_role, 'supervisor'::app_role, 'maintenance_manager'::app_role, 'planner'::app_role, 'engineer'::app_role, 'co_engineer'::app_role, 'production_office_admin'::app_role])
    OR stopped_by = auth.uid()
    OR resumed_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.work_orders wo
       WHERE wo.id = downtime_events.work_order_id
         AND (
           wo.operator_id = auth.uid()
           OR (
             has_role(auth.uid(), 'operator'::app_role)
             AND EXISTS (
               SELECT 1 FROM public.operator_line_accounts ola
                WHERE ola.user_id = auth.uid()
                  AND wo.line_id = ANY (ola.line_ids)
             )
           )
         )
    )
  );

COMMENT ON FUNCTION public.has_action(uuid, text, app_role[]) IS
  'A pergunta que uma politica RLS deve fazer: le user_roles, aplica role_permission_overrides '
  '(a tabela que o ecra de Permissoes escreve) e so depois cai para a baseline. As baselines devem '
  'ser copia da MATRIX em src/lib/permissions.ts. Uma politica escrita com has_role() em vez desta '
  'e uma segunda copia da decisao, que o ecra de Permissoes nao consegue mover — ver 20260910090000, '
  'onde 365 de 436 politicas ainda estao assim.';
