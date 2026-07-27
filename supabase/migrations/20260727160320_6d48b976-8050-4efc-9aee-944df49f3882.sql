
-- 1) Drop backup tables
DROP TABLE IF EXISTS public._bkp_blender_before_clear;
DROP TABLE IF EXISTS public._bkp_prod_items_before_clear;
DROP TABLE IF EXISTS public._bkp_production_items_20260722;
DROP TABLE IF EXISTS public._bkp_production_targets_20260722;
DROP TABLE IF EXISTS public._bkp_sku_production_history_20260722;
DROP TABLE IF EXISTS public._bkp_sku_products_20260722;

-- 2) Restrict {public}-role policies to {authenticated}
ALTER POLICY "Quality managers write audits" ON public.audits TO authenticated;
ALTER POLICY "Quality roles read audits" ON public.audits TO authenticated;
ALTER POLICY "trace write" ON public.batch_dispatch TO authenticated;
ALTER POLICY "trace write" ON public.batch_material_usage TO authenticated;
ALTER POLICY "dm_insert_routing" ON public.direct_messages TO authenticated;
ALTER POLICY "pvs manage" ON public.materials TO authenticated;
ALTER POLICY "pvs read" ON public.materials TO authenticated;
ALTER POLICY "pvs manage" ON public.packaging_bom TO authenticated;
ALTER POLICY "pvs read" ON public.packaging_bom TO authenticated;
ALTER POLICY "pvs manage" ON public.production_orders TO authenticated;
ALTER POLICY "pvs read" ON public.production_orders TO authenticated;
ALTER POLICY "pvs read" ON public.pvs_sessions TO authenticated;
ALTER POLICY "pvs sessions write" ON public.pvs_sessions TO authenticated;
ALTER POLICY "Quality managers write qc" ON public.qc_inspections TO authenticated;
ALTER POLICY "Quality roles read qc" ON public.qc_inspections TO authenticated;
ALTER POLICY "quality_actions delete quality staff" ON public.quality_actions TO authenticated;
ALTER POLICY "Quality managers write capa" ON public.quality_capa TO authenticated;
ALTER POLICY "Quality roles read capa" ON public.quality_capa TO authenticated;
ALTER POLICY "trace write" ON public.raw_material_lots TO authenticated;
ALTER POLICY "pvs read" ON public.scan_events TO authenticated;
ALTER POLICY "pvs scans insert" ON public.scan_events TO authenticated;

-- 3) Tighten realtime.messages topic matching for operators — exact topic only
DROP POLICY IF EXISTS "Operators receive realtime for their own line topics" ON realtime.messages;
CREATE POLICY "Operators receive realtime for their own line topics"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'operator'::app_role)
  AND EXISTS (
    SELECT 1
    FROM public.operator_line_accounts ola
    WHERE ola.user_id = auth.uid()
      AND realtime.topic() = ANY (
        SELECT 'line_chat_presence_' || lid::text
        FROM unnest(ola.line_ids) AS lid
      )
  )
);

DROP POLICY IF EXISTS "Authorized app roles can send realtime" ON realtime.messages;
CREATE POLICY "Authorized app roles can send realtime"
ON realtime.messages
FOR INSERT
TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'manager'::app_role)
  OR has_role(auth.uid(), 'engineer'::app_role)
  OR (
    has_role(auth.uid(), 'operator'::app_role)
    AND EXISTS (
      SELECT 1
      FROM public.operator_line_accounts ola
      WHERE ola.user_id = auth.uid()
        AND realtime.topic() = ANY (
          SELECT 'line_chat_presence_' || lid::text
          FROM unnest(ola.line_ids) AS lid
        )
    )
  )
);
