-- Nobody without a session may read the roster.
--
-- Run this WHOLE file in the SQL editor AFTER
-- 20261011090000_the_public_was_never_invited.sql has been applied. It reads catalogue
-- privileges only — no transaction needed, nothing written, nothing to roll back.
--
-- WHAT IT IS FOR. Measured against production on 11/10/2026 with the publishable key
-- and no session: `overtime_unlinked_names` answered 200 with 207 rows of names,
-- departments and shifts, and `overtime_reliability` answered with attendance figures
-- per employee. Postgres grants EXECUTE to PUBLIC by default; 20261006180000 granted
-- to `authenticated` without revoking that, and the sweep in 20260627071614 had run
-- four months earlier.
--
-- `has_function_privilege('public', ...)` is the question that matters: anon reaches
-- these through PUBLIC, not through a grant of its own.

do $$
declare
  fn text;
  leaked text[] := '{}';
begin
  foreach fn in array array[
    'public.answer_overtime(uuid, text)',
    'public.link_me_to_employee(uuid)',
    'public.overtime_reliability(date)',
    'public.can_manage_overtime(uuid)',
    'public.my_employee_id()',
    'public.overtime_roster()',
    'public.my_overtime_identity()',
    'public.overtime_unlinked_names()',
    'public.overtime_push_targets(uuid, uuid[])'
  ] loop
    if has_function_privilege('public', fn, 'execute') then
      leaked := leaked || fn;
    end if;
  end loop;

  if array_length(leaked, 1) is not null then
    raise exception 'FAILED: PUBLIC can still execute %', array_to_string(leaked, ', ');
  end if;
end $$;

-- And the signed-in side still works, or the revoke took too much with it.
do $$
begin
  if not has_function_privilege('authenticated', 'public.my_overtime_identity()', 'execute') then
    raise exception 'FAILED: a signed-in login can no longer read its own identity';
  end if;
  if not has_function_privilege('authenticated', 'public.answer_overtime(uuid, text)', 'execute') then
    raise exception 'FAILED: a signed-in login can no longer answer an ask';
  end if;
end $$;

select 'ALL TESTS PASSED' as result;
