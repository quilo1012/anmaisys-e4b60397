-- Tests for 20261021240000_a_phone_belongs_to_one_login_and_every_group_message_buzzes.sql (BLOCO 121).
-- Run this WHOLE file in one go in the Supabase SQL Editor after BLOCO 121. One transaction,
-- throwaway people, ROLLBACK at the end; the last statement prints 'ALL TESTS PASSED'.

BEGIN;

CREATE FUNCTION pg_temp.ok(_case text, _got boolean) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF _got IS NOT TRUE THEN RAISE EXCEPTION 'FAILED %', _case; END IF;
END $$;

CREATE FUNCTION pg_temp.as_user(_user uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _user)::text, true);
END $$;

DO $$
DECLARE
  u_a uuid := gen_random_uuid();
  u_b uuid := gen_random_uuid();
  ep  text := 'https://web.push.apple.com/zz-' || gen_random_uuid();
  n int; owner uuid; msg text;
BEGIN
  INSERT INTO auth.users (id, email, instance_id, aud, role)
  SELECT u, 'zz-' || u || '@example.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'
    FROM unnest(ARRAY[u_a, u_b]) u;

  -- 1. A signs in on the phone: the phone is A's.
  PERFORM pg_temp.as_user(u_a);
  PERFORM public.register_push_subscription(ep, 'p-key-a', 'a-key-a', 'iPhone A');
  SELECT count(*), min(user_id::text)::uuid INTO n, owner FROM public.push_subscriptions WHERE endpoint = ep;
  PERFORM pg_temp.ok('1 the phone is registered to A', n = 1 AND owner = u_a);

  -- 2. Registering again is an update, not a second row.
  PERFORM public.register_push_subscription(ep, 'p-key-a2', 'a-key-a2', NULL);
  SELECT count(*) INTO n FROM public.push_subscriptions WHERE endpoint = ep;
  PERFORM pg_temp.ok('2 registering twice leaves one row', n = 1);
  PERFORM pg_temp.ok('2b the keys were refreshed and the user agent kept', EXISTS (
    SELECT 1 FROM public.push_subscriptions WHERE endpoint = ep AND p256dh = 'p-key-a2' AND user_agent = 'iPhone A'));

  -- 3. B signs in on the same phone: A's row goes, B's stays.
  PERFORM pg_temp.as_user(u_b);
  PERFORM public.register_push_subscription(ep, 'p-key-b', 'a-key-b', 'iPhone B');
  SELECT count(*), min(user_id::text)::uuid INTO n, owner FROM public.push_subscriptions WHERE endpoint = ep;
  PERFORM pg_temp.ok('3 the phone now belongs to B only', n = 1 AND owner = u_b);

  -- 4. Nonsense is refused.
  BEGIN PERFORM public.register_push_subscription('http://insecure.example/x', 'p', 'a', NULL); msg := NULL;
  EXCEPTION WHEN others THEN msg := SQLERRM; END;
  PERFORM pg_temp.ok('4a a non-https endpoint is refused', msg = 'Invalid push subscription');
  BEGIN PERFORM public.register_push_subscription(ep, '', 'a', NULL); msg := NULL;
  EXCEPTION WHEN others THEN msg := SQLERRM; END;
  PERFORM pg_temp.ok('4b an empty key is refused', msg = 'Invalid push subscription');

  -- 5. Nobody signed in, nothing stored.
  PERFORM set_config('request.jwt.claims', '', true);
  BEGIN PERFORM public.register_push_subscription(ep, 'p', 'a', NULL); msg := NULL;
  EXCEPTION WHEN others THEN msg := SQLERRM; END;
  PERFORM pg_temp.ok('5 a call without a login is refused', msg = 'Not signed in');

  -- 6. anon cannot call it.
  PERFORM pg_temp.ok('6 anon has no execute', NOT has_function_privilege('anon', 'public.register_push_subscription(text,text,text,text)', 'execute'));

  -- 7. The renewed group bell row buzzes again; a plain read does not.
  PERFORM pg_temp.ok('7 the group trigger fires on a renewed unread chat_group row',
    EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'notification_push_again' AND NOT tgisinternal
              AND pg_get_triggerdef(oid) ILIKE '%AFTER UPDATE OF created_at%'
              AND pg_get_triggerdef(oid) ILIKE '%chat_group%'
              AND pg_get_triggerdef(oid) ILIKE '%read_at IS NULL%'));
END $$;

SELECT 'ALL TESTS PASSED' AS result;
ROLLBACK;
