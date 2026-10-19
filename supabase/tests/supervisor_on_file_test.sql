-- Tests for 20261019140000_the_supervisor_on_file_is_told.sql (BLOCO 107).
--
-- Run this WHOLE file in one go, in the SQL editor, after BLOCO 107. One transaction,
-- its own throwaway people, asks and messages, ROLLBACK at the end. The last statement
-- prints 'ALL TESTS PASSED'; any failure raises first, naming the case. Runs as the
-- SQL editor's postgres role; the RLS cases switch to `authenticated` and back.

BEGIN;

CREATE FUNCTION pg_temp.expect_true(_case text, _got boolean) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF _got IS NOT TRUE THEN RAISE EXCEPTION 'FAILED %', _case; END IF;
END $$;

CREATE FUNCTION pg_temp.as_user(_uid uuid) RETURNS void
LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
$$;

CREATE TEMP TABLE zz_ids (k text PRIMARY KEY, v uuid);
GRANT ALL ON zz_ids TO authenticated;

DO $$
DECLARE
  sat date := current_date + (((6 - extract(isodow from current_date)::int) + 7) % 7) + 7;
  u_poster uuid := gen_random_uuid();
  u_sup uuid := gen_random_uuid();
  u_ana uuid := gen_random_uuid();
  u_ben uuid := gen_random_uuid();
  u_out uuid := gen_random_uuid();
  e_sup uuid; e_ana uuid; e_ben uuid;
  ask1 uuid; ask2 uuid;
  m1 uuid; m2 uuid; m3 uuid;
  n int;
  failed boolean;
