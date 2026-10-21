-- F-2 regression: verify_engineer_pin_with_lockout throttles brute force.
-- Run the WHOLE file in the SQL editor / test harness AFTER
-- 20261021130000_f2_engineer_pin_lockout.sql. Prints ALL TESTS PASSED or raises.
--
-- It needs no real engineer PIN: every guess here is wrong on purpose, so it exercises
-- the counter and the lockout without depending on any secret. It impersonates a caller
-- by setting request.jwt.claims (same idiom as the overtime tests), writes only to that
-- caller's own engineer_pin_attempts row, and deletes it at the end.

do $$
declare
  _uid uuid := gen_random_uuid();   -- a throwaway caller id, unique per run
  _v jsonb;
  i int;
begin
  -- Act as this (non-existent is fine) authenticated user.
  perform set_config('request.jwt.claims',
    json_build_object('sub', _uid, 'role', 'authenticated')::text, true);

  -- Clean slate for this id.
  delete from public.engineer_pin_attempts where user_id = _uid;

  -- 5 free wrong attempts: each must say invalid_pin (not locked), remaining counting down.
  for i in 1..5 loop
    _v := public.verify_engineer_pin_with_lockout('000000');
    if (_v->>'success')::boolean then
      raise exception 'FAILED: a wrong PIN was accepted on attempt %', i;
    end if;
    if (_v->>'error') <> 'invalid_pin' then
      raise exception 'FAILED: attempt % expected invalid_pin, got %', i, _v;
    end if;
  end loop;

  -- 6th attempt crosses the free allowance → must lock, with a positive wait.
  _v := public.verify_engineer_pin_with_lockout('000000');
  if (_v->>'error') <> 'locked' then
    raise exception 'FAILED: 6th attempt should lock, got %', _v;
  end if;
  if coalesce((_v->>'locked_seconds')::int, 0) < 1 then
    raise exception 'FAILED: lock must carry a positive locked_seconds, got %', _v;
  end if;

  -- While locked, further attempts keep returning locked (not invalid_pin).
  _v := public.verify_engineer_pin_with_lockout('000000');
  if (_v->>'error') <> 'locked' then
    raise exception 'FAILED: still-locked attempt should say locked, got %', _v;
  end if;

  -- Cleanup.
  delete from public.engineer_pin_attempts where user_id = _uid;
  perform set_config('request.jwt.claims', '', true);

  raise notice 'ALL TESTS PASSED — engineer PIN verification locks out after 5 failures';
end $$;

-- Guard: anon must never be able to call the verifier (consistent with F-1).
do $$
begin
  if has_function_privilege('anon', 'public.verify_engineer_pin_with_lockout(text)', 'execute') then
    raise exception 'FAILED: anon can execute verify_engineer_pin_with_lockout';
  end if;
  raise notice 'ALL TESTS PASSED — anon cannot call the engineer PIN verifier';
end $$;
