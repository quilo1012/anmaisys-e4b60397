-- Tests for 20261020100000_the_hub_lists_whoever_the_rule_lets_you_write_to.sql (BLOCO 109).
--
-- Run this WHOLE file in one go, in the SQL editor, after BLOCO 114 (it also covers 109). One transaction,
-- its own throwaway people, ROLLBACK at the end; the last statement prints
-- 'ALL TESTS PASSED' and any failure raises first, naming the case.
--
-- The point: the hub lists a person exactly when the real insert rule
-- ("dm_insert_routing") would let the message through. Checked pair by pair, by
-- actually attempting the insert under RLS.

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

-- Whether the insert rule lets _from write to _to: tried for real, then undone.
CREATE FUNCTION pg_temp.insert_allowed(_from uuid, _to uuid) RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.as_user(_from);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.direct_messages (sender_id, sender_name, recipient_id, message)
    VALUES (_from, 'zz', _to, 'zz probe');
    RAISE EXCEPTION 'zz_undo';
  EXCEPTION
    WHEN raise_exception THEN
      RESET ROLE;
      IF SQLERRM = 'zz_undo' THEN RETURN true; END IF;
      RETURN false;
    WHEN others THEN
      RESET ROLE;
      RETURN false;
  END;
END $$;

CREATE FUNCTION pg_temp.listed(_caller uuid) RETURNS uuid[]
LANGUAGE plpgsql AS $$
DECLARE out uuid[];
BEGIN
  PERFORM pg_temp.as_user(_caller);
  SET LOCAL ROLE authenticated;
  SELECT coalesce(array_agg(user_id), '{}') INTO out FROM public.chat_contactable_people();
  RESET ROLE;
  RETURN out;
END $$;

DO $$
DECLARE
  people uuid[];
  roles text[] := ARRAY['admin', 'manager', 'supervisor', 'operator', 'employee', 'employee',
                        'production_office_admin', 'quality_supervisor'];
  u uuid; v uuid; i int;
  e_sup uuid; e_emp uuid;
  got uuid[];
  n_pairs int := 0;
