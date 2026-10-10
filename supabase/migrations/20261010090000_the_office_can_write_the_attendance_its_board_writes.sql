-- The office places people on the headcount board, and the board's second write was refused.
--
-- `employee_attendance` was created on 31/07, three days after the office role got its
-- additive "office_admin all" policies, and it only ever had the admin one. Since the
-- board started mirroring each placement into attendance (so the finance close sees the
-- same day the board shows), every placement by a production_office_admin writes
-- `daily_allocations` fine and then fails here:
--
--   new row violates row-level security policy for table "employee_attendance"
--
-- thirteen times on 09/10 between 21:26 and 21:49, all from /dashboard/headcount. The
-- board keeps the placement and payroll never hears about it.
--
-- Same additive policy the office has on the other operational tables: OR'd with the
-- admin one, so no other role changes.

drop policy if exists "office_admin all" on public.employee_attendance;
create policy "office_admin all" on public.employee_attendance
  for all to authenticated
  using (public.has_role(auth.uid(), 'production_office_admin'::app_role))
  with check (public.has_role(auth.uid(), 'production_office_admin'::app_role));
