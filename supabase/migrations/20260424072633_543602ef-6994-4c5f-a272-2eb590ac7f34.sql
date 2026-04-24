
-- Defense in depth: RESTRICTIVE policy that ALWAYS applies when user is an operator.
-- Even if they also hold engineer/manager/admin (shouldn't happen due to UNIQUE constraint,
-- but belt-and-suspenders), this policy AND-combines with all PERMISSIVE policies and
-- ensures operators are strictly scoped to their own WOs or device-paired lines.

DROP POLICY IF EXISTS "Operators strictly scoped to own line" ON public.work_orders;

CREATE POLICY "Operators strictly scoped to own line"
ON public.work_orders
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (
  -- If the user is NOT an operator, this restrictive policy doesn't constrain them
  NOT has_role(auth.uid(), 'operator'::app_role)
  -- If they ARE an operator, they MUST own the WO or have it on a paired line
  OR operator_id = auth.uid()
  OR (line_id IS NOT NULL AND line_id = ANY(current_device_line_ids()))
);
