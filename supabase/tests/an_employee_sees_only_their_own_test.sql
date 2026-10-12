-- An employee sees their own records, and nobody else's.
--
-- Run this WHOLE file in one go, in the SQL editor, AFTER
-- 20261012160000_an_employee_sees_only_their_own.sql has been applied. It opens a
-- transaction, creates two employees with logins (A and B) and a manager (M), asserts
-- as each of them under the real `authenticated` role — so RLS applies — and ROLLBACKs.
-- The last statement prints 'ALL TESTS PASSED'; any failure raises before it.
--
-- WHAT IS BEING PROTECTED, one block per acceptance criterion:
--   1. A sees A's attendance and none of B's; B sees B's and none of A's.
--   2. Neither can name the other: `my_attendance` takes no employee id at all.
--   3. Neither reads the other's overtime answers or outcomes.
--   4. The reliability numbers (sick and absent counts) reach nobody but the manager.
--   5. A Permissions-screen grant of `workforce.view` to the employee role opens
--      nothing — not `has_action`, not the `employees` table.
--   6. The manager keeps everything the manager had.
--   7. With no session at all, nothing answers.
--
-- It must start as a role that bypasses RLS (the SQL editor's postgres role does).

begin;

do $$
declare
  u_a uuid := gen_random_uuid();
  u_b uuid := gen_random_uuid();
  u_m uuid := gen_random_uuid();
  e_a uuid; e_b uuid;
  req uuid; resp_b uuid;
begin
  insert into auth.users (id, email, instance_id, aud, role) values
    (u_a, 'zz-own-a@example.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
    (u_b, 'zz-own-b@example.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
    (u_m, 'zz-own-m@example.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');

  -- Whatever a sign-up trigger handed out, these three hold exactly one role each.
  delete from public.user_roles where user_id in (u_a, u_b, u_m);
  insert into public.user_roles (user_id, role) values
    (u_a, 'employee'), (u_b, 'employee'), (u_m, 'manager');

  insert into public.employees (full_name, employee_ref, active, user_id)
  values ('ZZ Own A', 'ZZ8001', true, u_a) returning id into e_a;
  insert into public.employees (full_name, employee_ref, active, user_id)
  values ('ZZ Own B', 'ZZ8002', true, u_b) returning id into e_b;

  -- One clocked day each, on different dates with different minutes, so any leak is
  -- visible in the numbers and not only in a count.
  insert into public.attendance_days (employee_id, on_date, worked_minutes, balance_minutes, source)
  values (e_a, date '2030-01-07', 701, 41, 'timemoto'),
         (e_b, date '2030-01-08', 802, 82, 'timemoto');
  insert into public.employee_attendance (employee_id, on_date, status)
  values (e_b, date '2030-01-09', 'sick');

  -- One ask, both answered; only B's has an outcome.
  insert into public.overtime_requests (on_date, starts_at, ends_at, headcount, created_by)
  values (current_date, '06:00', '18:00', 2, u_m) returning id into req;
  insert into public.overtime_responses (request_id, employee_id, answer, decision)
  values (req, e_a, 'yes', 'accepted');
  insert into public.overtime_responses (request_id, employee_id, answer, decision)
  values (req, e_b, 'yes', 'accepted') returning id into resp_b;
  insert into public.overtime_outcomes (response_id, outcome, recorded_by)
  values (resp_b, 'called_sick', u_m);

  -- The grant the ceiling exists to neutralise.
  delete from public.role_permission_overrides where role = 'employee' and action = 'workforce.view';
  insert into public.role_permission_overrides (role, action, allowed)
  values ('employee', 'workforce.view', true);

  perform set_config('zz.u_a', u_a::text, true);
  perform set_config('zz.u_b', u_b::text, true);
  perform set_config('zz.u_m', u_m::text, true);
  perform set_config('zz.e_a', e_a::text, true);
  perform set_config('zz.e_b', e_b::text, true);
end $$;

set local role authenticated;

-- ── As A ────────────────────────────────────────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('zz.u_a'), 'role', 'authenticated')::text, true);

do $$
declare
  j jsonb := public.my_attendance(date '2030-01-01', date '2030-01-31');
  n int;
begin
  if j->'me'->>'id' is distinct from current_setting('zz.e_a') then
    raise exception 'FAILED: A did not get A back (got %)', j->'me'->>'id';
  end if;
  if jsonb_array_length(j->'clocks') <> 1 or (j->'clocks'->0->>'worked_minutes')::int <> 701 then
    raise exception 'FAILED: A should see exactly A''s one clocked day, got %', j->'clocks';
  end if;
  -- Checked on the rows, not on the text: "802" turns up inside a random uuid or a
  -- timestamp often enough to fail a clean run, which is how this test first flaked.
  if exists (select 1 from jsonb_array_elements(j->'clocks') c where c->>'on_date' = '2030-01-08')
     or j::text like '%' || current_setting('zz.e_b') || '%' then
    raise exception 'FAILED: B''s record appears in A''s attendance';
  end if;
  if jsonb_array_length(j->'marks') <> 0 then
    raise exception 'FAILED: B''s sick mark reached A';
  end if;

  select count(*) into n from public.overtime_responses;
  if n <> 1 then raise exception 'FAILED: A reads % overtime answers, should read only their own', n; end if;
  select count(*) into n from public.overtime_responses where employee_id = current_setting('zz.e_b')::uuid;
  if n <> 0 then raise exception 'FAILED: A can read B''s overtime answer'; end if;
  select count(*) into n from public.overtime_outcomes;
  if n <> 0 then raise exception 'FAILED: A can read B''s called-sick outcome'; end if;

  select count(*) into n from public.overtime_reliability();
  if n <> 0 then raise exception 'FAILED: A gets % rows of everybody''s sick and absent counts', n; end if;

  if public.has_action(auth.uid(), 'workforce.view', array['admin']::app_role[]) then
    raise exception 'FAILED: a Permissions grant of workforce.view reached an employee';
  end if;
  select count(*) into n from public.employees;
  if n <> 0 then raise exception 'FAILED: an employee reads % rows of the employees table', n; end if;

  if not public.has_action(auth.uid(), 'attendance.view_own',
       array['employee']::app_role[]) then
    raise exception 'FAILED: the ceiling took attendance.view_own away from the employee';
  end if;
end $$;

-- ── As B ────────────────────────────────────────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('zz.u_b'), 'role', 'authenticated')::text, true);

