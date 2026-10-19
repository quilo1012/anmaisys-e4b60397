-- Tests for 20261019110000_a_yes_already_given_is_booked_too.sql (BLOCO 105).
--
-- Run this WHOLE file in one go, in the SQL editor, after BLOCO 105. One transaction,
-- its own throwaway people and asks, ROLLBACK at the end. The last statement prints
-- 'ALL TESTS PASSED'; any failure raises first, naming the case. Runs as the SQL
-- editor's postgres role.
--
-- NOTE: it calls overtime_book_waiting_yeses() again inside the transaction, which
-- would also book any real undecided yes that appeared since the paste — and then the
-- ROLLBACK undoes that too. Nothing outside the test survives.

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

DO $$
DECLARE
  sat date := current_date + (((6 - extract(isodow from current_date)::int) + 7) % 7) + 7;
  u_sup uuid := gen_random_uuid();
  u_a uuid := gen_random_uuid();
  u_b uuid := gen_random_uuid();
  u_c uuid := gen_random_uuid();
  u_busy uuid := gen_random_uuid();
  e_a uuid; e_b uuid; e_c uuid; e_busy uuid; e_nologin uuid;
  ask_free uuid; ask_two uuid; ask_past uuid; ask_shut uuid; ask_desk uuid; ask_up uuid;
  r public.overtime_responses;
  v record;
  n int;
