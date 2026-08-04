-- Reading the rota now needs a reason, the same way writing it does.
--
-- `daily_alloc_read` was `USING (true)`: any signed-in account could read every
-- allocation for every day. That is not only who stands on which line — it is who
-- was absent and who was on holiday, which is HR data about named people, and the
-- accounts that could read it included the shared operator logins on the tablets.
--
-- The write policy already names the roles that run the board. Reading is scoped to
-- the same list, which covers every screen that consumes this table today: the
-- Headcount board and the Workforce panels, both already restricted in the UI.
-- Nothing on an operator's tablet reads it.
--
-- Left deliberately absent: a "read your own row" clause. `daily_allocations` keys
-- on `employee_id`, and an employee is not the same thing as an auth account here,
-- so a self-read would have to guess at that join. When a screen needs it, it can be
-- added against a real requirement instead of a supposed one.

DROP POLICY IF EXISTS daily_alloc_read ON public.daily_allocations;

CREATE POLICY daily_alloc_read ON public.daily_allocations
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'manager'::app_role)
    OR has_role(auth.uid(), 'supervisor'::app_role)
    OR has_role(auth.uid(), 'planner'::app_role)
    OR has_role(auth.uid(), 'production_office_admin'::app_role)
  );