BEGIN
  INSERT INTO auth.users (id, email, instance_id, aud, role)
  SELECT u, 'zz-' || u || '@example.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'
    FROM unnest(ARRAY[u_poster, u_sup, u_ana, u_ben, u_out]) u;
  UPDATE public.user_roles SET role = 'admin' WHERE user_id = u_poster;
  IF NOT FOUND THEN INSERT INTO public.user_roles (user_id, role) VALUES (u_poster, 'admin'); END IF;
  UPDATE public.user_roles SET role = 'manager' WHERE user_id = u_sup;
  IF NOT FOUND THEN INSERT INTO public.user_roles (user_id, role) VALUES (u_sup, 'manager'); END IF;
  UPDATE public.user_roles SET role = 'employee' WHERE user_id IN (u_ana, u_ben, u_out);
  INSERT INTO public.user_roles (user_id, role)
  SELECT u, 'employee' FROM unnest(ARRAY[u_ana, u_ben, u_out]) u
   WHERE NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = u);

  INSERT INTO public.employees (full_name, active, user_id) VALUES ('ZZ Supervisor', true, u_sup) RETURNING id INTO e_sup;
  -- Ana has a manager on file; Ben has none.
  INSERT INTO public.employees (full_name, active, user_id, manager_id) VALUES ('ZZ Ana', true, u_ana, e_sup) RETURNING id INTO e_ana;
  INSERT INTO public.employees (full_name, active, user_id) VALUES ('ZZ Ben', true, u_ben) RETURNING id INTO e_ben;

  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, created_by)
  VALUES (sat, '06:00', '14:00', NULL, u_poster) RETURNING id INTO ask1;
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, created_by)
  VALUES (sat + 1, '06:00', '14:00', 1, u_poster) RETURNING id INTO ask2;

  -- 1. Who supervises whom.
  PERFORM pg_temp.expect_true('1a supervisor_login_of reads manager_id', public.supervisor_login_of(e_ana) = u_sup);
  PERFORM pg_temp.expect_true('1b nobody on file is null', public.supervisor_login_of(e_ben) IS NULL);
  PERFORM pg_temp.as_user(u_ana);
  PERFORM pg_temp.expect_true('1c my_supervisor names them',
    (SELECT lower(full_name) FROM public.my_supervisor()) = 'zz supervisor');

  -- 2. Ana's yes is booked at once, and each supervisor is told exactly once.
  PERFORM public.answer_overtime(ask1, 'yes');
  PERFORM pg_temp.expect_true('2a a yes is confirmed immediately',
    (SELECT decision FROM public.overtime_responses WHERE request_id = ask1 AND employee_id = e_ana) = 'accepted');
  PERFORM pg_temp.expect_true('2b only Ana is confirmed, not the ask',
    (SELECT status FROM public.overtime_requests WHERE id = ask1) = 'open');
  SELECT count(*) INTO n FROM public.notifications WHERE user_id = u_sup AND kind = 'overtime_yes' AND title ILIKE 'zz ana is coming in';
  PERFORM pg_temp.expect_true('2c the supervisor on file gets one row, got ' || n, n = 1);
  SELECT count(*) INTO n FROM public.notifications WHERE user_id = u_poster AND kind = 'overtime_yes' AND title ILIKE 'zz ana is coming in';
  PERFORM pg_temp.expect_true('2d the poster gets one row, got ' || n, n = 1);
  SELECT count(*) INTO n FROM public.notifications WHERE user_id = u_ana AND kind = 'overtime_booked';
  PERFORM pg_temp.expect_true('2e Ana is told she is booked, got ' || n, n = 1);

  -- A retry of the same yes is refused (decided) and rings nobody.
  BEGIN
    PERFORM public.answer_overtime(ask1, 'yes');
  EXCEPTION WHEN others THEN NULL;
  END;
  SELECT count(*) INTO n FROM public.notifications WHERE user_id = u_sup AND kind = 'overtime_yes' AND title ILIKE 'zz ana is coming in';
  PERFORM pg_temp.expect_true('2f a retried yes does not ring again, got ' || n, n = 1);

  -- A reserve later accepted is a change for Ana, but not a second ring for the supervisor.
  PERFORM pg_temp.as_user(u_ben);
  PERFORM public.answer_overtime(ask2, 'yes');
  PERFORM pg_temp.as_user(u_ana);
  PERFORM public.answer_overtime(ask2, 'yes');
  PERFORM pg_temp.expect_true('2g a full numbered ask puts Ana on reserve',
    (SELECT decision FROM public.overtime_responses WHERE request_id = ask2 AND employee_id = e_ana) = 'reserve');
  PERFORM pg_temp.as_user(u_poster);
  UPDATE public.overtime_responses SET decision = 'reserve' WHERE request_id = ask2 AND employee_id = e_ben;
  UPDATE public.overtime_responses SET decision = 'accepted' WHERE request_id = ask2 AND employee_id = e_ana;
  SELECT count(*) INTO n FROM public.notifications WHERE user_id = u_sup AND kind = 'overtime_yes' AND title ILIKE 'zz ana%';
  PERFORM pg_temp.expect_true('2h Ana on two asks, reserve then accepted: the supervisor has two rows, got ' || n, n = 2);
  SELECT count(*) INTO n FROM public.notifications WHERE user_id = u_poster AND kind = 'overtime_yes' AND title ILIKE 'zz ben%';
  PERFORM pg_temp.expect_true('2i the poster hears of Ben too (one row per person), got ' || n, n = 1);
  SELECT count(*) INTO n FROM public.notifications WHERE user_id = u_poster AND kind = 'overtime_yes' AND title ILIKE 'zz ana%';
  PERFORM pg_temp.expect_true('2j and not again for their own Accept, got ' || n, n = 2);

  -- 3. The chat goes to the supervisor on file.
  PERFORM pg_temp.as_user(u_ana);
  m1 := public.message_my_supervisor('Running 10 minutes late');
  PERFORM pg_temp.expect_true('3a message_my_supervisor writes to the manager',
    (SELECT recipient_id FROM public.direct_messages WHERE id = m1) = u_sup);
  m2 := public.message_my_supervisor('Running 10 minutes late');
  PERFORM pg_temp.expect_true('3b a retry returns the same message', m2 = m1);
  SELECT count(*) INTO n FROM public.direct_messages WHERE sender_id = u_ana;
  PERFORM pg_temp.expect_true('3c one message, not two, got ' || n, n = 1);
  SELECT count(*) INTO n FROM public.notifications WHERE user_id = u_sup AND kind = 'overtime_message';
  PERFORM pg_temp.expect_true('3d the supervisor gets one bell row, got ' || n, n = 1);
  m3 := public.message_overtime_supervisor(ask1, 'Can I start at 07:00?');
  PERFORM pg_temp.expect_true('3e about an ask, still the manager on file',
    (SELECT recipient_id FROM public.direct_messages WHERE id = m3) = u_sup);

  -- Ben has no manager: about an ask it falls back to the poster; without one it says so.
  PERFORM pg_temp.as_user(u_ben);
  m3 := public.message_overtime_supervisor(ask2, 'Thanks');
  PERFORM pg_temp.expect_true('3f no manager: the poster of the ask',
    (SELECT recipient_id FROM public.direct_messages WHERE id = m3) = u_poster);
  failed := false;
  BEGIN
    PERFORM public.message_my_supervisor('Hello?');
  EXCEPTION WHEN others THEN failed := SQLERRM LIKE 'No supervisor is on file%';
  END;
  PERFORM pg_temp.expect_true('3g no manager on file is refused with the reason', failed);

  -- 4. The supervisor replies (the ordinary chat insert) and Ana is rung.
  PERFORM pg_temp.as_user(u_sup);
  INSERT INTO public.direct_messages (sender_id, sender_name, recipient_id, message)
  VALUES (u_sup, 'ZZ Supervisor', u_ana, 'OK, see you at 07:00');
  SELECT count(*) INTO n FROM public.notifications
   WHERE user_id = u_ana AND kind = 'chat_message' AND action_url = '/dashboard/my-overtime?chat=supervisor';
  PERFORM pg_temp.expect_true('4a the reply rings the employee, got ' || n, n = 1);

  -- 5. A recipient may mark a message read, and nothing else.
  UPDATE public.direct_messages SET read_at = now() WHERE id = m1;
  failed := false;
  BEGIN
    UPDATE public.direct_messages SET message = 'I will not come' WHERE id = m1;
  EXCEPTION WHEN others THEN failed := true;
  END;
  PERFORM pg_temp.expect_true('5a a message text cannot be rewritten', failed);

  INSERT INTO zz_ids VALUES ('ana', u_ana), ('sup', u_sup), ('out', u_out), ('m1', m1);
