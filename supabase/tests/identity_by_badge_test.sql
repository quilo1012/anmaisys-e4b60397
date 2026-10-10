-- Tests for link_me_by_employee_ref (identity by badge, not by picking a name).
--
-- Run this WHOLE file in one go, in the SQL editor, AFTER
-- 20261010100000_you_say_who_you_are_with_the_number_on_your_badge.sql has been
-- applied. It opens a transaction, makes its own throwaway employees and logins,
-- calls the RPC the way a phone calls it, asserts, and ROLLBACKs: nothing survives.
-- The last statement prints 'ALL TESTS PASSED'; any failure raises and aborts before
-- that line, naming the case.
--
-- WHY THIS FILE EXISTS AND THE VITEST ONES ARE NOT ENOUGH. The repository can run no
-- SQL. `MyOvertimePage.link.test.tsx` proves the screen has no list and sends the
-- badge; it cannot prove Postgres refuses anybody, because nothing in CI has a
-- database. This does.
--
-- It covers the two defects the first draft of the migration had, which is most of
-- the reason it is here: a badge matching two rows must link nobody, and the old
-- `link_me_to_employee` must no longer be reachable by an ordinary login.

begin;

do $$
declare
  v_user_a  uuid := gen_random_uuid();
  v_user_b  uuid := gen_random_uuid();
  v_emp_1   uuid;
  v_emp_2   uuid;
  v_dup_a   uuid;
  v_dup_b   uuid;
  v_got     uuid;
  v_msg     text;
begin
  -- Two logins and one employee carrying a badge nobody has claimed.
  insert into auth.users (id, email, instance_id, aud, role)
  values (v_user_a, 'test-a@example.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
         (v_user_b, 'test-b@example.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');

  insert into public.employees (full_name, employee_ref, active)
  values ('Test Person One', 'ZZ9001', true) returning id into v_emp_1;
  insert into public.employees (full_name, employee_ref, active)
  values ('Test Person Two', 'ZZ9002', true) returning id into v_emp_2;

  -- ── 1. The badge links the right person, and only them ───────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', v_user_a)::text, true);

  perform public.link_me_by_employee_ref('zz9001');   -- lowercase on purpose

  select user_id into v_got from public.employees where id = v_emp_1;
  if v_got is distinct from v_user_a then
    raise exception 'FAILED: the badge did not link its own row (got %)', v_got;
  end if;
  select user_id into v_got from public.employees where id = v_emp_2;
  if v_got is not null then
    raise exception 'FAILED: linking one badge touched another employee';
  end if;

  -- ── 2. A badge already claimed is not available ──────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', v_user_b)::text, true);
  begin
    perform public.link_me_by_employee_ref('ZZ9001');
    raise exception 'FAILED: a second login claimed a badge that was already taken';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like '%not available%' then
      raise exception 'FAILED: wrong refusal for a taken badge: %', v_msg;
    end if;
  end;

  -- The refusal must not say WHY: "already taken" and "no such badge" have to read
  -- the same, or the box becomes a way to find out who has registered.
  begin
    perform public.link_me_by_employee_ref('ZZ0000');  -- exists nowhere
    raise exception 'FAILED: an unknown badge was accepted';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like '%not available%' then
      raise exception 'FAILED: an unknown badge answered differently from a taken one: %', v_msg;
    end if;
  end;

  -- ── 3. An ambiguous badge links NOBODY ───────────────────────────────────
  --
  -- The first draft updated by badge directly, so both of these would have been
  -- linked to the same login and the caller handed the first.
  insert into public.employees (full_name, employee_ref, active)
  values ('Test Dup A', 'ZZ9003', true) returning id into v_dup_a;
  insert into public.employees (full_name, employee_ref, active)
  values ('Test Dup B', ' zz9003 ', true) returning id into v_dup_b;

  begin
    perform public.link_me_by_employee_ref('ZZ9003');
    raise exception 'FAILED: an ambiguous badge was accepted';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like '%more than one%' then
      raise exception 'FAILED: wrong refusal for an ambiguous badge: %', v_msg;
    end if;
  end;

  select count(*) into v_got from public.employees
   where id in (v_dup_a, v_dup_b) and user_id is not null;
  if v_got::int <> 0 then
    raise exception 'FAILED: an ambiguous badge linked % row(s)', v_got;
  end if;

  raise notice 'cases 1-3 passed';
end $$;

-- ── 4. The old doors are shut ──────────────────────────────────────────────
--
-- Not a behaviour test: a grant check. Revoking the list while leaving
-- link_me_to_employee callable would have left the hole open to anyone willing to
-- call the RPC instead of using the screen, and overtime_roster() hands out the ids.
do $$
begin
  if has_function_privilege('authenticated', 'public.link_me_to_employee(uuid)', 'execute') then
    raise exception 'FAILED: link_me_to_employee is still callable by an ordinary login';
  end if;
  if has_function_privilege('authenticated', 'public.overtime_unlinked_names()', 'execute') then
    raise exception 'FAILED: the list of unclaimed employees is still readable';
  end if;
  if not has_function_privilege('authenticated', 'public.link_me_by_employee_ref(text)', 'execute') then
    raise exception 'FAILED: the badge function is not callable by a normal login';
  end if;
  if has_table_privilege('authenticated', 'public.identity_link_attempts', 'select') then
    raise exception 'FAILED: the attempt counter is readable';
  end if;
end $$;

select 'ALL TESTS PASSED' as result;

rollback;
