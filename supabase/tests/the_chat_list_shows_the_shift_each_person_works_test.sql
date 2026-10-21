-- Tests for 20261021220000_the_chat_list_shows_the_shift_each_person_works.sql (BLOCO 119).
-- Run this WHOLE file in one go in the Supabase SQL Editor after BLOCO 119. One transaction,
-- throwaway people, ROLLBACK at the end; the last statement prints 'ALL TESTS PASSED'.

BEGIN;

CREATE FUNCTION pg_temp.ok(_case text, _got boolean) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF _got IS NOT TRUE THEN RAISE EXCEPTION 'FAILED %', _case; END IF;
END $$;

DO $$
DECLARE
  u_adm uuid := gen_random_uuid();
  u_night uuid := gen_random_uuid();
  u_none uuid := gen_random_uuid();
  j_night text; j_none text;
BEGIN
  INSERT INTO auth.users (id, email, instance_id, aud, role)
  SELECT u, 'zz-' || u || '@example.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'
    FROM unnest(ARRAY[u_adm, u_night, u_none]) u;
  INSERT INTO public.profiles (id, name, email, active) VALUES
    (u_adm, 'ZZ Shift Admin', 'zz-a@example.invalid', true),
    (u_night, 'ZZ Shift Night', 'zz-n@example.invalid', true),
    (u_none, 'ZZ Shift None', 'zz-x@example.invalid', true)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_roles (user_id, role) VALUES (u_adm, 'admin'), (u_night, 'employee'), (u_none, 'employee');
  INSERT INTO public.employees (full_name, position, department, shift_group, active, user_id) VALUES
    ('ZZ Shift Night', 'Employee', 'Lab', 'Night', true, u_night),
    ('ZZ Shift None', 'Employee', 'Lab', NULL, true, u_none);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_adm)::text, true);
  SELECT job INTO j_night FROM public.chat_contactable_people() WHERE user_id = u_night;
  SELECT job INTO j_none  FROM public.chat_contactable_people() WHERE user_id = u_none;

  PERFORM pg_temp.ok('1 the shift they work is shown (got: ' || coalesce(j_night, 'NULL') || ')', j_night = 'Employee · Lab · Night shift');
  PERFORM pg_temp.ok('2 no shift on file: the line is as before (got: ' || coalesce(j_none, 'NULL') || ')', j_none = 'Employee · Lab');
END $$;

SELECT 'ALL TESTS PASSED' AS result;
ROLLBACK;
