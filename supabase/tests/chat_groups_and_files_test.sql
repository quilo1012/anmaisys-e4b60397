-- Tests for 20261019160000_conversations_have_groups_photos_and_files.sql (BLOCO 108).
--
-- Run this WHOLE file in one go, in the SQL editor, after BLOCO 108. One transaction,
-- its own throwaway people, groups, messages and files, ROLLBACK at the end. The last
-- statement prints 'ALL TESTS PASSED'; any failure raises first, naming the case. Runs
-- as the SQL editor's postgres role; the RLS cases switch to `authenticated` and back.

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

-- Runs `_sql` as `_uid` under RLS and says whether it was refused (any error).
CREATE FUNCTION pg_temp.refused(_uid uuid, _sql text) RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.as_user(_uid);
  SET LOCAL ROLE authenticated;
  BEGIN
    EXECUTE _sql;
  EXCEPTION WHEN others THEN
    RESET ROLE;
    RETURN true;
  END;
  RESET ROLE;
  RETURN false;
END $$;

-- Runs a count query as `_uid` under RLS.
CREATE FUNCTION pg_temp.count_as(_uid uuid, _sql text) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  PERFORM pg_temp.as_user(_uid);
  SET LOCAL ROLE authenticated;
  EXECUTE _sql INTO n;
  RESET ROLE;
  RETURN n;
END $$;

CREATE TEMP TABLE zz_ids (k text PRIMARY KEY, v uuid);
GRANT ALL ON zz_ids TO authenticated;

DO $$
DECLARE
  u_admin uuid := gen_random_uuid();
  u_sup   uuid := gen_random_uuid();   -- runs ZZ Packing (own record + reports)
  u_sup2  uuid := gen_random_uuid();   -- runs ZZ Blending
  u_ana   uuid := gen_random_uuid();   -- ZZ Packing, Day crew, reports to u_sup
  u_ben   uuid := gen_random_uuid();   -- ZZ Packing, Night crew
  u_cat   uuid := gen_random_uuid();   -- ZZ Blending
  u_office uuid := gen_random_uuid();  -- production office admin, no record
  e_sup uuid; e_sup2 uuid;
  g1 uuid; g2 uuid; g3 uuid; m1 uuid := gen_random_uuid(); m2 uuid := gen_random_uuid(); r uuid;
  dm1 uuid; n int; v text;
  pair text;
