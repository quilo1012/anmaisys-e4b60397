-- Audit follow-ups C(planner)/D/F/G — enable the MATRIX grants in RLS/RPC so the
-- roles that had them stop hitting load-then-fail. Business decisions (user):
--   planner    → enable in RLS: production, SKU, targets.
--   supervisor → enable: targets + RAG comments (consistent with #140/#142).
--   planner rag.comment was NOT part of the decision → kept out (MATRIX aligned
--   down in permissions.ts), so nothing is enabled for it here.
-- Applied live; committed for the record.

-- ── production_targets: + supervisor, + planner ───────────────────────────
DROP POLICY IF EXISTS "production_targets write admin/manager" ON public.production_targets;
CREATE POLICY "production_targets write mgmt" ON public.production_targets
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role)
     OR has_role(auth.uid(),'supervisor'::app_role) OR has_role(auth.uid(),'planner'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role)
     OR has_role(auth.uid(),'supervisor'::app_role) OR has_role(auth.uid(),'planner'::app_role));

-- ── sku_products: + planner ───────────────────────────────────────────────
DROP POLICY IF EXISTS "sku_products write admin/manager/supervisor" ON public.sku_products;
CREATE POLICY "sku_products write mgmt" ON public.sku_products
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role)
     OR has_role(auth.uid(),'supervisor'::app_role) OR has_role(auth.uid(),'planner'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role)
     OR has_role(auth.uid(),'supervisor'::app_role) OR has_role(auth.uid(),'planner'::app_role));

-- ── rag_weekly_comments INSERT: + supervisor ──────────────────────────────
DROP POLICY IF EXISTS "Admins and Managers can insert rag comments" ON public.rag_weekly_comments;
CREATE POLICY "Admins Managers Supervisors insert rag comments" ON public.rag_weekly_comments
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role)
     OR has_role(auth.uid(),'supervisor'::app_role));

-- ── production_sessions: + planner (management tier) ──────────────────────
DROP POLICY IF EXISTS "production_sessions insert admin/manager/supervisor" ON public.production_sessions;
CREATE POLICY "production_sessions insert mgmt" ON public.production_sessions
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role)
     OR has_role(auth.uid(),'maintenance_manager'::app_role) OR has_role(auth.uid(),'supervisor'::app_role)
     OR has_role(auth.uid(),'planner'::app_role));
DROP POLICY IF EXISTS "production_sessions update admin/manager/supervisor" ON public.production_sessions;
CREATE POLICY "production_sessions update mgmt" ON public.production_sessions
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role)
     OR has_role(auth.uid(),'maintenance_manager'::app_role) OR has_role(auth.uid(),'supervisor'::app_role)
     OR has_role(auth.uid(),'planner'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role)
     OR has_role(auth.uid(),'maintenance_manager'::app_role) OR has_role(auth.uid(),'supervisor'::app_role)
     OR has_role(auth.uid(),'planner'::app_role));

-- ── production_items: + planner (management tier, insert/update/delete) ────
DROP POLICY IF EXISTS "production_items insert admin/manager/supervisor" ON public.production_items;
CREATE POLICY "production_items insert mgmt" ON public.production_items
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role)
     OR has_role(auth.uid(),'maintenance_manager'::app_role) OR has_role(auth.uid(),'supervisor'::app_role)
     OR has_role(auth.uid(),'planner'::app_role));
DROP POLICY IF EXISTS "production_items update admin/manager/supervisor" ON public.production_items;
CREATE POLICY "production_items update mgmt" ON public.production_items
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role)
     OR has_role(auth.uid(),'maintenance_manager'::app_role) OR has_role(auth.uid(),'supervisor'::app_role)
     OR has_role(auth.uid(),'planner'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role)
     OR has_role(auth.uid(),'maintenance_manager'::app_role) OR has_role(auth.uid(),'supervisor'::app_role)
     OR has_role(auth.uid(),'planner'::app_role));
DROP POLICY IF EXISTS "production_items delete admin/manager/supervisor" ON public.production_items;
CREATE POLICY "production_items delete mgmt" ON public.production_items
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role)
     OR has_role(auth.uid(),'maintenance_manager'::app_role) OR has_role(auth.uid(),'supervisor'::app_role)
     OR has_role(auth.uid(),'planner'::app_role));

-- ── SKU RPC guards: + planner (bodies unchanged except the role check) ─────
-- import_sku_products, snapshot_sku_products, restore_sku_products_from_backup,
-- cleanup_batch_skus all now accept planner alongside admin/manager/supervisor.
-- (Full bodies applied live via query_database; see prior migrations
--  20260725120000 and 20260726200000 for the surrounding logic.)
