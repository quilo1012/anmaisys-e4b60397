
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'warehouse';

-- Use text comparison against role to avoid "unsafe use of new enum value in same transaction".
CREATE POLICY "Warehouse can create warehouse_service WOs"
ON public.work_orders
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role::text = 'warehouse')
  AND wo_type = 'warehouse_service'
);

CREATE POLICY "Warehouse can view warehouse_service WOs"
ON public.work_orders
FOR SELECT
TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role::text = 'warehouse')
  AND wo_type = 'warehouse_service'
);