BEGIN
  INSERT INTO auth.users (id, email, instance_id, aud, role)
  SELECT u, 'zz-' || u || '@example.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'
    FROM unnest(ARRAY[u_admin, u_sup, u_sup2, u_ana, u_ben, u_cat, u_office]) u;
  INSERT INTO public.profiles (id, email, name)
  SELECT u, 'zz-' || u || '@example.invalid', 'ZZ ' || left(u::text, 4)
    FROM unnest(ARRAY[u_admin, u_sup, u_sup2, u_ana, u_ben, u_cat, u_office]) u
  ON CONFLICT (id) DO NOTHING;
  DELETE FROM public.user_roles WHERE user_id IN (u_admin, u_sup, u_sup2, u_ana, u_ben, u_cat, u_office);
  INSERT INTO public.user_roles (user_id, role) VALUES
    (u_admin, 'admin'), (u_sup, 'supervisor'), (u_sup2, 'supervisor'),
    (u_ana, 'employee'), (u_ben, 'employee'), (u_cat, 'employee'), (u_office, 'production_office_admin');

  INSERT INTO public.employees (full_name, active, user_id, department, shift_group)
  VALUES ('ZZ Sup', true, u_sup, 'ZZ Packing', 'Day') RETURNING id INTO e_sup;
  INSERT INTO public.employees (full_name, active, user_id, department, shift_group)
  VALUES ('ZZ Sup2', true, u_sup2, 'ZZ Blending', 'Day') RETURNING id INTO e_sup2;
  INSERT INTO public.employees (full_name, active, user_id, department, shift_group, manager_id) VALUES
    ('ZZ Ana', true, u_ana, 'ZZ Packing', 'Day', e_sup),
    ('ZZ Ben', true, u_ben, 'ZZ Packing', 'Night', NULL),
    ('ZZ Cat', true, u_cat, 'ZZ Blending', 'Day', e_sup2);

  INSERT INTO zz_ids VALUES ('admin', u_admin), ('sup', u_sup), ('sup2', u_sup2), ('ana', u_ana),
    ('ben', u_ben), ('cat', u_cat), ('office', u_office);

  -- 1. Who creates groups, and for which department.
  PERFORM pg_temp.expect_true('1a an employee cannot create a group',
    pg_temp.refused(u_ana, $q$select public.chat_create_group('department', 'ZZ nope', 'ZZ Packing')$q$));
  PERFORM pg_temp.expect_true('1b a supervisor cannot create a group for a department they do not run',
    pg_temp.refused(u_sup, $q$select public.chat_create_group('department', 'ZZ nope', 'ZZ Blending')$q$));
  PERFORM pg_temp.expect_true('1c a supervisor cannot put somebody of another department in',
    pg_temp.refused(u_sup, format($q$select public.chat_create_group('department', 'ZZ nope', 'ZZ Packing', null, null, array[%L]::uuid[])$q$, u_cat)));
  PERFORM pg_temp.expect_true('1d a team group needs its crew',
    pg_temp.refused(u_sup, $q$select public.chat_create_group('team', 'ZZ nope', 'ZZ Packing')$q$));
  PERFORM pg_temp.expect_true('1e an office admin with no record runs no department',
    pg_temp.refused(u_office, $q$select public.chat_create_group('department', 'ZZ nope', 'ZZ Packing')$q$));

  PERFORM pg_temp.as_user(u_sup);
  SET LOCAL ROLE authenticated;
  g1 := public.chat_create_group('department', 'ZZ Packing all', 'ZZ Packing', null, 'Everyone', ARRAY[u_ana, u_ben]);
  PERFORM pg_temp.expect_true('1f a team group only takes its crew',
    (SELECT pg_temp.refused(u_sup, format($q$select public.chat_create_group('team', 'ZZ A', 'ZZ Packing', 'Day', null, array[%L]::uuid[])$q$, u_ben))));
  PERFORM pg_temp.as_user(u_sup);
  SET LOCAL ROLE authenticated;
  g2 := public.chat_create_group('team', 'ZZ Packing A', 'ZZ Packing', 'Day', null, ARRAY[u_ana]);
  RESET ROLE;
  INSERT INTO zz_ids VALUES ('g1', g1), ('g2', g2);

  PERFORM pg_temp.expect_true('1g the creator manages the group',
    (SELECT role = 'manager' FROM public.chat_group_members WHERE group_id = g1 AND user_id = u_sup));
  PERFORM pg_temp.expect_true('1h creation and additions are recorded',
    (SELECT count(*) = 3 FROM public.chat_group_events WHERE group_id = g1));

  PERFORM pg_temp.as_user(u_admin);
  SET LOCAL ROLE authenticated;
  g3 := public.chat_create_group('department', 'ZZ Leads', 'ZZ Blending', null, null, ARRAY[u_sup, u_cat]);
  RESET ROLE;
  PERFORM pg_temp.expect_true('1i an admin creates a group in any department, with anybody',
    (SELECT count(*) = 3 FROM public.chat_group_members WHERE group_id = g3 AND left_at IS NULL));

  -- 2. Reading is for members.
  PERFORM pg_temp.expect_true('2a a member sees the group',
    pg_temp.count_as(u_ana, format('select count(*) from public.chat_groups where id = %L', g1)) = 1);
  PERFORM pg_temp.expect_true('2b a non-member does not see the group',
    pg_temp.count_as(u_cat, format('select count(*) from public.chat_groups where id = %L', g1)) = 0);
  PERFORM pg_temp.expect_true('2c an admin who is not a member does not see its messages',
    pg_temp.count_as(u_admin, format('select count(*) from public.chat_groups where id = %L', g1)) = 0);

  -- 3. Writing.
  PERFORM pg_temp.as_user(u_ana);
  SET LOCAL ROLE authenticated;
  PERFORM public.chat_send_group_message(m1, g1, 'Line 3 is down');
  PERFORM public.chat_send_group_message(m1, g1, 'Line 3 is down');   -- a retry
  PERFORM public.chat_send_group_message(m2, g1, 'Back up now');
  RESET ROLE;
  PERFORM pg_temp.expect_true('3a a retry is the same message',
    (SELECT count(*) = 2 FROM public.chat_group_messages WHERE group_id = g1));
  PERFORM pg_temp.expect_true('3b a non-member cannot write',
    pg_temp.refused(u_cat, format($q$select public.chat_send_group_message(gen_random_uuid(), %L, 'hi')$q$, g1)));
  PERFORM pg_temp.expect_true('3c nobody inserts straight into the table (no impersonation)',
    pg_temp.refused(u_ana, format($q$insert into public.chat_group_messages (group_id, sender_id, body) values (%L, %L, 'as Ben')$q$, g1, u_ben)));
  PERFORM pg_temp.expect_true('3d a message cannot be edited',
    pg_temp.refused(u_ana, format($q$update public.chat_group_messages set body = 'x' where id = %L$q$, m1)));
  PERFORM pg_temp.expect_true('3e nobody makes themselves a member',
    pg_temp.refused(u_cat, format($q$insert into public.chat_group_members (group_id, user_id) values (%L, %L)$q$, g1, u_cat)));
  PERFORM pg_temp.expect_true('3f a reply must be to a message of the same group',
    pg_temp.refused(u_sup, format($q$select public.chat_send_group_message(gen_random_uuid(), %L, 'x', %L)$q$, g3, m1)));

  -- 4. Unread and the bell.
  PERFORM pg_temp.as_user(u_ben);
  SET LOCAL ROLE authenticated;
  SELECT unread INTO n FROM public.chat_my_groups() WHERE id = g1;
  RESET ROLE;
  PERFORM pg_temp.expect_true('4a two unread for Ben', n = 2);
  PERFORM pg_temp.as_user(u_ana);
  SET LOCAL ROLE authenticated;
  SELECT unread INTO n FROM public.chat_my_groups() WHERE id = g1;
  RESET ROLE;
  PERFORM pg_temp.expect_true('4b nothing unread for the sender', n = 0);
  PERFORM pg_temp.expect_true('4c one bell per member, not one per message',
    (SELECT count(*) = 1 FROM public.notifications WHERE user_id = u_ben AND kind = 'chat_group'));
  PERFORM pg_temp.expect_true('4d the sender is not rung',
    (SELECT count(*) = 0 FROM public.notifications WHERE user_id = u_ana AND kind = 'chat_group'));
  PERFORM pg_temp.expect_true('4e the bell never carries the words',
    (SELECT bool_and(body NOT LIKE '%Line 3%' AND body NOT LIKE '%Back up%' AND title NOT LIKE '%Line 3%')
       FROM public.notifications WHERE kind = 'chat_group' AND user_id IN (u_ben, u_sup)));
  PERFORM pg_temp.as_user(u_ben);
  SET LOCAL ROLE authenticated;
  PERFORM public.chat_mark_group_read(g1);
  SELECT unread INTO n FROM public.chat_my_groups() WHERE id = g1;
  RESET ROLE;
  PERFORM pg_temp.expect_true('4f reading clears the count', n = 0);
  PERFORM pg_temp.expect_true('4g reading clears the bell',
    (SELECT count(*) = 0 FROM public.notifications WHERE user_id = u_ben AND kind = 'chat_group' AND read_at IS NULL));

  -- 5. Membership changes.
  PERFORM pg_temp.expect_true('5a an employee cannot add people',
    pg_temp.refused(u_ana, format($q$select public.chat_add_members(%L, array[%L]::uuid[])$q$, g1, u_ben)));
  PERFORM pg_temp.expect_true('5b a supervisor cannot remove another manager',
    pg_temp.refused(u_sup, format($q$select public.chat_remove_member(%L, %L)$q$, g3, u_admin)));
  PERFORM pg_temp.expect_true('5c only an admin names managers',
    pg_temp.refused(u_sup, format($q$select public.chat_set_member_role(%L, %L, 'manager')$q$, g1, u_ana)));
  PERFORM pg_temp.expect_true('5d nobody promotes themselves',
    pg_temp.refused(u_ana, format($q$update public.chat_group_members set role = 'manager' where group_id = %L and user_id = %L$q$, g1, u_ana)));
  PERFORM pg_temp.as_user(u_sup);
  SET LOCAL ROLE authenticated;
  PERFORM public.chat_remove_member(g1, u_ben);
  RESET ROLE;
  PERFORM pg_temp.expect_true('5e a removed member reads nothing, history included',
    pg_temp.count_as(u_ben, format('select count(*) from public.chat_group_messages where group_id = %L', g1)) = 0);
  PERFORM pg_temp.expect_true('5f a removed member cannot write',
    pg_temp.refused(u_ben, format($q$select public.chat_send_group_message(gen_random_uuid(), %L, 'still here?')$q$, g1)));
  PERFORM pg_temp.expect_true('5g the removal is recorded',
    (SELECT count(*) = 1 FROM public.chat_group_events WHERE group_id = g1 AND action = 'member_removed' AND target_user_id = u_ben));
  PERFORM pg_temp.as_user(u_sup);
  SET LOCAL ROLE authenticated;
  PERFORM public.chat_add_members(g1, ARRAY[u_ben]);
  RESET ROLE;
  PERFORM pg_temp.expect_true('5h re-added, the history is back',
    pg_temp.count_as(u_ben, format('select count(*) from public.chat_group_messages where group_id = %L', g1)) = 2);

  -- 6. Files.
  INSERT INTO storage.objects (bucket_id, name, owner, metadata)
  VALUES ('chat-files', 'g/' || g1 || '/' || m2 || '/rota.pdf', u_ana, '{"size": 2048, "mimetype": "application/pdf"}'),
         ('chat-files', 'g/' || g1 || '/' || m2 || '/not-mine.pdf', u_ben, '{"size": 10, "mimetype": "application/pdf"}');
  PERFORM pg_temp.expect_true('6a a file of somebody else cannot be attached',
    pg_temp.refused(u_ana, format($q$select public.chat_record_attachments(%L, null, jsonb_build_array(jsonb_build_object('path', %L, 'name', 'x.pdf')))$q$,
      m2, 'g/' || g1 || '/' || m2 || '/not-mine.pdf')));
  PERFORM pg_temp.expect_true('6b only the sender attaches to a message',
    pg_temp.refused(u_sup, format($q$select public.chat_record_attachments(%L, null, jsonb_build_array(jsonb_build_object('path', %L, 'name', 'x.pdf')))$q$,
      m2, 'g/' || g1 || '/' || m2 || '/rota.pdf')));
  PERFORM pg_temp.as_user(u_ana);
  SET LOCAL ROLE authenticated;
  PERFORM public.chat_record_attachments(m2, null,
    jsonb_build_array(jsonb_build_object('path', 'g/' || g1 || '/' || m2 || '/rota.pdf', 'name', 'Rota.pdf', 'size', 1)));
  RESET ROLE;
  PERFORM pg_temp.expect_true('6c the recorded size and type are what storage measured',
    (SELECT size_bytes = 2048 AND content_type = 'application/pdf' FROM public.chat_attachments
      WHERE storage_path = 'g/' || g1 || '/' || m2 || '/rota.pdf'));
  PERFORM pg_temp.expect_true('6d a member sees the attachment',
    pg_temp.count_as(u_sup, 'select count(*) from public.chat_attachments where group_message_id = ''' || m2 || '''') = 1);
  PERFORM pg_temp.expect_true('6e a non-member does not',
    pg_temp.count_as(u_cat, 'select count(*) from public.chat_attachments where group_message_id = ''' || m2 || '''') = 0);
  PERFORM pg_temp.expect_true('6f a non-member cannot read the file in storage',
    pg_temp.count_as(u_cat, format('select count(*) from storage.objects where bucket_id = %L and name like %L', 'chat-files', 'g/' || g1 || '/%')) = 0);
  PERFORM pg_temp.expect_true('6g a member can',
    pg_temp.count_as(u_sup, format('select count(*) from storage.objects where bucket_id = %L and name like %L', 'chat-files', 'g/' || g1 || '/%')) = 2);
  PERFORM pg_temp.expect_true('6h a non-member cannot upload into the group',
    pg_temp.refused(u_cat, format($q$insert into storage.objects (bucket_id, name, owner) values ('chat-files', %L, %L)$q$, 'g/' || g1 || '/x/evil.pdf', u_cat)));
  pair := least(u_sup, u_ana)::text || '_' || greatest(u_sup, u_ana)::text;
  PERFORM pg_temp.expect_true('6i a third person cannot upload into a private pair',
    pg_temp.refused(u_ben, format($q$insert into storage.objects (bucket_id, name, owner) values ('chat-files', %L, %L)$q$, 'dm/' || pair || '/x/evil.pdf', u_ben)));
  PERFORM pg_temp.expect_true('6j the pair can',
    NOT pg_temp.refused(u_ana, format($q$insert into storage.objects (bucket_id, name, owner) values ('chat-files', %L, %L)$q$, 'dm/' || pair || '/x/ok.pdf', u_ana)));
  PERFORM pg_temp.expect_true('6k a pair folder in the wrong order is nobody''s',
    pg_temp.refused(u_ana, format($q$insert into storage.objects (bucket_id, name, owner) values ('chat-files', %L, %L)$q$,
      'dm/' || greatest(u_sup, u_ana)::text || '_' || least(u_sup, u_ana)::text || '/x/bad.pdf', u_ana)));

  -- 7. Private messages stay private; an admin is not a reader of everybody's.
  INSERT INTO public.direct_messages (sender_id, sender_name, recipient_id, message)
  VALUES (u_ana, 'ZZ Ana', u_sup, 'Can I swap Saturday?') RETURNING id INTO dm1;
  INSERT INTO public.direct_messages (sender_id, sender_name, recipient_id, message)
  VALUES (u_sup, 'ZZ Sup', u_ana, 'Yes'), (u_ana, 'ZZ Ana', u_sup, 'Thanks');
  PERFORM pg_temp.expect_true('7a an admin does not read two other people''s messages',
    pg_temp.count_as(u_admin, format('select count(*) from public.direct_messages where id = %L', dm1)) = 0);
  PERFORM pg_temp.expect_true('7b one conversation per pair, however many messages',
    pg_temp.count_as(u_sup, format('select count(*) from public.chat_my_dm_summaries() where partner_id = %L', u_ana)) = 1);
  PERFORM pg_temp.expect_true('7c the summary counts what is unread',
    pg_temp.count_as(u_sup, format('select unread from public.chat_my_dm_summaries() where partner_id = %L', u_ana)) = 2);
  PERFORM pg_temp.expect_true('7d a third person''s summary does not see the pair',
    pg_temp.count_as(u_ben, format('select count(*) from public.chat_my_dm_summaries() where partner_id in (%L, %L)', u_ana, u_sup)) = 0);
  PERFORM pg_temp.expect_true('7e only the sender attaches to a private message',
    pg_temp.refused(u_sup, format($q$select public.chat_record_attachments(null, %L, jsonb_build_array(jsonb_build_object('path', %L)))$q$, dm1, 'dm/' || pair || '/x/ok.pdf')));

  -- 8. Photos.
  PERFORM pg_temp.expect_true('8a a photo is not set by writing the column',
    pg_temp.refused(u_ana, format($q$update public.profiles set avatar_path = %L where id = %L$q$, u_ana || '/me.jpg', u_ana)));
  PERFORM pg_temp.expect_true('8b nobody sets another person''s photo',
    pg_temp.refused(u_ana, format($q$select public.set_avatar(%L, %L)$q$, u_ben || '/x.jpg', u_ben)));
  PERFORM pg_temp.expect_true('8c nor points theirs at another person''s file',
    pg_temp.refused(u_ana, format($q$select public.set_avatar(%L)$q$, u_ben || '/x.jpg')));
  PERFORM pg_temp.expect_true('8d a person sets their own',
    NOT pg_temp.refused(u_ana, format($q$select public.set_avatar(%L)$q$, u_ana || '/me.jpg')));
  PERFORM pg_temp.expect_true('8e it is set',
    (SELECT avatar_path = u_ana || '/me.jpg' FROM public.profiles WHERE id = u_ana));
  PERFORM pg_temp.expect_true('8f an admin may set anybody''s',
    NOT pg_temp.refused(u_admin, format($q$select public.set_avatar(%L, %L)$q$, u_ben || '/b.jpg', u_ben)));
  PERFORM pg_temp.expect_true('8g nobody uploads into another person''s photo folder',
    pg_temp.refused(u_ana, format($q$insert into storage.objects (bucket_id, name, owner) values ('avatars', %L, %L)$q$, u_ben || '/evil.jpg', u_ana)));
  PERFORM pg_temp.expect_true('8h a group''s photo is its managers''',
    pg_temp.refused(u_ana, format($q$insert into storage.objects (bucket_id, name, owner) values ('avatars', %L, %L)$q$, 'groups/' || g1 || '/p.jpg', u_ana))
    AND NOT pg_temp.refused(u_sup, format($q$insert into storage.objects (bucket_id, name, owner) values ('avatars', %L, %L)$q$, 'groups/' || g1 || '/p.jpg', u_sup)));

  -- 9. Nothing here helps anybody discover a group they are not in.
  PERFORM pg_temp.expect_true('9a the membership check answers only about the caller',
    pg_temp.refused(u_cat, format($q$select public.chat_is_member(%L, %L)$q$, u_ana, g1)));
  PERFORM pg_temp.expect_true('9b a non-member cannot list a group''s people',
    pg_temp.refused(u_cat, format($q$select * from public.chat_group_people(%L)$q$, g1)));
END $$;

SELECT 'ALL TESTS PASSED' AS result;
ROLLBACK;
