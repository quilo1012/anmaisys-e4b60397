-- 2nd audit — safe DB hardening (applied live; committed for the record).
-- (Finding "labor_rate writable via PostgREST" was a FALSE POSITIVE: the
--  BEFORE UPDATE trigger guard_profile_labor_rate already raises for non-admin
--  writes, so no change is made for it.)

-- #4 — Traceability read was open to every authenticated user (operators could
-- read supplier/customer/lot/dispatch data). Gate it to the same management/
-- quality roles that already hold write, matching audits/qc_inspections.
DROP POLICY IF EXISTS "trace read" ON public.raw_material_lots;
CREATE POLICY "trace read" ON public.raw_material_lots FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role)
    OR has_role(auth.uid(),'supervisor'::app_role) OR has_role(auth.uid(),'quality_supervisor'::app_role)
    OR has_role(auth.uid(),'planner'::app_role) OR has_role(auth.uid(),'warehouse'::app_role));
DROP POLICY IF EXISTS "trace read" ON public.batch_material_usage;
CREATE POLICY "trace read" ON public.batch_material_usage FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role)
    OR has_role(auth.uid(),'supervisor'::app_role) OR has_role(auth.uid(),'quality_supervisor'::app_role)
    OR has_role(auth.uid(),'planner'::app_role) OR has_role(auth.uid(),'warehouse'::app_role));
DROP POLICY IF EXISTS "trace read" ON public.batch_dispatch;
CREATE POLICY "trace read" ON public.batch_dispatch FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role)
    OR has_role(auth.uid(),'supervisor'::app_role) OR has_role(auth.uid(),'quality_supervisor'::app_role)
    OR has_role(auth.uid(),'planner'::app_role) OR has_role(auth.uid(),'warehouse'::app_role));

-- #6 — batch_material_usage → raw_material_lots was ON DELETE CASCADE: deleting a
-- lot silently wiped the batch→material trace links (same class as the H1 fix for
-- production_targets/sku_production_history). Switch to RESTRICT.
ALTER TABLE public.batch_material_usage DROP CONSTRAINT batch_material_usage_raw_material_lot_id_fkey;
ALTER TABLE public.batch_material_usage
  ADD CONSTRAINT batch_material_usage_raw_material_lot_id_fkey
  FOREIGN KEY (raw_material_lot_id) REFERENCES public.raw_material_lots(id) ON DELETE RESTRICT;

-- #12 — remove anon EXECUTE on two privileged SECURITY DEFINER RPCs (guarded
-- internally today, but anon should never be able to reach them).
REVOKE EXECUTE ON FUNCTION public.admin_update_auth_email(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_update_auth_email(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_update_auth_email(uuid, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.list_dm_partners() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.list_dm_partners() FROM anon;
GRANT EXECUTE ON FUNCTION public.list_dm_partners() TO authenticated;
