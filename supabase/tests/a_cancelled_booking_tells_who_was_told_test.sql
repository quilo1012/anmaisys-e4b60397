-- Tests for 20261101100000_a_cancelled_booking_tells_who_was_told_it_was_coming.sql.
--
-- Run this WHOLE file in one go, in the SQL editor, after that migration. One
-- transaction, its own throwaway people and asks, ROLLBACK at the end, so nothing it
-- writes (bells, queued pushes, board rows) survives. The last statement prints
-- 'ALL TESTS PASSED'; any failure raises first, naming the case. It must run as a role
-- that bypasses RLS (the SQL editor's postgres role does).
--
-- The story is the one seen on 01/11: an employee says yes, the admin who posted the ask
-- hears "is coming in", the employee cancels from My Overtime, and the admin hears nothing.

BEGIN;

CREATE FUNCTION pg_temp.expect_true(_case text, _got boolean) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF _got IS NOT TRUE THEN RAISE EXCEPTION 'FAILED %', _case; END IF;
END $$;

CREATE FUNCTION pg_temp.as_user(_user uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _user, 'role', 'authenticated')::text, true);
END $$;

CREATE FUNCTION pg_temp.bells(_user uuid) RETURNS int
LANGUAGE sql AS $$
  SELECT count(*)::int FROM public.notifications WHERE user_id = _user AND kind = 'overtime_booking_cancelled'
$$;

DO $$
DECLARE
  d date := current_date + 10;
  u_admin uuid := gen_random_uuid();
  u_sup uuid := gen_random_uuid();
  u_emp uuid := gen_random_uuid();
  u_two uuid := gen_random_uuid();
  e_admin uuid; e_sup uuid; e_emp uuid; e_two uuid;
  ask uuid; ask2 uuid; ask3 uuid;
  r public.overtime_responses;
  t text;
BEGIN
  INSERT INTO auth.users (id, email, instance_id, aud, role)
  SELECT u, 'zz-' || u || '@example.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'
    FROM unnest(ARRAY[u_admin, u_sup, u_emp, u_two]) u;
  UPDATE public.user_roles SET role = 'admin' WHERE user_id = u_admin;
  UPDATE public.user_roles SET role = 'manager' WHERE user_id = u_sup;
  UPDATE public.user_roles SET role = 'employee' WHERE user_id IN (u_emp, u_two);
  INSERT INTO public.employees (full_name, department, shift_group, active, user_id)
  VALUES ('ZZ Admin ' || left(u_admin::text, 8), 'Production', 'Day', true, u_admin) RETURNING id INTO e_admin;
  INSERT INTO public.employees (full_name, department, shift_group, active, user_id)
  VALUES ('ZZ Supervisor ' || left(u_sup::text, 8), 'Production', 'Day', true, u_sup) RETURNING id INTO e_sup;
  INSERT INTO public.employees (full_name, department, shift_group, active, user_id)
  VALUES ('ZZ Josimar ' || left(u_emp::text, 8), 'Production', 'Day', true, u_emp) RETURNING id INTO e_emp;
  INSERT INTO public.employees (full_name, department, shift_group, active, user_id)
  VALUES ('ZZ Second ' || left(u_two::text, 8), 'Production', 'Day', true, u_two) RETURNING id INTO e_two;
  INSERT INTO public.employee_supervisors (employee_id, supervisor_id, position)
  SELECT e, e_sup, 1 FROM unnest(ARRAY[e_emp, e_two]) e;

  PERFORM pg_temp.as_user(u_admin);
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, department, created_by)
  VALUES (d, '06:00', '18:00', 'Production', u_admin) RETURNING id INTO ask;
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, department, created_by)
  VALUES (d + 1, '06:00', '14:00', 'Production', u_admin) RETURNING id INTO ask2;
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, department, created_by)
  VALUES (d + 2, '06:00', '14:00', 'Production', u_admin) RETURNING id INTO ask3;

  -- ── 1. The reported case: the employee cancels, the poster and the supervisor hear ──
  PERFORM pg_temp.as_user(u_emp);
  r := public.answer_overtime(ask, 'yes');
  PERFORM pg_temp.expect_true('1. the yes is a booking', r.decision = 'accepted');
  PERFORM public.cancel_my_overtime(ask);
  PERFORM pg_temp.expect_true('1b. the admin who posted the ask is told', pg_temp.bells(u_admin) = 1);
  PERFORM pg_temp.expect_true('1c. the supervisor on file is told', pg_temp.bells(u_sup) = 1);
  PERFORM pg_temp.expect_true('1d. the employee is not told about themself', pg_temp.bells(u_emp) = 0);
  SELECT title INTO t FROM public.notifications WHERE user_id = u_admin AND kind = 'overtime_booking_cancelled';
  PERFORM pg_temp.expect_true('1e. the title names them and says they cancelled',
    t = (SELECT full_name FROM public.employees WHERE id = e_emp) || ' cancelled their overtime');

  -- ── 2. A second tap is idempotent in cancel_my_overtime and rings nobody again ──────
  PERFORM public.cancel_my_overtime(ask);
  PERFORM pg_temp.expect_true('2. no second bell', pg_temp.bells(u_admin) = 1 AND pg_temp.bells(u_sup) = 1);

  -- ── 3. Taken back and cancelled again rings again (no unique key in the way) ────────
  r := public.rebook_my_overtime(ask);
  PERFORM public.cancel_my_overtime(ask);
  PERFORM pg_temp.expect_true('3. cancelled again, told again', pg_temp.bells(u_admin) = 2 AND pg_temp.bells(u_sup) = 2);

  -- ── 4. The admin cancels at the desk: the supervisor is told, the admin is not ──────
  PERFORM pg_temp.as_user(u_two);
  r := public.answer_overtime(ask2, 'yes');
  PERFORM pg_temp.as_user(u_admin);
  PERFORM public.record_overtime_outcome(r.id, 'cancelled');
  PERFORM pg_temp.expect_true('4. the supervisor hears it, the one who did it does not',
    pg_temp.bells(u_sup) = 3 AND pg_temp.bells(u_admin) = 2 AND pg_temp.bells(u_two) = 0);
  PERFORM pg_temp.expect_true('4b. the title does not say they cancelled it themself',
    (SELECT count(*) FROM public.notifications WHERE user_id = u_sup AND kind = 'overtime_booking_cancelled'
        AND title = (SELECT full_name FROM public.employees WHERE id = e_two) || '''s overtime was cancelled') = 1);

  -- ── 5. Called sick is not a cancellation, and rings nobody ──────────────────────────
  PERFORM pg_temp.as_user(u_emp);
  r := public.answer_overtime(ask3, 'yes');
  PERFORM pg_temp.as_user(u_admin);
  PERFORM public.record_overtime_outcome(r.id, 'called_sick');
  PERFORM pg_temp.expect_true('5. no bell for an outcome that is not a cancellation',
    pg_temp.bells(u_sup) = 3 AND pg_temp.bells(u_admin) = 2);
END $$;

SELECT 'ALL TESTS PASSED' AS result;

ROLLBACK;
