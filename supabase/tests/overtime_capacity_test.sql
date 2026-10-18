-- Tests for 20261018140000_an_ask_holds_only_the_places_it_has.sql (BLOCO 101).
--
-- Run this WHOLE file in one go, in the SQL editor, after BLOCO 101. One transaction,
-- its own throwaway people and ask, ROLLBACK at the end. The last statement prints
-- 'ALL TESTS PASSED'; any failure raises first, naming the case. It must run as a role
-- that bypasses RLS (the SQL editor's postgres role does).

BEGIN;

CREATE FUNCTION pg_temp.expect_true(_case text, _got boolean) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF _got IS NOT TRUE THEN RAISE EXCEPTION 'FAILED %', _case; END IF;
END $$;

-- Runs _sql and fails the case unless it raises with a message containing _like.
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

DO $$
DECLARE
  v_creator uuid;
  sat date := current_date + (((6 - extract(isodow from current_date)::int) + 7) % 7) + 7;
  e1 uuid; e2 uuid; e3 uuid; e4 uuid;
  r1 uuid; r2 uuid; r3 uuid; r4 uuid;
  ask uuid;
  n int; r record;
BEGIN
  v_creator := gen_random_uuid();
  INSERT INTO auth.users (id, email, instance_id, aud, role)
  VALUES (v_creator, 'zz-' || v_creator || '@example.invalid',
          '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');

  INSERT INTO public.employees (full_name, department, shift_group, active)
  VALUES ('ZZ One', 'Production', 'Day', true) RETURNING id INTO e1;
  INSERT INTO public.employees (full_name, department, shift_group, active)
  VALUES ('ZZ Two', 'Production', 'Day', true) RETURNING id INTO e2;
  INSERT INTO public.employees (full_name, department, shift_group, active)
  VALUES ('ZZ Three', 'Production', 'Day', true) RETURNING id INTO e3;
  INSERT INTO public.employees (full_name, department, shift_group, active)
  VALUES ('ZZ Four', 'Production', 'Day', true) RETURNING id INTO e4;

  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, department, created_by)
  VALUES (sat, '06:00', '14:00', 2, 'Production', v_creator) RETURNING id INTO ask;

  INSERT INTO public.overtime_responses (request_id, employee_id, answer) VALUES (ask, e1, 'yes') RETURNING id INTO r1;
  INSERT INTO public.overtime_responses (request_id, employee_id, answer) VALUES (ask, e2, 'yes') RETURNING id INTO r2;
  INSERT INTO public.overtime_responses (request_id, employee_id, answer) VALUES (ask, e3, 'yes') RETURNING id INTO r3;
  INSERT INTO public.overtime_responses (request_id, employee_id, answer) VALUES (ask, e4, 'yes') RETURNING id INTO r4;

  -- 1. Two places, two accepts.
  UPDATE public.overtime_responses SET decision = 'accepted' WHERE id IN (r1, r2);
  PERFORM pg_temp.expect_true('1. two accepted on an ask for two',
    public.overtime_places_taken(ask) = 2);

  -- 2. The third is refused, and a reserve is not.
  PERFORM pg_temp.expect_refused('2. a third accept on an ask for two',
    format('UPDATE public.overtime_responses SET decision = %L WHERE id = %L', 'accepted', r3),
    'places on this overtime are filled');
  UPDATE public.overtime_responses SET decision = 'reserve' WHERE id = r3;

  -- 3. An insert that arrives already accepted is counted the same way.
  DELETE FROM public.overtime_responses WHERE id = r4;
  PERFORM pg_temp.expect_refused('3. an insert already accepted, past the headcount',
    format('INSERT INTO public.overtime_responses (request_id, employee_id, answer, decision) VALUES (%L, %L, %L, %L)',
           ask, e4, 'yes', 'accepted'),
    'places on this overtime are filled');

  -- 4. Re-saving an accepted row is not a new accept.
  UPDATE public.overtime_responses SET decision = 'accepted', decided_at = now() WHERE id = r1;

  -- 5. The headcount cannot drop below the people already in; up and back is fine.
  PERFORM pg_temp.expect_refused('5. lowering two accepted to one place',
    format('UPDATE public.overtime_requests SET headcount = 1 WHERE id = %L', ask),
    'already accepted');
  UPDATE public.overtime_requests SET headcount = 3 WHERE id = ask;
  UPDATE public.overtime_responses SET decision = 'accepted' WHERE id = r3;
  PERFORM pg_temp.expect_refused('5b. lowering three accepted to two',
    format('UPDATE public.overtime_requests SET headcount = 2 WHERE id = %L', ask),
    'already accepted');
  UPDATE public.overtime_responses SET decision = 'reserve' WHERE id = r3;
  UPDATE public.overtime_requests SET headcount = 2 WHERE id = ask;

  -- 6. Somebody who dropped out no longer holds a place: the reserve can step in.
  INSERT INTO public.overtime_outcomes (response_id, outcome, recorded_by, recorded_at)
  VALUES (r1, 'called_sick', v_creator, now());
  PERFORM pg_temp.expect_true('6. a dropped-out accept frees its place',
    public.overtime_places_taken(ask) = 1);
  UPDATE public.overtime_responses SET decision = 'accepted' WHERE id = r3;
  PERFORM pg_temp.expect_true('6b. the reserve took the freed place',
    public.overtime_places_taken(ask) = 2);

  -- 7. Somebody who attended still holds theirs.
  INSERT INTO public.overtime_outcomes (response_id, outcome, recorded_by, recorded_at)
  VALUES (r2, 'attended', v_creator, now());
  PERFORM pg_temp.expect_true('7. an attended accept still holds its place',
    public.overtime_places_taken(ask) = 2);

  -- 8. Undoing an accept is always allowed.
  UPDATE public.overtime_responses SET decision = NULL WHERE id = r3;
  PERFORM pg_temp.expect_true('8. undo frees the place',
    public.overtime_places_taken(ask) = 1);

  -- 9. overtime_places: counts per ask, for a signed-in caller only.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_creator, 'role', 'authenticated')::text, true);
  SELECT * INTO r FROM public.overtime_places(ARRAY[ask]);
  PERFORM pg_temp.expect_true('9. overtime_places reports taken and headcount',
    r.request_id = ask AND r.taken = 1 AND r.headcount = 2);
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM pg_temp.expect_refused('9b. overtime_places without a login',
    format('SELECT * FROM public.overtime_places(ARRAY[%L]::uuid[])', ask),
    'Sign in first');

  -- 10. Nobody but authenticated may call the counts.
  PERFORM pg_temp.expect_true('10. anon cannot execute overtime_places',
    NOT has_function_privilege('anon', 'public.overtime_places(uuid[])', 'execute'));
  PERFORM pg_temp.expect_true('10b. the guard is not callable',
    NOT has_function_privilege('authenticated', 'public.overtime_response_capacity_guard()', 'execute'));
END $$;

SELECT 'ALL TESTS PASSED' AS result;

ROLLBACK;
