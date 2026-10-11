-- An employee is here for overtime.
--
-- The invite link and the badge have been making `operator` accounts, because operator
-- was the narrowest role there was. It is not narrow: it logs production, raises
-- maintenance calls and sees line targets. Two hundred people whose only business in
-- the app is "yes, I'll do Saturday" were being handed all of that.
--
-- `employee` holds one action in src/lib/permissions.ts, `overtime.respond`, and lands
-- on /dashboard/my-overtime. No RLS policy needs it: everything My Overtime reads or
-- writes is open to `authenticated` and narrowed by `my_employee_id()`, not by role
-- (20261006180000), and every admin/manager/office policy stays as it is.
--
-- ALONE, ON PURPOSE. Postgres refuses to use an enum value in the same transaction
-- that adds it ("unsafe use of new value"), and the SQL editor runs a paste as one
-- transaction. 20261011120100 uses the value and must be run after this one, in a
-- separate run.
--
-- Idempotent.

alter type public.app_role add value if not exists 'employee';