BEGIN
  INSERT INTO auth.users (id, email, instance_id, aud, role)
  SELECT u, 'zz-' || u || '@example.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'
    FROM unnest(ARRAY[u_sup, u_a, u_b, u_c, u_busy]) u;
  -- An auth.users row makes a user_roles row by trigger; the supervisor is an admin.
  UPDATE public.user_roles SET role = 'admin' WHERE user_id = u_sup;
  IF NOT FOUND THEN INSERT INTO public.user_roles (user_id, role) VALUES (u_sup, 'admin'); END IF;

  INSERT INTO public.employees (full_name, active, user_id) VALUES ('ZZ A', true, u_a) RETURNING id INTO e_a;
  INSERT INTO public.employees (full_name, active, user_id) VALUES ('ZZ B', true, u_b) RETURNING id INTO e_b;
  INSERT INTO public.employees (full_name, active, user_id) VALUES ('ZZ C', true, u_c) RETURNING id INTO e_c;
  INSERT INTO public.employees (full_name, active, user_id) VALUES ('ZZ Busy', true, u_busy) RETURNING id INTO e_busy;
  INSERT INTO public.employees (full_name, active) VALUES ('ZZ No Login', true) RETURNING id INTO e_nologin;

  -- Busy is on Saturday's day board already: a yes for those hours clashes.
  INSERT INTO public.daily_allocations (on_date, shift, employee_id, status)
  VALUES (sat, 'Day', e_busy, 'assigned');

  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, created_by)
  VALUES (sat, '06:00', '14:00', NULL, u_sup) RETURNING id INTO ask_free;
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, created_by)
  VALUES (sat + 1, '06:00', '14:00', 2, u_sup) RETURNING id INTO ask_two;
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, created_by)
  VALUES (current_date - 3, '06:00', '14:00', NULL, u_sup) RETURNING id INTO ask_past;
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, created_by, status)
  VALUES (sat + 2, '06:00', '14:00', NULL, u_sup, 'cancelled') RETURNING id INTO ask_shut;

  -- Yeses written the way they were before BLOCO 102: undecided. No session, so no
  -- trigger books them; answered_at spaced so "oldest first" is testable.
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO public.overtime_responses (request_id, employee_id, answer, answered_at) VALUES
    (ask_free, e_a,       'yes', now() - interval '3 hours'),
    (ask_free, e_busy,    'yes', now() - interval '3 hours'),
    (ask_free, e_nologin, 'yes', now() - interval '2 hours'),
    (ask_free, e_b,       'no',  now() - interval '2 hours'),
    (ask_two,  e_c,       'yes', now() - interval '1 hour'),
    (ask_two,  e_a,       'yes', now() - interval '3 hours'),
    (ask_two,  e_b,       'yes', now() - interval '2 hours'),
    (ask_past, e_a,       'yes', now() - interval '5 days'),
    (ask_shut, e_a,       'yes', now() - interval '1 day');

  -- 1. The backfill.
  SELECT * INTO v FROM public.overtime_book_waiting_yeses();

  PERFORM pg_temp.expect_true('1. a waiting yes on an open ask is booked',
    (SELECT decision FROM public.overtime_responses WHERE request_id = ask_free AND employee_id = e_a) = 'accepted');
  PERFORM pg_temp.expect_true('1b. a yes from somebody with no login is booked too',
    (SELECT decision FROM public.overtime_responses WHERE request_id = ask_free AND employee_id = e_nologin) = 'accepted');
  PERFORM pg_temp.expect_true('1c. a clashing yes is left for the supervisor',
    (SELECT decision FROM public.overtime_responses WHERE request_id = ask_free AND employee_id = e_busy) IS NULL);
  PERFORM pg_temp.expect_true('1d. a no stays a no',
    (SELECT decision FROM public.overtime_responses WHERE request_id = ask_free AND employee_id = e_b) IS NULL);

  -- 2. A numbered ask: oldest two booked, the third on reserve — and nothing raised.
  PERFORM pg_temp.expect_true('2. oldest yes booked first',
    (SELECT decision FROM public.overtime_responses WHERE request_id = ask_two AND employee_id = e_a) = 'accepted');
  PERFORM pg_temp.expect_true('2b. second oldest booked',
    (SELECT decision FROM public.overtime_responses WHERE request_id = ask_two AND employee_id = e_b) = 'accepted');
  PERFORM pg_temp.expect_true('2c. past the number, reserve',
    (SELECT decision FROM public.overtime_responses WHERE request_id = ask_two AND employee_id = e_c) = 'reserve');

  -- 3. Past and cancelled asks are left as they were.
  PERFORM pg_temp.expect_true('3. a yes on an ask already worked is untouched',
    (SELECT decision FROM public.overtime_responses WHERE request_id = ask_past) IS NULL);
  PERFORM pg_temp.expect_true('3b. a yes on a cancelled ask is untouched',
    (SELECT decision FROM public.overtime_responses WHERE request_id = ask_shut) IS NULL);

  -- 4. Each booked person with a login is told, once.
  SELECT count(*) INTO n FROM public.notifications WHERE user_id = u_a AND kind = 'overtime_booked';
  PERFORM pg_temp.expect_true('4. A is told twice: two asks', n = 2);
  PERFORM pg_temp.expect_true('4b. the reserve is told it is on reserve',
    EXISTS (SELECT 1 FROM public.notifications WHERE user_id = u_c AND kind = 'overtime_booked'
             AND title = 'You''re on the overtime reserve list'));
  PERFORM pg_temp.expect_true('4c. the clashing person is not told anything',
    NOT EXISTS (SELECT 1 FROM public.notifications WHERE user_id = u_busy AND kind = 'overtime_booked'));

  -- 5. The board draws the bookings (the BLOCO 93 bridge).
  PERFORM pg_temp.expect_true('5. a booking is on the board as overtime',
    EXISTS (SELECT 1 FROM public.daily_allocations WHERE employee_id = e_a AND on_date = sat AND status = 'overtime'));

  -- 6. Run twice: nothing new.
  SELECT * INTO v FROM public.overtime_book_waiting_yeses();
  PERFORM pg_temp.expect_true('6. a second run books nobody', v.booked = 0 AND v.reserved = 0);
  SELECT count(*) INTO n FROM public.notifications WHERE user_id = u_a AND kind = 'overtime_booked';
  PERFORM pg_temp.expect_true('6b. and tells nobody again', n = 2);

  -- 7. A yes the supervisor types in at the desk is booked; the supervisor is not
  --    told about their own entry.
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, created_by)
  VALUES (sat + 3, '06:00', '14:00', NULL, u_sup) RETURNING id INTO ask_desk;
  PERFORM pg_temp.as_user(u_sup);
  INSERT INTO public.overtime_responses (request_id, employee_id, answer)
  VALUES (ask_desk, e_b, 'yes') RETURNING * INTO r;
  PERFORM pg_temp.expect_true('7. a desk yes is booked', r.decision = 'accepted');
  PERFORM pg_temp.expect_true('7b. the person is told',
    EXISTS (SELECT 1 FROM public.notifications WHERE user_id = u_b AND kind = 'overtime_booked'));
  PERFORM pg_temp.expect_true('7c. the supervisor is not told about their own entry',
    NOT EXISTS (SELECT 1 FROM public.notifications WHERE user_id = u_sup AND kind = 'overtime_yes'));

  -- 8. ...but not on top of the person's own hours: left for the supervisor to judge.
  UPDATE public.overtime_requests SET on_date = sat WHERE id = ask_desk;
  INSERT INTO public.overtime_responses (request_id, employee_id, answer)
  VALUES (ask_desk, e_busy, 'yes') RETURNING * INTO r;
  PERFORM pg_temp.expect_true('8. a clashing desk yes waits', r.decision IS NULL);

  -- 9. The employee's own yes is still booked (BLOCO 102 unchanged for them).
  PERFORM pg_temp.as_user(u_c);
  r := public.answer_overtime(ask_free, 'yes');
  PERFORM pg_temp.expect_true('9. own yes booked', r.decision = 'accepted');
  PERFORM pg_temp.expect_true('9b. the poster is told',
    EXISTS (SELECT 1 FROM public.notifications WHERE user_id = u_sup AND kind = 'overtime_yes' AND title ILIKE 'ZZ C is coming in'));

  -- 11. The desk writes with an upsert. A yes over B's earlier "no" is booked and rings
  --     B's bell once — not once for the insert that never happened and once more.
  --     (Its own ask: B is already booked on Saturday's day hours by case 8's move.)
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, created_by)
  VALUES (sat + 5, '06:00', '14:00', NULL, u_sup) RETURNING id INTO ask_up;
  INSERT INTO public.overtime_responses (request_id, employee_id, answer) VALUES (ask_up, e_b, 'no');
  PERFORM pg_temp.as_user(u_sup);
  INSERT INTO public.overtime_responses (request_id, employee_id, answer, answered_at)
  VALUES (ask_up, e_b, 'yes', now())
  ON CONFLICT (request_id, employee_id) DO UPDATE SET answer = excluded.answer, answered_at = excluded.answered_at;
  PERFORM pg_temp.expect_true('11. a desk yes over a no is booked',
    (SELECT decision FROM public.overtime_responses WHERE request_id = ask_up AND employee_id = e_b) = 'accepted');
  SELECT count(*) INTO n FROM public.notifications
   WHERE user_id = u_b AND kind = 'overtime_booked' AND action_url = '/dashboard/my-overtime?ask=' || ask_up;
  PERFORM pg_temp.expect_true('11b. and rings once', n = 1);
  PERFORM pg_temp.expect_true('11c. and is drawn on the board',
    EXISTS (SELECT 1 FROM public.daily_allocations WHERE employee_id = e_b AND on_date = sat + 5 AND status = 'overtime'));

  -- 12. The same upsert over a yes already booked changes nothing and rings nothing.
  INSERT INTO public.overtime_responses (request_id, employee_id, answer, answered_at)
  VALUES (ask_up, e_b, 'yes', now())
  ON CONFLICT (request_id, employee_id) DO UPDATE SET answer = excluded.answer, answered_at = excluded.answered_at;
  SELECT count(*) INTO n FROM public.notifications
   WHERE user_id = u_b AND kind = 'overtime_booked' AND action_url = '/dashboard/my-overtime?ask=' || ask_up;
  PERFORM pg_temp.expect_true('12. a repeated yes rings nothing', n = 1);

  -- 13. The backlog did not flood the poster: only live bookings told them.
  SELECT count(*) INTO n FROM public.notifications WHERE user_id = u_sup AND kind = 'overtime_yes';
  PERFORM pg_temp.expect_true('13. the poster was told once, by C''s own yes', n = 1);

  PERFORM set_config('request.jwt.claims', '', true);
END $$;

-- 10. Nobody but the owner runs the backfill.
SELECT pg_temp.expect_true('10. authenticated cannot run the backfill',
  NOT has_function_privilege('authenticated', 'public.overtime_book_waiting_yeses()', 'execute'));
SELECT pg_temp.expect_true('10b. anon cannot run the backfill',
  NOT has_function_privilege('anon', 'public.overtime_book_waiting_yeses()', 'execute'));

SELECT 'ALL TESTS PASSED' AS result;

ROLLBACK;