do $$
declare
  j jsonb := public.my_attendance(date '2030-01-01', date '2030-01-31');
  n int;
begin
  if j->'me'->>'id' is distinct from current_setting('zz.e_b') then
    raise exception 'FAILED: B did not get B back';
  end if;
  if jsonb_array_length(j->'clocks') <> 1 or (j->'clocks'->0->>'worked_minutes')::int <> 802 then
    raise exception 'FAILED: B should see exactly B''s one clocked day, got %', j->'clocks';
  end if;
  if exists (select 1 from jsonb_array_elements(j->'clocks') c where c->>'on_date' = '2030-01-07')
     or j::text like '%' || current_setting('zz.e_a') || '%' then
    raise exception 'FAILED: A''s record appears in B''s attendance';
  end if;
  if jsonb_array_length(j->'marks') <> 1 then
    raise exception 'FAILED: B should see their own sick mark';
  end if;

  select count(*) into n from public.overtime_responses;
  if n <> 1 then raise exception 'FAILED: B reads % overtime answers', n; end if;
  select count(*) into n from public.overtime_outcomes;
  if n <> 1 then raise exception 'FAILED: B should read their own outcome, read %', n; end if;
end $$;

-- ── As the manager ──────────────────────────────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('zz.u_m'), 'role', 'authenticated')::text, true);

do $$
declare n int;
begin
  select count(*) into n from public.overtime_responses
   where employee_id in (current_setting('zz.e_a')::uuid, current_setting('zz.e_b')::uuid);
  if n <> 2 then raise exception 'FAILED: the manager lost overtime answers (sees %)', n; end if;
  select count(*) into n from public.overtime_outcomes o
    join public.overtime_responses r on r.id = o.response_id
   where r.employee_id = current_setting('zz.e_b')::uuid;
  if n <> 1 then raise exception 'FAILED: the manager lost the outcome'; end if;
  select count(*) into n from public.overtime_reliability(current_date)
   where employee_id = current_setting('zz.e_b')::uuid;
  if n <> 1 then raise exception 'FAILED: the manager lost the reliability numbers'; end if;
  -- Not linked to an employee: nobody, said as null rather than as somebody's month.
  if public.my_attendance(date '2030-01-01', date '2030-01-31') is not null then
    raise exception 'FAILED: an unlinked login got somebody''s attendance';
  end if;
end $$;

-- ── Bad ranges are refused, not answered ────────────────────────────────────
do $$
begin
  begin
    perform public.my_attendance(date '2030-02-01', date '2030-01-01');
    raise exception 'FAILED: a backwards range was answered';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.my_attendance(date '2029-01-01', date '2030-12-31');
    raise exception 'FAILED: a two-year range was answered';
  exception when invalid_parameter_value then null;
  end;
end $$;

reset role;

-- ── With no session at all ──────────────────────────────────────────────────
do $$
begin
  if has_function_privilege('anon', 'public.my_attendance(date, date)', 'execute')
     or has_function_privilege('public', 'public.my_attendance(date, date)', 'execute') then
    raise exception 'FAILED: my_attendance can be called without signing in';
  end if;
  if has_function_privilege('public', 'public.overtime_reliability(date)', 'execute') then
    raise exception 'FAILED: overtime_reliability is open to PUBLIC again';
  end if;
  if not has_function_privilege('authenticated', 'public.my_attendance(date, date)', 'execute') then
    raise exception 'FAILED: a signed-in login cannot reach its own attendance';
  end if;
end $$;

select 'ALL TESTS PASSED' as result;

rollback;
