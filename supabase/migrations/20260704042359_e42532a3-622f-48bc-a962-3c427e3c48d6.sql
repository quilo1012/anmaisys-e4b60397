
-- Fix 1: device_lines_insert_open_pairing
-- Restrict device INSERT to admins/managers only.
DROP POLICY IF EXISTS "Authenticated can register device" ON public.devices;
CREATE POLICY "Admins managers can register device"
  ON public.devices
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'manager'::app_role)
  );

-- Fix 2: engineers_insert_manager_role_escalation
-- Remove manager DELETE (only admin can remove engineer identities).
-- Keep manager INSERT/UPDATE (pin_hash writes are already blocked by
-- guard_engineer_pin_hash trigger for non-admins).
DROP POLICY IF EXISTS "Managers can delete engineers" ON public.engineers;

-- Fix 3: prediction_log_select_true
-- Scope reads to admin/manager/engineer (exclude operators).
DROP POLICY IF EXISTS "prediction_log_select_auth" ON public.prediction_log;
CREATE POLICY "prediction_log_select_privileged"
  ON public.prediction_log
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'manager'::app_role)
    OR public.has_role(auth.uid(), 'engineer'::app_role)
  );

-- Fix 4: realtime_messages_missing_operator_full_coverage
-- Drop the broad "Authenticated roles receive realtime" that indiscriminately
-- allows operators to subscribe to any private topic. Replace with a
-- topic-scoped operator policy that only permits topics tied to a line the
-- operator is bound to via operator_line_accounts.
DROP POLICY IF EXISTS "Authenticated roles receive realtime" ON realtime.messages;

CREATE POLICY "Operators receive realtime for their own line topics"
  ON realtime.messages
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'operator'::app_role)
    AND EXISTS (
      SELECT 1
        FROM public.operator_line_accounts ola
       WHERE ola.user_id = auth.uid()
         AND EXISTS (
           SELECT 1
             FROM unnest(ola.line_ids) AS lid
            WHERE realtime.topic() LIKE '%' || lid::text || '%'
         )
    )
  );
