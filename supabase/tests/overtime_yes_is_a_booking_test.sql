-- Tests for 20261018160000_a_yes_is_a_booking.sql (BLOCO 102).
--
-- Run this WHOLE file in one go, in the SQL editor, after BLOCOS 100, 101 and 102. One
-- transaction, its own throwaway people and asks, ROLLBACK at the end. The last
-- statement prints 'ALL TESTS PASSED'; any failure raises first, naming the case. It
-- must run as a role that bypasses RLS (the SQL editor's postgres role does); the RLS
-- cases switch to `authenticated` themselves.

BEGIN;

CREATE FUNCTION pg_temp.expect_true(_case text, _got boolean) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF _got IS NOT TRUE THEN RAISE EXCEPTION 'FAILED %', _case; END IF;
END $$;

CREATE FUNCTION pg_temp.expect_refused(_case text, _sql text, _like text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE _sql;
  EXCEPTION WHEN others THEN
    IF position(_like in SQLERRM) = 0 THEN
      RAISE EXCEPTION 'FAILED % (refused for the wrong reason: %)', _case, SQLERRM;
    END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'FAILED % (was not refused)', _case;
END $$;

CREATE FUNCTION pg_temp.as_user(_uid uuid) RETURNS void
LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
$$;

CREATE TEMP TABLE zz_ids (k text PRIMARY KEY, v uuid);
GRANT SELECT ON zz_ids TO authenticated;

DO $$
DECLARE
  sat date := current_date + (((6 - extract(isodow from current_date)::int) + 7) % 7) + 7;
  u_sup uuid := gen_random_uuid();
  u_ana uuid := gen_random_uuid();
  u_rui uuid := gen_random_uuid();
  u_out uuid := gen_random_uuid();
  u_nobody uuid := gen_random_uuid();
  e_ana uuid; e_rui uuid; e_out uuid;
  ask_open uuid; ask_one uuid; ask_prod uuid;
  r public.overtime_responses;
  n int;
BEGIN
  INSERT INTO auth.users (id, email, instance_id, aud, role)
  SELECT u, 'zz-' || u || '@example.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'
    FROM unnest(ARRAY[u_sup, u_ana, u_rui, u_out, u_nobody]) u;

  INSERT INTO public.employees (full_name, department, shift_group, active, user_id)
  VALUES ('ZZ Ana', 'Production', 'Day', true, u_ana) RETURNING id INTO e_ana;
  INSERT INTO public.employees (full_name, department, shift_group, active, user_id)
  VALUES ('ZZ Rui', 'Production', 'Day', true, u_rui) RETURNING id INTO e_rui;
  INSERT INTO public.employees (full_name, department, shift_group, active, user_id)
  VALUES ('ZZ Out', 'Warehouse', 'Day', true, u_out) RETURNING id INTO e_out;

  -- 1. An ask needs no number.
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, created_by)
  VALUES (sat, '06:00', '14:00', NULL, u_sup) RETURNING id INTO ask_open;
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, created_by)
  VALUES (sat, '14:00', '18:00', 1, u_sup) RETURNING id INTO ask_one;
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, department, created_by)
  VALUES (sat + 1, '06:00', '14:00', 'Production', u_sup) RETURNING id INTO ask_prod;

  -- 2. A yes is booked there and then, and the poster is told.
  PERFORM pg_temp.as_user(u_ana);
  r := public.answer_overtime(ask_open, 'yes');
  PERFORM pg_temp.expect_true('2. a yes is accepted at once', r.answer = 'yes' AND r.decision = 'accepted');
  SELECT count(*) INTO n FROM public.notifications WHERE user_id = u_sup AND kind = 'overtime_yes';
  PERFORM pg_temp.expect_true('2b. whoever posted the ask gets a bell row', n = 1);
  PERFORM pg_temp.expect_true('2c. the bell row names the person',
    EXISTS (SELECT 1 FROM public.notifications WHERE user_id = u_sup AND kind = 'overtime_yes' AND title ILIKE 'ZZ Ana is coming in'));

  PERFORM pg_temp.expect_true('2d. the booking is on the board as overtime (the BLOCO 93 bridge)',
    EXISTS (SELECT 1 FROM public.daily_allocations WHERE employee_id = e_ana AND on_date = sat AND status = 'overtime'));

  PERFORM pg_temp.expect_true('2e. the person is told too',
    EXISTS (SELECT 1 FROM public.notifications WHERE user_id = u_ana AND kind = 'overtime_booked'
             AND title = 'You''re booked for overtime'));

  -- 3. A booked yes is not taken back from the phone.
  PERFORM pg_temp.expect_refused('3. no after a booked yes',
    format('SELECT public.answer_overtime(%L, %L)', ask_open, 'no'), 'already decided');

  -- 4. A no stays a no, undecided.
  PERFORM pg_temp.as_user(u_rui);
  r := public.answer_overtime(ask_open, 'no');
  PERFORM pg_temp.expect_true('4. a no is not booked', r.answer = 'no' AND r.decision IS NULL);

  -- 5. An ask that kept a number still holds it: past it, a yes waits on reserve.
  PERFORM pg_temp.as_user(u_ana);
  r := public.answer_overtime(ask_one, 'yes');
  PERFORM pg_temp.expect_true('5. first yes on a one-place ask is accepted', r.decision = 'accepted');
  PERFORM pg_temp.as_user(u_rui);
  r := public.answer_overtime(ask_one, 'yes');
  PERFORM pg_temp.expect_true('5b. the second goes on reserve', r.decision = 'reserve');

  -- 6. The audience still decides who may say yes.
  PERFORM pg_temp.as_user(u_out);
  PERFORM pg_temp.expect_refused('6. outside the department',
    format('SELECT public.answer_overtime(%L, %L)', ask_prod, 'yes'), 'you are not in it');

  -- 7. A message to whoever posted the ask lands in the chat and rings the bell.
  PERFORM pg_temp.as_user(u_ana);
  PERFORM public.message_overtime_supervisor(ask_open, '  I may be 10 minutes late  ');
  PERFORM pg_temp.expect_true('7. the message is in the chat, from Ana to the poster',
    EXISTS (SELECT 1 FROM public.direct_messages
             WHERE sender_id = u_ana AND recipient_id = u_sup AND sender_name ILIKE 'ZZ Ana'
               AND message LIKE 'Overtime % 06:00–14:00: I may be 10 minutes late'));
  PERFORM pg_temp.expect_true('7b. the poster is told',
    EXISTS (SELECT 1 FROM public.notifications WHERE user_id = u_sup AND kind = 'overtime_message'));
  PERFORM pg_temp.expect_refused('7c. an empty message',
    format('SELECT public.message_overtime_supervisor(%L, %L)', ask_open, '   '), 'Write a message first');

  -- 8. Only about an ask put to them.
  PERFORM pg_temp.as_user(u_out);
  PERFORM pg_temp.expect_refused('8. a message about an ask for another department',
    format('SELECT public.message_overtime_supervisor(%L, %L)', ask_prod, 'hello'), 'not asked of you');

  -- 8b. A yes typed in at the desk by a supervisor stays for the supervisor to accept.
  PERFORM pg_temp.as_user(u_sup);
  INSERT INTO public.overtime_responses (request_id, employee_id, answer)
  VALUES (ask_prod, e_rui, 'yes') RETURNING * INTO r;
  PERFORM pg_temp.expect_true('8b. a desk yes is not self-booked', r.decision IS NULL);

  -- 8c. A reserve is told it is on reserve.
  PERFORM pg_temp.expect_true('8c. the reserve hears it is on the reserve list',
    EXISTS (SELECT 1 FROM public.notifications WHERE user_id = u_rui AND kind = 'overtime_booked'
             AND title = 'You''re on the overtime reserve list'));

  -- 9. Without a linked employee there is no message.
  PERFORM pg_temp.as_user(u_nobody);
  PERFORM pg_temp.expect_refused('9. a login with no employee',
    format('SELECT public.message_overtime_supervisor(%L, %L)', ask_open, 'hello'), 'No employee record');

  INSERT INTO zz_ids VALUES ('sup', u_sup), ('ana', u_ana), ('nobody', u_nobody);
  PERFORM set_config('request.jwt.claims', '', true);
