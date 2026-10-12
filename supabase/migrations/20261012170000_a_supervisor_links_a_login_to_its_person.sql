-- A supervisor links a login to the person it belongs to.
--
-- "Which badge is yours?" ends with "your supervisor can link your account — they have
-- the list". There was no list. Nobody had a screen to set `employees.user_id`, so a
-- person who did not know their badge number, whose record has none (51 of them), or
-- whose email is not on their record had no way in at all.
--
-- Who may: `employees.link_login`, admin and manager — the people who already manage
-- accounts (`users.manage`). The office admin's role excludes Users by definition, and
-- the employee's ceiling (`has_action`, 20261012160000) excludes it by construction.
--
-- What it will not do, each for a reason already written down elsewhere:
--   - link a shared line tablet account (a place, not a person — 20261009090000);
--   - link a login that is already somebody, or a record already claimed — a second
--     link is a correction, and a correction is unlink then link, both audited;
--   - choose between two records: it takes ids, picked by a human, never a name.
--
-- The suggestion in `login_link_candidates()` is only that. It names a record when
-- exactly one active, unclaimed record carries the login's email, or failing that the
-- login's name; a person still presses Link.
--
-- Every link and unlink is written to `audit_logs`.
--
-- Idempotent. Paste after BLOCO 90, whose employee ceiling it relies on.

-- The list: logins that are nobody yet, records nobody has claimed, and who is linked.
create or replace function public.login_link_candidates()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
begin
  if auth.uid() is null
     or not public.has_action(auth.uid(), 'employees.link_login', array['admin','manager']::app_role[]) then
    raise exception 'Not allowed to link accounts' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'logins', coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id', u.id,
               'email', u.email,
               'name', p.name,
               'roles', (select coalesce(jsonb_agg(ur.role order by ur.role), '[]'::jsonb)
                           from public.user_roles ur where ur.user_id = u.id),
               'created_at', u.created_at,
               'suggested_employee_id', (
                 select coalesce(
                   (select min(e.id::text)::uuid from public.employees e
                     where e.active and e.user_id is null
                       and lower(trim(e.email)) = lower(trim(u.email))
                    having count(*) = 1),
                   (select min(e.id::text)::uuid from public.employees e
                     where e.active and e.user_id is null and p.name is not null
                       and lower(trim(e.full_name)) = lower(trim(p.name))
                    having count(*) = 1)))
             ) order by u.created_at desc)
        from auth.users u
        left join public.profiles p on p.id = u.id
       where not exists (select 1 from public.employees e where e.user_id = u.id)
         and not exists (select 1 from public.operator_line_accounts o where o.user_id = u.id)
         and coalesce(p.active, true)), '[]'::jsonb),
    'employees', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id, 'full_name', e.full_name, 'employee_ref', e.employee_ref,
               'department', e.department, 'shift_group', e.shift_group) order by e.full_name)
        from public.employees e
       where e.active and e.user_id is null), '[]'::jsonb),
    'linked', coalesce((
      select jsonb_agg(jsonb_build_object(
               'employee_id', e.id, 'full_name', e.full_name, 'employee_ref', e.employee_ref,
               'department', e.department, 'user_id', e.user_id, 'email', u.email) order by e.full_name)
        from public.employees e
        join auth.users u on u.id = e.user_id), '[]'::jsonb)
  );
end;
$$;

create or replace function public.link_login_to_employee(p_user_id uuid, p_employee_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_row     public.employees;
  v_already text;
  v_name    text;
begin
  if auth.uid() is null
     or not public.has_action(auth.uid(), 'employees.link_login', array['admin','manager']::app_role[]) then
    raise exception 'Not allowed to link accounts' using errcode = '42501';
  end if;
  if p_user_id is null or p_employee_id is null then
    raise exception 'Pick both the login and the person' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'That login no longer exists' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.operator_line_accounts o where o.user_id = p_user_id) then
    raise exception 'That is a shared line tablet, not a person. It cannot be linked to anybody.'
      using errcode = 'P0001';
  end if;

  -- Two supervisors linking the same login at once must not give it two people.
  perform pg_advisory_xact_lock(hashtext('link_login:' || p_user_id::text));

  select full_name into v_already from public.employees where user_id = p_user_id limit 1;
  if v_already is not null then
    raise exception 'That login is already linked to %. Unlink it first.', v_already
      using errcode = 'P0001';
  end if;

  update public.employees
     set user_id = p_user_id
   where id = p_employee_id and active and user_id is null
  returning * into v_row;
  if v_row.id is null then
    raise exception 'That person is already linked to a login, or is no longer active.'
      using errcode = 'P0001';
  end if;

  -- Wrong badge guesses no longer matter once the person is linked. The table comes
  -- with BLOCO 81, which may not have been pasted yet.
  if to_regclass('public.identity_link_attempts') is not null then
    execute 'delete from public.identity_link_attempts where user_id = $1' using p_user_id;
  end if;

  select coalesce(p.name, 'Unknown') into v_name from public.profiles p where p.id = auth.uid();
  insert into public.audit_logs (user_id, user_name, action, entity_type, entity_id, details)
  values (auth.uid(), coalesce(v_name, 'Unknown'), 'employee.login_linked', 'employee', v_row.id::text,
          jsonb_build_object('employee', v_row.full_name, 'employee_ref', v_row.employee_ref,
                             'login', (select email from auth.users where id = p_user_id),
                             'user_id', p_user_id));
end;
$$;

create or replace function public.unlink_login_from_employee(p_employee_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_row  public.employees;
  v_was  uuid;
  v_name text;
begin
  if auth.uid() is null
     or not public.has_action(auth.uid(), 'employees.link_login', array['admin','manager']::app_role[]) then
    raise exception 'Not allowed to link accounts' using errcode = '42501';
  end if;

  select user_id into v_was from public.employees where id = p_employee_id for update;
  if v_was is null then
    raise exception 'That person is not linked to a login' using errcode = 'P0001';
  end if;

  update public.employees set user_id = null where id = p_employee_id returning * into v_row;

  select coalesce(p.name, 'Unknown') into v_name from public.profiles p where p.id = auth.uid();
  insert into public.audit_logs (user_id, user_name, action, entity_type, entity_id, details)
  values (auth.uid(), coalesce(v_name, 'Unknown'), 'employee.login_unlinked', 'employee', v_row.id::text,
          jsonb_build_object('employee', v_row.full_name, 'employee_ref', v_row.employee_ref,
                             'login', (select email from auth.users where id = v_was),
                             'user_id', v_was));
end;
$$;

revoke all on function public.login_link_candidates() from public;
revoke all on function public.link_login_to_employee(uuid, uuid) from public;
revoke all on function public.unlink_login_from_employee(uuid) from public;
grant execute on function public.login_link_candidates() to authenticated;
grant execute on function public.link_login_to_employee(uuid, uuid) to authenticated;
grant execute on function public.unlink_login_from_employee(uuid) to authenticated;
