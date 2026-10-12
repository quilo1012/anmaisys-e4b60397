-- A supervisor links a login to the person it belongs to — and only a supervisor.
--
-- Run this WHOLE file in the SQL editor AFTER
-- 20261012170000_a_supervisor_links_a_login_to_its_person.sql has been applied. It
-- opens a transaction, builds its own people, asserts under the real `authenticated`
-- role, and ROLLBACKs. The last statement prints 'ALL TESTS PASSED'.
--
-- It must start as a role that bypasses RLS (the SQL editor's postgres role does).

begin;

do $$
declare
  u_m uuid := gen_random_uuid();   -- manager
  u_x uuid := gen_random_uuid();   -- an employee login, trying to link itself to anyone
  u_e uuid := gen_random_uuid();   -- the login to be linked
  u_f uuid := gen_random_uuid();   -- a second login
  u_t uuid := gen_random_uuid();   -- a shared line tablet
  r1 uuid; r2 uuid;
begin
  insert into auth.users (id, email, instance_id, aud, role) values
    (u_m, 'zz-link-m@example.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
    (u_x, 'zz-link-x@example.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
    (u_e, 'zz-link-e@example.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
    (u_f, 'zz-link-f@example.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
    (u_t, 'zz-link-t@example.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
  delete from public.user_roles where user_id in (u_m, u_x, u_e, u_f, u_t);
  insert into public.user_roles (user_id, role) values
    (u_m, 'manager'), (u_x, 'employee'), (u_e, 'employee'), (u_f, 'employee'), (u_t, 'operator');
  insert into public.operator_line_accounts (user_id, email, label, line_ids)
  values (u_t, 'zz-link-t@example.invalid', 'ZZ Line', '{}');

  -- R1 carries u_e's email, so it is the suggestion for u_e.
  insert into public.employees (full_name, employee_ref, email, active)
  values ('ZZ Link One', 'ZZ7001', 'ZZ-Link-E@example.invalid', true) returning id into r1;
  insert into public.employees (full_name, employee_ref, active)
  values ('ZZ Link Two', 'ZZ7002', true) returning id into r2;

  -- A Permissions-screen grant to the employee role, which the ceiling must ignore.
  delete from public.role_permission_overrides where role = 'employee' and action = 'employees.link_login';
  insert into public.role_permission_overrides (role, action, allowed) values ('employee', 'employees.link_login', true);

  perform set_config('zz.m', u_m::text, true);
  perform set_config('zz.x', u_x::text, true);
  perform set_config('zz.e', u_e::text, true);
  perform set_config('zz.f', u_f::text, true);
  perform set_config('zz.t', u_t::text, true);
  perform set_config('zz.r1', r1::text, true);
  perform set_config('zz.r2', r2::text, true);
end $$;

set local role authenticated;

-- ── An employee can neither list nor link, whatever the Permissions screen says ──
select set_config('request.jwt.claims', json_build_object('sub', current_setting('zz.x'))::text, true);
do $$
begin
  begin
    perform public.login_link_candidates();
    raise exception 'FAILED: an employee listed every login';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.link_login_to_employee(current_setting('zz.x')::uuid, current_setting('zz.r1')::uuid);
    raise exception 'FAILED: an employee linked themselves to a record of their choosing';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ── The manager ────────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', current_setting('zz.m'))::text, true);
do $$
declare
  j jsonb := public.login_link_candidates();
  login jsonb;
begin
  select l into login from jsonb_array_elements(j->'logins') l where l->>'user_id' = current_setting('zz.e');
  if login is null then raise exception 'FAILED: an unlinked login is missing from the list'; end if;
  if login->>'suggested_employee_id' is distinct from current_setting('zz.r1') then
    raise exception 'FAILED: the record carrying the login''s email was not suggested (got %)', login->>'suggested_employee_id';
  end if;
  if exists (select 1 from jsonb_array_elements(j->'logins') l where l->>'user_id' = current_setting('zz.t')) then
    raise exception 'FAILED: a shared line tablet is offered as a person';
  end if;

  perform public.link_login_to_employee(current_setting('zz.e')::uuid, current_setting('zz.r1')::uuid);

  -- The same login cannot become a second person.
  begin
    perform public.link_login_to_employee(current_setting('zz.e')::uuid, current_setting('zz.r2')::uuid);
    raise exception 'FAILED: one login was linked to two people';
  exception when sqlstate 'P0001' then null;
  end;
  -- A record already claimed cannot be taken by another login.
  begin
    perform public.link_login_to_employee(current_setting('zz.f')::uuid, current_setting('zz.r1')::uuid);
    raise exception 'FAILED: a claimed record was handed to a second login';
  exception when sqlstate 'P0001' then null;
  end;
  -- A tablet is a place.
  begin
    perform public.link_login_to_employee(current_setting('zz.t')::uuid, current_setting('zz.r2')::uuid);
    raise exception 'FAILED: a shared line tablet was linked to a person';
  exception when sqlstate 'P0001' then null;
  end;
end $$;

-- ── The linked person is now themselves, and it was written down ───────────────
reset role;
do $$
begin
  if (select user_id from public.employees where id = current_setting('zz.r1')::uuid) is distinct from current_setting('zz.e')::uuid then
    raise exception 'FAILED: the link was not stored';
  end if;
  if not exists (select 1 from public.audit_logs where action = 'employee.login_linked'
                  and entity_id = current_setting('zz.r1') and user_id = current_setting('zz.m')::uuid) then
    raise exception 'FAILED: the link was not audited';
  end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('zz.e'))::text, true);
do $$
begin
  if public.my_employee_id() is distinct from current_setting('zz.r1')::uuid then
    raise exception 'FAILED: the linked login does not resolve to its person';
  end if;
end $$;

-- ── A correction is unlink, then link — both audited ───────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', current_setting('zz.m'))::text, true);
do $$
begin
  perform public.unlink_login_from_employee(current_setting('zz.r1')::uuid);
  perform public.link_login_to_employee(current_setting('zz.e')::uuid, current_setting('zz.r2')::uuid);
end $$;
reset role;
do $$
begin
  if (select user_id from public.employees where id = current_setting('zz.r1')::uuid) is not null then
    raise exception 'FAILED: unlinking left the old record linked';
  end if;
  if not exists (select 1 from public.audit_logs where action = 'employee.login_unlinked'
                  and entity_id = current_setting('zz.r1')) then
    raise exception 'FAILED: the unlink was not audited';
  end if;
  if has_function_privilege('anon', 'public.login_link_candidates()', 'execute')
     or has_function_privilege('public', 'public.link_login_to_employee(uuid, uuid)', 'execute') then
    raise exception 'FAILED: linking is reachable without signing in';
  end if;
end $$;

select 'ALL TESTS PASSED' as result;

rollback;
