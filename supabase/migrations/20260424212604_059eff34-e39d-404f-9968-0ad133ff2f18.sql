
-- =====================================================
-- 1) Fix operator INSERT policy on work_orders
--    Old policy depended on x-device-token header which the app no longer sends.
--    New policy: operator may create a WO if line_id is in their operator_line_accounts.line_ids
-- =====================================================

DROP POLICY IF EXISTS "Operators create WOs on device line" ON public.work_orders;

CREATE POLICY "Operators create WOs on assigned line"
ON public.work_orders
FOR INSERT
TO authenticated
WITH CHECK (
  operator_id = auth.uid()
  AND has_role(auth.uid(), 'operator'::app_role)
  AND line_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.operator_line_accounts ola
    WHERE ola.user_id = auth.uid()
      AND line_id = ANY(ola.line_ids)
  )
);

-- =====================================================
-- 2) Realign operator SELECT scoping to operator_line_accounts
--    (keep device-token path as additional fallback for legacy paired tablets)
-- =====================================================

DROP POLICY IF EXISTS "Operators view own line WOs (device-scoped)" ON public.work_orders;

CREATE POLICY "Operators view own or assigned-line WOs"
ON public.work_orders
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'operator'::app_role)
  AND NOT has_role(auth.uid(), 'engineer'::app_role)
  AND NOT has_role(auth.uid(), 'manager'::app_role)
  AND NOT has_role(auth.uid(), 'admin'::app_role)
  AND (
    operator_id = auth.uid()
    OR (
      line_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.operator_line_accounts ola
        WHERE ola.user_id = auth.uid()
          AND line_id = ANY(ola.line_ids)
      )
    )
    OR (line_id IS NOT NULL AND line_id = ANY(current_device_line_ids()))
  )
);

-- Also relax the RESTRICTIVE policy to recognise operator_line_accounts as a valid scope
DROP POLICY IF EXISTS "Operators strictly scoped to own line" ON public.work_orders;

CREATE POLICY "Operators strictly scoped to own line"
ON public.work_orders
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (
  NOT has_role(auth.uid(), 'operator'::app_role)
  OR operator_id = auth.uid()
  OR (line_id IS NOT NULL AND line_id = ANY(current_device_line_ids()))
  OR (
    line_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.operator_line_accounts ola
      WHERE ola.user_id = auth.uid()
        AND line_id = ANY(ola.line_ids)
    )
  )
);

-- =====================================================
-- 3) Blender cleanup
-- =====================================================

-- 3a) Rewrite historical line_at_time to 'Removed'
UPDATE public.work_orders
SET line_at_time = 'Removed'
WHERE line_at_time ILIKE '%blender%';

-- 3b) Detach FK references from work_orders to Blender lines
UPDATE public.work_orders
SET line_id = NULL
WHERE line_id IN (
  SELECT id FROM public.lines WHERE name ILIKE '%blender%'
);

-- 3c) Detach machines that point to Blender lines
UPDATE public.machines
SET line_id = NULL,
    line = '',
    fixed_line = NULL,
    current_line = NULL
WHERE line_id IN (
  SELECT id FROM public.lines WHERE name ILIKE '%blender%'
);

-- 3d) Delete the Blender machines themselves (Capsules Blender 1 / 2)
DELETE FROM public.machines
WHERE name ILIKE '%blender%';

-- 3e) Delete Blender lines
DELETE FROM public.lines
WHERE name ILIKE '%blender%';
