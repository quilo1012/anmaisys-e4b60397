-- 1. Remove manager delete on work_orders
DROP POLICY IF EXISTS "Managers can delete WOs" ON public.work_orders;

-- 2. Allow admins to delete audit_logs
CREATE POLICY "Admins can delete audit logs"
ON public.audit_logs
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 3. Renumber existing WOs to 1 and 2 (chronological)
WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at) AS new_num
  FROM public.work_orders
)
UPDATE public.work_orders w
SET wo_number = ordered.new_num
FROM ordered
WHERE w.id = ordered.id;

-- 4. Reset sequence so next WO = (max+1)
SELECT setval('public.wo_number_seq', COALESCE((SELECT MAX(wo_number) FROM public.work_orders), 0));