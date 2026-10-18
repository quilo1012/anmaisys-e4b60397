-- Run this WHOLE file in the SQL editor AFTER
-- 20261018120000_anon_was_granted_on_its_own.sql. It reads catalogue privileges and
-- the policy text only — nothing is written. Prints ALL TESTS PASSED or raises.
--
-- It asks about `anon` by name, not only about PUBLIC: the default privileges in this
-- schema grant anon its own EXECUTE, which a PUBLIC-only check cannot see.

do $$
declare
  fn text;
  leaked text[] := '{}';
  lost text[] := '{}';
begin
  foreach fn in array array[
    'public.overtime_unlinked_names()',
    'public.overtime_roster()',
    'public.overtime_reliability(date)',
    'public.my_employee_id()',
    'public.my_overtime_identity()',
    'public.my_overtime_block()',
    'public.can_manage_overtime(uuid)',
    'public.answer_overtime(uuid, text)',
    'public.link_me_to_employee(uuid)',
    'public.overtime_push_targets(uuid, uuid[])'
  ] loop
    continue when to_regprocedure(fn) is null;
    if has_function_privilege('anon', fn, 'execute') then
      leaked := leaked || fn;
    end if;
  end loop;
  if array_length(leaked, 1) is not null then
    raise exception 'FAILED: anon can still execute %', array_to_string(leaked, ', ');
  end if;

  -- The signed-in side keeps what it uses, or the revoke took too much.
  foreach fn in array array[
    'public.overtime_roster()',
    'public.my_employee_id()',
    'public.my_overtime_identity()',
    'public.my_overtime_block()',
    'public.answer_overtime(uuid, text)'
  ] loop
    continue when to_regprocedure(fn) is null;
    if not has_function_privilege('authenticated', fn, 'execute') then
      lost := lost || fn;
    end if;
  end loop;
  if array_length(lost, 1) is not null then
    raise exception 'FAILED: authenticated lost %', array_to_string(lost, ', ');
  end if;
end $$;

do $$
declare
  chk text;
begin
  select with_check into chk from pg_policies
   where schemaname = 'public' and tablename = 'overtime_responses'
     and policyname = 'overtime_responses_own';
  if chk is null then
    raise exception 'FAILED: overtime_responses_own is missing';
  end if;
  if chk !~ 'decision IS NULL' or chk !~ 'decided_by IS NULL' then
    raise exception 'FAILED: an employee may still write a decision: %', chk;
  end if;
  raise notice 'ALL TESTS PASSED';
end $$;