END $$;

-- 10. The supervisor can answer; somebody Ana never wrote to cannot write to her this way.
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user((SELECT v FROM zz_ids WHERE k = 'sup'));
INSERT INTO public.direct_messages (sender_id, sender_name, recipient_id, message)
SELECT (SELECT v FROM zz_ids WHERE k = 'sup'), 'ZZ Sup', (SELECT v FROM zz_ids WHERE k = 'ana'), 'Fine, see you then';
SELECT pg_temp.as_user((SELECT v FROM zz_ids WHERE k = 'nobody'));
SELECT pg_temp.expect_refused('10. a stranger writing to Ana',
  format('INSERT INTO public.direct_messages (sender_id, sender_name, recipient_id, message) VALUES (%L, %L, %L, %L)',
         (SELECT v FROM zz_ids WHERE k = 'nobody'), 'X', (SELECT v FROM zz_ids WHERE k = 'ana'), 'hi'),
  'row-level security');
RESET ROLE;

SELECT pg_temp.expect_true('10b. the reply is there',
  EXISTS (SELECT 1 FROM public.direct_messages WHERE message = 'Fine, see you then'));

-- 11. Nobody without a session runs the new function.
SELECT pg_temp.expect_true('11. anon cannot message a supervisor',
  NOT has_function_privilege('anon', 'public.message_overtime_supervisor(uuid, text)', 'execute'));

SELECT 'ALL TESTS PASSED' AS result;

ROLLBACK;
