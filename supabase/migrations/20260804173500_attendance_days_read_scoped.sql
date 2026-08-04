-- Sickness is not for everybody to read.
--
-- `attendance_days` arrived with `attendance_read` as `USING (true)`: every signed-in
-- account, including the shared tablet logins, could read every person's hours,
-- balance and absence reason. The absence reasons are Vacation, Sickness and Unpaid
-- Leave — a named person's medical absence, in a table anyone could select from.
--
-- Same treatment as `daily_allocations` earlier today, and for a stronger reason.
-- Scoped to the roles the write policy already names.

DROP POLICY IF EXISTS attendance_read ON public.attendance_days;

CREATE POLICY attendance_read ON public.attendance_days
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'manager'::app_role)
    OR has_role(auth.uid(), 'supervisor'::app_role)
    OR has_role(auth.uid(), 'planner'::app_role)
    OR has_role(auth.uid(), 'production_office_admin'::app_role)
  );
