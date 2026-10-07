-- Tests for "one authenticated session = one person" (#4).
--
-- Run this WHOLE file in one go, in the Supabase SQL Editor. It opens a transaction,
-- creates its own throwaway employees, asserts, and ROLLBACKs. The last statement
-- prints 'ALL TESTS PASSED'; any failure raises and aborts before it.
--
-- WHAT IS BEING PROTECTED. Everything in overtime asks who you are through
-- `my_employee_id()`, which is `employees.user_id = auth.uid()`. The floor's tablets
-- sign in with a pool of shared operator accounts, so if one of those logins were
-- ever bound to an employee, every person who touched that tablet would answer as
-- them — one response row, overwritten each time, which is exactly the "only one
-- employee can register" the floor reported.
--
-- The binding is therefore the thing to pin: a login takes one employee and will not
-- take a second, and an employee already spoken for cannot be taken by another login.
-- Both refusals already exist in `link_me_to_employee`; nothing asserted them.
--
-- It must run as a role that bypasses RLS (the SQL Editor's postgres role does).

BEGIN;

CREATE FUNCTION pg_temp.expect_true(_case text, _got boolean) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF _got IS NOT TRUE THEN RAISE EXCEPTION 'FAILED %', _case; END IF;
END $$;

CREATE FUNCTION pg_temp.link_refused(_user uuid, _employee uuid)
RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _user)::text, true);
  PERFORM public.link_me_to_employee(_employee);
  RETURN false;
EXCEPTION WHEN others THEN
  RETURN true;
END $$;

DO $$
DECLARE
  u_one uuid := gen_random_uuid();
  u_two uuid := gen_random_uuid();
  e_first uuid; e_second uuid;
BEGIN
  INSERT INTO public.employees (full_name, department, shift_group, active)
  VALUES ('ZZ Identity First', 'Production', 'Day', true) RETURNING id INTO e_first;
  INSERT INTO public.employees (full_name, department, shift_group, active)
  VALUES ('ZZ Identity Second', 'Production', 'Day', true) RETURNING id INTO e_second;

  -- An unlinked login is nobody, and says so by being null rather than by guessing.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_one)::text, true);
  PERFORM pg_temp.expect_true('an unlinked login resolves to nobody',
    public.my_employee_id() IS NULL);

  -- The binding takes.
  PERFORM pg_temp.expect_true('a login may take an unclaimed employee',
    NOT pg_temp.link_refused(u_one, e_first));
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_one)::text, true);
  PERFORM pg_temp.expect_true('and resolves to them afterwards',
    public.my_employee_id() = e_first);

  -- One session, one person: the same login cannot also become somebody else. This is
  -- the refusal that stops a shared tablet collecting identities.
  PERFORM pg_temp.expect_true('a login already linked may not take a second employee',
    pg_temp.link_refused(u_one, e_second));

  -- And from the other side: an employee already spoken for is not available.
  PERFORM pg_temp.expect_true('an employee already linked may not be taken by another login',
    pg_temp.link_refused(u_two, e_first));

  -- The second login is still nobody — a refused link must leave nothing behind.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_two)::text, true);
  PERFORM pg_temp.expect_true('a refused link leaves the login unbound',
    public.my_employee_id() IS NULL);
END $$;

SELECT 'ALL TESTS PASSED' AS result;

ROLLBACK;