BEGIN
  people := ARRAY(SELECT gen_random_uuid() FROM generate_series(1, array_length(roles, 1)));
  INSERT INTO auth.users (id, email, instance_id, aud, role)
  SELECT p, 'zz-' || p || '@example.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'
    FROM unnest(people) p;
  INSERT INTO public.profiles (id, email, name)
  SELECT p, 'zz-' || p || '@example.invalid', 'ZZ ' || left(p::text, 4) FROM unnest(people) p
  ON CONFLICT (id) DO NOTHING;
  DELETE FROM public.user_roles WHERE user_id = ANY (people);
  FOR i IN 1 .. array_length(roles, 1) LOOP
    INSERT INTO public.user_roles (user_id, role) VALUES (people[i], roles[i]::app_role);
  END LOOP;

  -- The first employee (people[5]) has the supervisor (people[3]) on file; the second
  -- (people[6]) has nobody.
  INSERT INTO public.employees (full_name, active, user_id, department) VALUES ('ZZ Sup', true, people[3], 'ZZ Dept')
    RETURNING id INTO e_sup;
  INSERT INTO public.employees (full_name, active, user_id, department, manager_id)
    VALUES ('ZZ Ana Quiló', true, people[5], 'ZZ Dept', e_sup) RETURNING id INTO e_emp;
  INSERT INTO public.employees (full_name, active, user_id, department) VALUES ('ZZ Ben', true, people[6], 'ZZ Dept');

  -- 1. Listed exactly when the insert rule allows it — every pair of the eight.
  FOREACH u IN ARRAY people LOOP
    got := pg_temp.listed(u);
    FOREACH v IN ARRAY people LOOP
      CONTINUE WHEN u = v;
      n_pairs := n_pairs + 1;
      -- The employee's door (message_my_supervisor) is the one listing the insert
      -- rule does not cover: it is a function, not an insert.
      CONTINUE WHEN u = people[5] AND v = people[3];
      PERFORM pg_temp.expect_true(
        format('1 %s -> %s: listed=%s, insert allowed=%s', roles[array_position(people, u)], roles[array_position(people, v)],
               v = ANY (got), pg_temp.insert_allowed(u, v)),
        (v = ANY (got)) = pg_temp.insert_allowed(u, v));
    END LOOP;
  END LOOP;
  PERFORM pg_temp.expect_true('1z all pairs checked', n_pairs = 56);

  -- 2. The cases the report was about.
  PERFORM pg_temp.expect_true('2a an admin finds the employees',
    people[5] = ANY (pg_temp.listed(people[1])) AND people[6] = ANY (pg_temp.listed(people[1])));
  PERFORM pg_temp.expect_true('2b an employee finds the supervisor on file',
    people[3] = ANY (pg_temp.listed(people[5])));
  -- BLOCO 114: employees may write to each other, and to nobody else on their own.
  -- Not "= ARRAY[people[5]]": the real employees in the database are listed too.
  got := pg_temp.listed(people[6]);
  PERFORM pg_temp.expect_true('2c an employee with nobody on file finds the other employee, and only employees',
    people[5] = ANY (got)
    AND NOT EXISTS (SELECT 1 FROM unnest(got) g WHERE NOT public.has_role(g, 'employee'::app_role)));
  PERFORM pg_temp.expect_true('2d an employee finds the other employee but not admins, managers or operators',
    people[6] = ANY (pg_temp.listed(people[5]))
    AND NOT (people[1] = ANY (pg_temp.listed(people[5])))
    AND NOT (people[2] = ANY (pg_temp.listed(people[5])))
    AND NOT (people[4] = ANY (pg_temp.listed(people[5]))));
  PERFORM pg_temp.expect_true('2e an admin does not find operators (the rule keeps them to supervisors)',
    NOT (people[4] = ANY (pg_temp.listed(people[1]))));

  -- 3. Inactive logins are not offered.
  UPDATE public.profiles SET active = false WHERE id = people[6];
  PERFORM pg_temp.expect_true('3 an inactive login is not listed', NOT (people[6] = ANY (pg_temp.listed(people[1]))));

  -- 4. The name is the one on the employee record, accents and all.
  PERFORM pg_temp.as_user(people[1]);
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.expect_true('4 the employee record''s name is used',
    (SELECT c.name = e.full_name AND e.full_name ILIKE '%Quiló'
       FROM public.chat_contactable_people() c JOIN public.employees e ON e.user_id = c.user_id
      WHERE c.user_id = people[5]));
  RESET ROLE;

  -- 4b. BLOCO 114: a message between two employees rings the other one's bell, and opens Messages.
  UPDATE public.profiles SET active = true WHERE id = people[6];
  PERFORM pg_temp.as_user(people[5]);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.direct_messages (sender_id, sender_name, recipient_id, message)
  VALUES (people[5], 'ZZ Ana', people[6], 'zz hello colleague');
  RESET ROLE;
  PERFORM pg_temp.expect_true('4b the colleague is rung, and the link opens the conversation',
    EXISTS (SELECT 1 FROM public.notifications n
             WHERE n.user_id = people[6] AND n.title = 'ZZ Ana sent you a message'
               AND n.action_url = '/dashboard/messages?c=dm:' || people[5]));
  PERFORM pg_temp.expect_true('4c ... and not as "Your supervisor replied"',
    NOT EXISTS (SELECT 1 FROM public.notifications n WHERE n.user_id = people[6] AND n.title LIKE '%replied'));

  -- 5. Nobody signed in gets nothing, and the decision function is not callable.
  PERFORM set_config('request.jwt.claims', '{}', true);
  PERFORM pg_temp.expect_true('5a no caller, no list', (SELECT count(*) = 0 FROM public.chat_contactable_people()));
  PERFORM pg_temp.as_user(people[5]);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.chat_may_start(people[1], people[5]);
    RESET ROLE;
    RAISE EXCEPTION 'FAILED 5b chat_may_start is callable by a signed-in user';
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
  END;
END $$;

SELECT 'ALL TESTS PASSED' AS result;
ROLLBACK;
