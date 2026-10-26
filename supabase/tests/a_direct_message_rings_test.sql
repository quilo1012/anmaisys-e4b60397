-- Tests for BLOCO 134: a direct message rings the bell of whoever it is for.
--
-- Run this WHOLE file in one go, in the SQL editor, after BLOCO 134. One transaction,
-- its own throwaway people, ROLLBACK at the end. The last statement prints
-- 'ALL TESTS PASSED'; any failure raises first, naming the case. It must run as a role
-- that bypasses RLS (the SQL editor's postgres role does). None of the throwaway logins
-- has a push subscription, so no phone is buzzed by running this.

BEGIN;

CREATE FUNCTION pg_temp.expect_true(_case text, _got boolean) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF _got IS NOT TRUE THEN RAISE EXCEPTION 'FAILED %', _case; END IF;
END $$;

DO $$
DECLARE
  mgr uuid := gen_random_uuid();   -- manager
  sup uuid := gen_random_uuid();   -- supervisor
  adm uuid := gen_random_uuid();   -- admin
  emp uuid := gen_random_uuid();   -- employee, active
  emp2 uuid := gen_random_uuid();  -- employee, active
  n int;
  v_title text; v_url text; v_kind text; v_body text;
BEGIN
  INSERT INTO auth.users (id, email, instance_id, aud, role)
  SELECT u, 'zz-' || u || '@example.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'
    FROM unnest(array[mgr, sup, adm, emp, emp2]) u;
  INSERT INTO public.user_roles (user_id, role) VALUES
    (mgr, 'manager'), (sup, 'supervisor'), (adm, 'admin'), (emp, 'employee'), (emp2, 'employee');
  INSERT INTO public.employees (full_name, department, shift_group, active, user_id) VALUES
    ('ZZ Bell Employee', 'Production', 'Day', true, emp),
    ('ZZ Bell Employee Two', 'Production', 'Day', true, emp2);

  -- 1. Staff to staff: a manager writes to a supervisor. Before BLOCO 134, nothing.
  INSERT INTO public.direct_messages (sender_id, sender_name, recipient_id, message)
  VALUES (mgr, 'ZZ Manager', sup, 'Can you cover line 3?');
  SELECT kind, title, action_url, body INTO v_kind, v_title, v_url, v_body
    FROM public.notifications WHERE user_id = sup;
  PERFORM pg_temp.expect_true('manager to supervisor rings: ' || coalesce(v_title, '<no row>'),
    v_kind = 'chat_message' AND v_title = 'ZZ Manager sent you a message'
    AND v_url = '/dashboard/messages?c=dm:' || mgr AND v_body = 'Can you cover line 3?');

  -- 2. An employee answering a manager in the hub. Before BLOCO 134, nothing.
  INSERT INTO public.direct_messages (sender_id, sender_name, recipient_id, message)
  VALUES (emp, 'ZZ Bell Employee', mgr, 'Yes, I can.');
  PERFORM pg_temp.expect_true('employee to manager rings',
    EXISTS (SELECT 1 FROM public.notifications WHERE user_id = mgr AND kind = 'chat_message'
             AND title = 'ZZ Bell Employee sent you a message'
             AND action_url = '/dashboard/messages?c=dm:' || emp));

  -- 3. Admin to supervisor, with an empty sender name.
  INSERT INTO public.direct_messages (sender_id, sender_name, recipient_id, message)
  VALUES (adm, '', sup, 'FYI');
  PERFORM pg_temp.expect_true('a nameless sender is "Somebody"',
    EXISTS (SELECT 1 FROM public.notifications WHERE user_id = sup AND title = 'Somebody sent you a message'
             AND action_url = '/dashboard/messages?c=dm:' || adm));

  -- 4. Unchanged: employee to employee (BLOCO 114's case 2).
  INSERT INTO public.direct_messages (sender_id, sender_name, recipient_id, message)
  VALUES (emp, 'ZZ Bell Employee', emp2, 'Hi');
  PERFORM pg_temp.expect_true('employee to employee unchanged',
    EXISTS (SELECT 1 FROM public.notifications WHERE user_id = emp2 AND kind = 'chat_message'
             AND title = 'ZZ Bell Employee sent you a message'
             AND action_url = '/dashboard/messages?c=dm:' || emp));

  -- 5. Unchanged: staff to an active employee (case 3).
  INSERT INTO public.direct_messages (sender_id, sender_name, recipient_id, message)
  VALUES (sup, 'ZZ Supervisor', emp, 'See you Saturday');
  PERFORM pg_temp.expect_true('supervisor to employee unchanged',
    EXISTS (SELECT 1 FROM public.notifications WHERE user_id = emp AND kind = 'chat_message'
             AND title = 'ZZ Supervisor replied'
             AND action_url = '/dashboard/my-overtime?chat=supervisor'));

  -- 6. Unchanged: the overtime door (case 1) rings 'overtime_message', once.
  SELECT count(*) INTO n FROM public.notifications WHERE user_id = sup;
  PERFORM set_config('app.dm_door', 'employee', true);
  INSERT INTO public.direct_messages (sender_id, sender_name, recipient_id, message)
  VALUES (emp, 'ZZ Bell Employee', sup, 'About Saturday');
  PERFORM set_config('app.dm_door', '', true);
  PERFORM pg_temp.expect_true('the overtime door rings once, as overtime_message',
    (SELECT count(*) FROM public.notifications WHERE user_id = sup) = n + 1
    AND EXISTS (SELECT 1 FROM public.notifications WHERE user_id = sup AND kind = 'overtime_message'
                 AND title = 'ZZ Bell Employee sent you a message'));

  -- 7. One row per message, never two.
  SELECT count(*) INTO n FROM public.notifications WHERE user_id IN (mgr, sup, adm, emp, emp2);
  PERFORM pg_temp.expect_true('one bell row per message (6 messages)', n = 6);

  -- 8. The body is cut at 200 characters.
  INSERT INTO public.direct_messages (sender_id, sender_name, recipient_id, message)
  VALUES (mgr, 'ZZ Manager', adm, repeat('x', 500));
  PERFORM pg_temp.expect_true('a long message is cut to 200 characters',
    (SELECT length(body) FROM public.notifications WHERE user_id = adm) = 200);
END $$;

SELECT 'ALL TESTS PASSED' AS result;

ROLLBACK;
