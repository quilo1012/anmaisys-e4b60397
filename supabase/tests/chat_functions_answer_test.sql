-- Tests for 20261020110000_a_groups_people_list_names_its_columns.sql (BLOCO 110).
--
-- Every list the Communication Hub reads, called on its HAPPY path, as a real user.
-- BLOCO 108's test only called `chat_group_people` as an outsider, which raises
-- before the query that was broken; this one calls each function where it returns
-- rows. One transaction, ROLLBACK at the end; prints 'ALL TESTS PASSED'.

BEGIN;

CREATE FUNCTION pg_temp.expect_true(_case text, _got boolean) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF _got IS NOT TRUE THEN RAISE EXCEPTION 'FAILED %', _case; END IF;
END $$;

DO $$
DECLARE
  u_sup uuid := gen_random_uuid();
  u_ana uuid := gen_random_uuid();
  e_sup uuid;
  g uuid;
  n int;
BEGIN
  INSERT INTO auth.users (id, email, instance_id, aud, role)
  SELECT u, 'zz-' || u || '@example.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'
    FROM unnest(ARRAY[u_sup, u_ana]) u;
  INSERT INTO public.profiles (id, email, name)
  SELECT u, 'zz-' || u || '@example.invalid', 'ZZ ' || left(u::text, 4) FROM unnest(ARRAY[u_sup, u_ana]) u
  ON CONFLICT (id) DO NOTHING;
  DELETE FROM public.user_roles WHERE user_id IN (u_sup, u_ana);
  INSERT INTO public.user_roles (user_id, role) VALUES (u_sup, 'supervisor'), (u_ana, 'employee');
  INSERT INTO public.employees (full_name, active, user_id, department, shift_group)
  VALUES ('ZZ Sup', true, u_sup, 'ZZ Dept', 'Day') RETURNING id INTO e_sup;
  INSERT INTO public.employees (full_name, active, user_id, department, shift_group, manager_id)
  VALUES ('ZZ Ana', true, u_ana, 'ZZ Dept', 'Day', e_sup);
  INSERT INTO public.direct_messages (sender_id, sender_name, recipient_id, message) VALUES (u_ana, 'ZZ Ana', u_sup, 'hi');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_sup, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  g := public.chat_create_group('team', 'ZZ Day', 'ZZ Dept', 'Day', null, ARRAY[u_ana]);
  PERFORM public.chat_send_group_message(gen_random_uuid(), g, 'hello');

  SELECT count(*) INTO n FROM public.chat_group_people(g);
  PERFORM pg_temp.expect_true('1 chat_group_people lists the two members', n = 2);
  SELECT count(*) INTO n FROM public.chat_eligible_members('ZZ Dept', 'Day');
  PERFORM pg_temp.expect_true('2 chat_eligible_members lists Ana', n = 1);
  SELECT count(*) INTO n FROM public.chat_my_group_scope() WHERE department = 'ZZ Dept';
  PERFORM pg_temp.expect_true('3 chat_my_group_scope has the department', n = 1);
  SELECT count(*) INTO n FROM public.chat_my_groups() WHERE id = g;
  PERFORM pg_temp.expect_true('4 chat_my_groups has the group', n = 1);
  SELECT count(*) INTO n FROM public.chat_people(ARRAY[u_sup, u_ana]);
  PERFORM pg_temp.expect_true('5 chat_people names both', n = 2);
  SELECT count(*) INTO n FROM public.chat_my_dm_summaries() WHERE partner_id = u_ana;
  PERFORM pg_temp.expect_true('6 chat_my_dm_summaries has the conversation', n = 1);
  SELECT count(*) INTO n FROM public.chat_contactable_people() WHERE user_id = u_ana;
  PERFORM pg_temp.expect_true('7 chat_contactable_people lets the supervisor find Ana', n = 1);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_ana, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO n FROM public.chat_contactable_people() WHERE user_id = u_sup;
  PERFORM pg_temp.expect_true('8 chat_contactable_people lets Ana find her supervisor', n = 1);
  SELECT count(*) INTO n FROM public.chat_group_people(g);
  PERFORM pg_temp.expect_true('9 a member lists the group''s people', n = 2);
  RESET ROLE;
END $$;

SELECT 'ALL TESTS PASSED' AS result;
ROLLBACK;
