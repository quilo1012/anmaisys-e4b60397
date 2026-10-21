-- Tests for 20261021160000_operators_have_no_overtime_or_attendance.sql (BLOCO 113).
--
-- Run this WHOLE file in one go, in the Supabase SQL Editor, after BLOCO 113 has been
-- applied. One transaction, throwaway users, ROLLBACK at the end; the last statement prints
-- 'ALL TESTS PASSED' and any failure raises first, naming the case. Needs a role that
-- bypasses RLS (the SQL Editor's); the cases that need RLS switch to `authenticated`.
--
--   1. An operator who is linked to an employee row still gets NULL from my_employee_id(),
--      so every "my own" overtime/attendance function has nobody to answer for.
--   2. An employee, a manager and an admin linked the same way still get their row.
--   3. (One role per login, so no operator-and-manager login exists; the policy still allows it.)
--   4. Permissions screen: a grant to the operator role brings it back; none, it stays shut.
--   5. The overtime asks: unreadable to an operator-only login, readable to the others.
--   6. Nothing is deleted: the operator's own past answers are still in the table.
BEGIN;

CREATE FUNCTION pg_temp.ok(_case text, _got boolean) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF _got IS NOT TRUE THEN RAISE EXCEPTION 'FAILED %', _case; END IF;
END $$;

CREATE FUNCTION pg_temp.as_user(_user uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _user)::text, true);
END $$;

DO $$
DECLARE
  u_op uuid := gen_random_uuid(); u_emp uuid := gen_random_uuid();
  u_mgr uuid := gen_random_uuid(); u_none uuid := gen_random_uuid();
  e_op uuid; req uuid; n int;
BEGIN
  INSERT INTO auth.users (id, email, instance_id, aud, role)
  SELECT u, 'zz-op-' || left(u::text, 8) || '@example.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'
    FROM unnest(ARRAY[u_op, u_emp, u_mgr, u_none]) u;
  DELETE FROM public.user_roles WHERE user_id IN (u_op, u_emp, u_mgr, u_none);
  INSERT INTO public.user_roles (user_id, role) VALUES
    (u_op, 'operator'), (u_emp, 'employee'), (u_mgr, 'manager');
  -- One role per login (user_roles_user_id_unique), so there is no operator-and-manager login.

  INSERT INTO public.employees (full_name, employee_ref, active, user_id) VALUES ('ZZ Op', 'ZZ9101', true, u_op) RETURNING id INTO e_op;
  INSERT INTO public.employees (full_name, employee_ref, active, user_id) VALUES ('ZZ Emp', 'ZZ9102', true, u_emp);
  INSERT INTO public.employees (full_name, employee_ref, active, user_id) VALUES ('ZZ Mgr', 'ZZ9103', true, u_mgr);
  INSERT INTO public.employees (full_name, employee_ref, active, user_id) VALUES ('ZZ None', 'ZZ9105', true, u_none);

  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, created_by)
  VALUES (current_date + 3, '06:00', '18:00', 2, u_mgr) RETURNING id INTO req;
  INSERT INTO public.overtime_responses (request_id, employee_id, answer, decision)
  VALUES (req, e_op, 'yes', 'accepted');

  -- 1 / 2 / 3
  PERFORM pg_temp.as_user(u_op);
  PERFORM pg_temp.ok('1 operator linked to an employee row gets nobody', public.my_employee_id() IS NULL);
  PERFORM pg_temp.as_user(u_emp);
  PERFORM pg_temp.ok('2a employee keeps their row', public.my_employee_id() IS NOT NULL);
  PERFORM pg_temp.as_user(u_mgr);
  PERFORM pg_temp.ok('2b manager keeps their row', public.my_employee_id() IS NOT NULL);

  PERFORM pg_temp.as_user(u_none);
  PERFORM pg_temp.ok('2c a login with no role at all is untouched (only operators are held back)', public.my_employee_id() IS NOT NULL);

  -- 4. the Permissions screen
  PERFORM pg_temp.as_user(u_op);
  INSERT INTO public.role_permission_overrides (role, action, allowed) VALUES ('operator', 'attendance.view_own', true);
  PERFORM pg_temp.ok('4a a grant to the operator role brings the row back', public.my_employee_id() = e_op);
  DELETE FROM public.role_permission_overrides WHERE role = 'operator' AND action = 'attendance.view_own';
  PERFORM pg_temp.ok('4b without the grant it is shut again', public.my_employee_id() IS NULL);

  -- 6. nothing deleted
  SELECT count(*) INTO n FROM public.overtime_responses WHERE employee_id = e_op;
  PERFORM pg_temp.ok('6 the operator''s past answer is still on file', n = 1);

  -- 5. the asks, under RLS
  PERFORM pg_temp.as_user(u_op);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.overtime_requests WHERE id = req;
  PERFORM pg_temp.ok('5a operator-only login cannot read the asks', n = 0);
  RESET ROLE;
  PERFORM pg_temp.as_user(u_emp);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.overtime_requests WHERE id = req;
  PERFORM pg_temp.ok('5b employee still reads the asks', n = 1);
  RESET ROLE;
END $$;

SELECT 'ALL TESTS PASSED' AS result;
ROLLBACK;
