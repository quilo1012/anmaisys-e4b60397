-- 1) Fix work_orders UPDATE policy: target authenticated instead of public
DROP POLICY IF EXISTS "Engineers can update WOs" ON public.work_orders;

CREATE POLICY "Engineers can update WOs"
ON public.work_orders
FOR UPDATE
TO authenticated
USING (has_role(auth.uid(), 'engineer'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

-- Also tighten other work_orders policies still targeting {public}
DROP POLICY IF EXISTS "Operators can create WOs" ON public.work_orders;
CREATE POLICY "Operators can create WOs"
ON public.work_orders
FOR INSERT
TO authenticated
WITH CHECK ((operator_id = auth.uid()) AND has_role(auth.uid(), 'operator'::app_role));

DROP POLICY IF EXISTS "Operators can view own WOs" ON public.work_orders;
CREATE POLICY "Operators can view own WOs"
ON public.work_orders
FOR SELECT
TO authenticated
USING ((operator_id = auth.uid()) OR has_role(auth.uid(), 'engineer'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

-- 2) Harden realtime.messages policies to scope by app_role
-- Drop existing overly-permissive policies if they exist
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT polname FROM pg_policy
    WHERE polrelid = 'realtime.messages'::regclass
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON realtime.messages', pol.polname);
  END LOOP;
END $$;

-- Allow realtime SELECT (receive broadcasts) only to roles that have at least
-- one of the application roles allowed to read the published tables
-- (work_orders, wo_messages, work_order_logs, products, downtime_events).
-- Operators and viewers cannot subscribe to these realtime channels.
CREATE POLICY "Authorized app roles can receive realtime"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'manager'::app_role)
  OR has_role(auth.uid(), 'engineer'::app_role)
);

-- Allow realtime INSERT (send broadcasts / presence) only to the same roles.
CREATE POLICY "Authorized app roles can send realtime"
ON realtime.messages
FOR INSERT
TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'manager'::app_role)
  OR has_role(auth.uid(), 'engineer'::app_role)
  OR has_role(auth.uid(), 'operator'::app_role)
);