END $$;

-- 6. RLS: somebody else cannot read the conversation, its two people can.
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user((SELECT v FROM zz_ids WHERE k = 'out'));
SELECT pg_temp.expect_true('6a an outsider reads none of it',
  (SELECT count(*) FROM public.direct_messages
    WHERE sender_id = (SELECT v FROM zz_ids WHERE k = 'ana') OR recipient_id = (SELECT v FROM zz_ids WHERE k = 'ana')) = 0);
SELECT pg_temp.as_user((SELECT v FROM zz_ids WHERE k = 'ana'));
SELECT pg_temp.expect_true('6b the employee reads both sides',
  (SELECT count(*) FROM public.direct_messages
    WHERE sender_id = (SELECT v FROM zz_ids WHERE k = 'ana') OR recipient_id = (SELECT v FROM zz_ids WHERE k = 'ana')) >= 3);
-- An employee cannot aim a message at somebody else directly: the routing policy refuses.
DO $$
DECLARE failed boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.direct_messages (sender_id, sender_name, recipient_id, message)
    VALUES ((SELECT v FROM zz_ids WHERE k = 'ana'), 'ZZ Ana', (SELECT v FROM zz_ids WHERE k = 'out'), 'hi');
  EXCEPTION WHEN others THEN failed := true;
  END;
  PERFORM pg_temp.expect_true('6c an employee cannot write to an arbitrary user', failed);
END $$;
-- Nor call the internal helpers.
DO $$
DECLARE failed boolean := false;
BEGIN
  BEGIN
    PERFORM public.dm_from_employee((SELECT v FROM zz_ids WHERE k = 'out'), 'x', 'x');
  EXCEPTION WHEN insufficient_privilege THEN failed := true;
  END;
  PERFORM pg_temp.expect_true('6d dm_from_employee is not callable', failed);
END $$;
RESET ROLE;

SELECT 'ALL TESTS PASSED' AS result;
ROLLBACK;
