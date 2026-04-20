
-- 1. Remove SELECT access to engineers table for engineer/manager roles
-- Engineers don't need to read their own row (PIN verified via SECURITY DEFINER function).
-- Managers/Admins can use the engineers_safe view (which excludes pin_hash) for listing.
DROP POLICY IF EXISTS "Engineers can view own engineer record" ON public.engineers;
DROP POLICY IF EXISTS "Managers can update engineers" ON public.engineers;
DROP POLICY IF EXISTS "Managers can delete engineers" ON public.engineers;
DROP POLICY IF EXISTS "Managers can insert engineers" ON public.engineers;

-- Managers retain write access but NOT read access to pin_hash
CREATE POLICY "Managers can insert engineers"
  ON public.engineers FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'manager'::app_role));

CREATE POLICY "Managers can update engineers"
  ON public.engineers FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'manager'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'manager'::app_role));

CREATE POLICY "Managers can delete engineers"
  ON public.engineers FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'manager'::app_role));

-- Revoke direct column access to pin_hash from all roles (defense in depth)
REVOKE SELECT (pin_hash) ON public.engineers FROM authenticated, anon;

-- 2. Tighten downtime_events UPDATE: operators only on their own WOs
DROP POLICY IF EXISTS "dt_update" ON public.downtime_events;

CREATE POLICY "dt_update"
  ON public.downtime_events FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'engineer'::app_role)
    OR public.has_role(auth.uid(), 'manager'::app_role)
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR (
      public.has_role(auth.uid(), 'operator'::app_role)
      AND EXISTS (
        SELECT 1 FROM public.work_orders wo
        WHERE wo.id = downtime_events.work_order_id
          AND wo.operator_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'engineer'::app_role)
    OR public.has_role(auth.uid(), 'manager'::app_role)
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR (
      public.has_role(auth.uid(), 'operator'::app_role)
      AND EXISTS (
        SELECT 1 FROM public.work_orders wo
        WHERE wo.id = downtime_events.work_order_id
          AND wo.operator_id = auth.uid()
      )
    )
  );
