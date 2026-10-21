-- F-4 regression: ai_rate_limit_hit caps per-user AI usage.
-- Run the WHOLE file in the SQL editor / test harness AFTER
-- 20261021140000_f4_ai_usage_rate_limit.sql. Prints ALL TESTS PASSED or raises.
-- Writes only to a throwaway (user,bucket) row and deletes it at the end.

do $$
declare
  _uid uuid := gen_random_uuid();
  _bucket text := 'test_' || replace(_uid::text, '-', '');
  _v jsonb;
  i int;
begin
  delete from public.ai_usage_limits where user_id = _uid;

  -- Limit 3 in a wide window: first 3 allowed, 4th denied with a positive retry_after.
  for i in 1..3 loop
    _v := public.ai_rate_limit_hit(_uid, _bucket, 3, 3600);
    if (_v->>'allowed')::boolean is distinct from true then
      raise exception 'FAILED: call % within the limit should be allowed, got %', i, _v;
    end if;
  end loop;

  _v := public.ai_rate_limit_hit(_uid, _bucket, 3, 3600);
  if (_v->>'allowed')::boolean is distinct from false then
    raise exception 'FAILED: the 4th call over the limit should be denied, got %', _v;
  end if;
  if coalesce((_v->>'retry_after')::int, 0) < 1 then
    raise exception 'FAILED: a denial must carry a positive retry_after, got %', _v;
  end if;

  delete from public.ai_usage_limits where user_id = _uid;
  raise notice 'ALL TESTS PASSED — ai_rate_limit_hit denies past the limit';
end $$;

-- The limiter is server-side only: neither anon nor authenticated may call it directly
-- (an authenticated user must not be able to reset or inspect their own counter).
do $$
begin
  if has_function_privilege('anon', 'public.ai_rate_limit_hit(uuid, text, integer, integer)', 'execute') then
    raise exception 'FAILED: anon can execute ai_rate_limit_hit';
  end if;
  if has_function_privilege('authenticated', 'public.ai_rate_limit_hit(uuid, text, integer, integer)', 'execute') then
    raise exception 'FAILED: authenticated can execute ai_rate_limit_hit';
  end if;
  raise notice 'ALL TESTS PASSED — ai_rate_limit_hit is service-role only';
end $$;
