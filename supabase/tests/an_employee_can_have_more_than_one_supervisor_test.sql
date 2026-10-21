-- Tests for 20261021180000_an_employee_can_have_more_than_one_supervisor.sql (BLOCO 115).
--
-- Run this WHOLE file in one go, in the SQL editor, after BLOCO 115. One transaction,
-- throwaway people, ROLLBACK at the end; the last statement prints 'ALL TESTS PASSED'
-- and any failure raises first, naming the case.
BEGIN;

CREATE FUNCTION pg_temp.ok(_case text, _got boolean) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF _got IS NOT TRUE THEN RAISE EXCEPTION 'FAILED %', _case; END IF;
END $$;

CREATE FUNCTION pg_temp.as_user(_uid uuid) RETURNS void
LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
$$;

DO $$
DECLARE
  u_adm uuid := gen_random_uuid(); u_emp uuid := gen_random_uuid();
  u_s1 uuid := gen_random_uuid();  u_s2 uuid := gen_random_uuid(); u_s3 uuid := gen_random_uuid();
  u_oth uuid := gen_random_uuid();
  e_emp uuid; e_s1 uuid; e_s2 uuid; e_s3 uuid; e_off uuid; e_oth uuid;
  n int; mgr uuid; got uuid[]; ok boolean;
BEGIN
  INSERT INTO auth.users (id, email, instance_id, aud, role)
  SELECT u, 'zz-sup-' || left(u::text, 8) || '@example.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'
    FROM unnest(ARRAY[u_adm, u_emp, u_s1, u_s2, u_s3, u_oth]) u;
  DELETE FROM public.user_roles WHERE user_id IN (u_adm, u_emp, u_s1, u_s2, u_s3, u_oth);
  INSERT INTO public.user_roles (user_id, role) VALUES
    (u_adm, 'admin'), (u_emp, 'employee'), (u_s1, 'supervisor'), (u_s2, 'supervisor'), (u_s3, 'supervisor'), (u_oth, 'employee');

  INSERT INTO public.employees (full_name, employee_ref, active, user_id) VALUES ('ZZ Emp', 'ZZ9201', true, u_emp) RETURNING id INTO e_emp;
  INSERT INTO public.employees (full_name, employee_ref, active, user_id) VALUES ('ZZ Sup One', 'ZZ9202', true, u_s1) RETURNING id INTO e_s1;
  INSERT INTO public.employees (full_name, employee_ref, active, user_id) VALUES ('ZZ Sup Two', 'ZZ9203', true, u_s2) RETURNING id INTO e_s2;
  INSERT INTO public.employees (full_name, employee_ref, active, user_id) VALUES ('ZZ Sup Three', 'ZZ9204', true, u_s3) RETURNING id INTO e_s3;
  INSERT INTO public.employees (full_name, employee_ref, active, user_id) VALUES ('ZZ Other', 'ZZ9205', true, u_oth) RETURNING id INTO e_oth;
  INSERT INTO public.employees (full_name, employee_ref, active, user_id) VALUES ('ZZ Left', 'ZZ9206', false, NULL) RETURNING id INTO e_off;

  -- 1. An admin sets two supervisors: both are stored in order, and manager_id is the first.
  PERFORM pg_temp.as_user(u_adm);
  PERFORM public.set_employee_supervisors(e_emp, ARRAY[e_s2, e_s1]);
  SELECT count(*) INTO n FROM public.employee_supervisors WHERE employee_id = e_emp;
  PERFORM pg_temp.ok('1a two supervisors stored', n = 2);
  SELECT manager_id INTO mgr FROM public.employees WHERE id = e_emp;
  PERFORM pg_temp.ok('1b manager_id is the first one', mgr = e_s2);

  -- 2. The employee sees both, in that order.
  PERFORM pg_temp.as_user(u_emp);
  SELECT array_agg(user_id) INTO got FROM public.my_supervisor();
  PERFORM pg_temp.ok('2 my_supervisor lists both, first one first', got = ARRAY[u_s2, u_s1]);

  -- 3. Writing to the supervisor: default is the first; a named one is that one; a stranger is refused.
  PERFORM public.message_my_supervisor('zz hello first');
  PERFORM pg_temp.ok('3a default goes to the first supervisor',
    EXISTS (SELECT 1 FROM public.direct_messages WHERE sender_id = u_emp AND recipient_id = u_s2 AND message = 'zz hello first'));
  PERFORM public.message_my_supervisor('zz hello second', u_s1);
  PERFORM pg_temp.ok('3b a named supervisor gets it',
    EXISTS (SELECT 1 FROM public.direct_messages WHERE sender_id = u_emp AND recipient_id = u_s1 AND message = 'zz hello second'));
  ok := false;
  BEGIN PERFORM public.message_my_supervisor('zz nope', u_s3); EXCEPTION WHEN raise_exception THEN ok := true; END;
  PERFORM pg_temp.ok('3c somebody who is not one of mine is refused', ok);

  -- 4. Who can write: an employee cannot change supervisors, not even their own.
  ok := false;
  BEGIN PERFORM public.set_employee_supervisors(e_emp, ARRAY[e_s3]); EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  PERFORM pg_temp.ok('4a an employee cannot set supervisors', ok);

  -- 5. Rules: never oneself, never an inactive record, no repeats, at most five; replacing drops the rest.
  PERFORM pg_temp.as_user(u_adm);
  PERFORM public.set_employee_supervisors(e_emp, ARRAY[e_emp, e_off, e_s3, e_s3]);
  SELECT array_agg(supervisor_id) INTO got FROM public.employee_supervisors WHERE employee_id = e_emp;
  PERFORM pg_temp.ok('5a self, inactive and repeats are dropped; replacing removes the old ones', got = ARRAY[e_s3]);
  SELECT manager_id INTO mgr FROM public.employees WHERE id = e_emp;
  PERFORM pg_temp.ok('5b manager_id follows', mgr = e_s3);
  -- Six active supervisors: refused.
  DECLARE extra uuid[] := ARRAY[e_s1, e_s2, e_s3, e_oth]; e6 uuid; e7 uuid;
  BEGIN
    INSERT INTO public.employees (full_name, employee_ref, active) VALUES ('ZZ Extra A', 'ZZ9207', true) RETURNING id INTO e6;
    INSERT INTO public.employees (full_name, employee_ref, active) VALUES ('ZZ Extra B', 'ZZ9208', true) RETURNING id INTO e7;
    ok := false;
    BEGIN PERFORM public.set_employee_supervisors(e_emp, extra || e6 || e7);
    EXCEPTION WHEN raise_exception THEN ok := true; END;
    PERFORM pg_temp.ok('5c more than five is refused', ok);
  END;
  PERFORM public.set_employee_supervisors(e_emp, ARRAY[]::uuid[]);
  SELECT manager_id INTO mgr FROM public.employees WHERE id = e_emp;
  PERFORM pg_temp.ok('5d clearing the list clears manager_id too', mgr IS NULL);

  -- 6. Nobody else's supervisors leak: another employee sees none of this person's.
  PERFORM public.set_employee_supervisors(e_emp, ARRAY[e_s1]);
  PERFORM pg_temp.as_user(u_oth);
  SELECT count(*) INTO n FROM public.my_supervisor();
  PERFORM pg_temp.ok('6a another employee with none on file sees none', n = 0);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.employee_supervisors;
  RESET ROLE;
  PERFORM pg_temp.ok('6b the table itself is closed to a non-admin', n = 0);
END $$;

SELECT 'ALL TESTS PASSED' AS result;
ROLLBACK;
