-- ================================================================
-- BLOCO 115
-- 20261021180000_an_employee_can_have_more_than_one_supervisor.sql
-- ================================================================
--
-- "Reports to" passa a aceitar mais de um supervisor. `employees.manager_id` continua a
-- existir e passa a ser o PRIMEIRO supervisor (o que ja era para tudo o que le um so);
-- a lista completa vive em `employee_supervisors`. O que muda:
--   * `employee_supervisors` (employee_id, supervisor_id, position): preenchida a partir
--     do manager_id que ja existe (so acrescenta linhas); ninguem escreve nela a direito,
--     so `set_employee_supervisors()` (quem tem `workforce.manage`), que tambem poe o
--     manager_id no primeiro. Maximo 5; nunca a propria pessoa; so pessoas activas.
--   * `my_supervisor()` devolve todos os supervisores com login (antes, um).
--   * `message_my_supervisor(texto, supervisor opcional)`: sem o segundo, escreve ao
--     primeiro, como antes; com ele, a esse (tem de ser um dos seus).
--   * o aviso "X vem fazer overtime" toca a todos os supervisores, uma vez cada.
--   * os grupos do chat contam os reportes de qualquer um dos supervisores.
-- Nao apaga nem reescreve nenhum employee, mensagem ou notificacao.
--
-- "Reports to" now takes more than one supervisor. `employees.manager_id` stays and is the
-- FIRST supervisor (so everything that reads one keeps working); the full list is in
-- `employee_supervisors`, back-filled from manager_id (adds rows only) and written only by
-- `set_employee_supervisors()`. `my_supervisor()` returns all of them; the overtime "is
-- coming in" bell rings each once; chat group scope counts reports of any supervisor.

create table if not exists public.employee_supervisors (
  employee_id   uuid not null references public.employees(id) on delete cascade,
  supervisor_id uuid not null references public.employees(id) on delete cascade,
  position      smallint not null default 0,
  primary key (employee_id, supervisor_id),
  check (employee_id <> supervisor_id)
);
create index if not exists employee_supervisors_supervisor_idx on public.employee_supervisors (supervisor_id);

insert into public.employee_supervisors (employee_id, supervisor_id, position)
select e.id, e.manager_id, 0 from public.employees e
 where e.manager_id is not null and e.manager_id <> e.id
on conflict do nothing;

alter table public.employee_supervisors enable row level security;
revoke all on public.employee_supervisors from public, anon, authenticated;
grant select on public.employee_supervisors to authenticated;
drop policy if exists "employee_supervisors_read" on public.employee_supervisors;
create policy "employee_supervisors_read" on public.employee_supervisors
  for select to authenticated
  using (public.has_action((select auth.uid()), 'workforce.view', array['admin']::app_role[]));

create or replace function public.set_employee_supervisors(p_employee uuid, p_supervisors uuid[])
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_ids uuid[];
begin
  if not public.has_action(auth.uid(), 'workforce.manage', array['admin']::app_role[]) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.employees where id = p_employee) then
    raise exception 'No such employee' using errcode = 'P0001';
  end if;
  -- In the order given, once each, never the person themselves, only active records.
  select coalesce(array_agg(s order by o), '{}') into v_ids
    from (select s, min(o) as o
            from unnest(coalesce(p_supervisors, '{}')) with ordinality as t(s, o)
           where s <> p_employee and exists (select 1 from public.employees x where x.id = s and x.active)
           group by s) q;
  if cardinality(v_ids) > 5 then
    raise exception 'At most 5 supervisors' using errcode = 'P0001';
  end if;

  delete from public.employee_supervisors where employee_id = p_employee and not (supervisor_id = any (v_ids));
  insert into public.employee_supervisors (employee_id, supervisor_id, position)
  select p_employee, v_ids[i], (i - 1)::smallint from generate_subscripts(v_ids, 1) i
  on conflict (employee_id, supervisor_id) do update set position = excluded.position;
  update public.employees set manager_id = v_ids[1] where id = p_employee and manager_id is distinct from v_ids[1];
end;
$$;
revoke all on function public.set_employee_supervisors(uuid, uuid[]) from public, anon;
grant execute on function public.set_employee_supervisors(uuid, uuid[]) to authenticated;

-- Every active supervisor with a login, in order: the table, and manager_id for a row not yet in it.
create or replace function public.supervisor_logins_of(p_employee uuid)
returns table (login uuid, ord integer)
language sql stable security definer set search_path = public
as $$
  select m.user_id, min(x.position)::integer
    from (select supervisor_id, position from public.employee_supervisors where employee_id = p_employee
          union all
          select e.manager_id, 0::smallint from public.employees e
           where e.id = p_employee and e.manager_id is not null
             and not exists (select 1 from public.employee_supervisors s where s.employee_id = e.id)) x
    join public.employees m on m.id = x.supervisor_id
    join public.employees me on me.id = p_employee
   where m.active and m.user_id is not null and m.user_id is distinct from me.user_id
   group by m.user_id
   order by min(x.position), m.user_id;
$$;
revoke all on function public.supervisor_logins_of(uuid) from public, anon, authenticated;

create or replace function public.my_supervisor()
returns table (user_id uuid, full_name text)
language sql stable security definer set search_path = public
as $$
  select m.user_id, m.full_name
    from public.supervisor_logins_of(public.my_employee_id()) l
    join public.employees m on m.user_id = l.login and m.active
   where m.user_id is distinct from auth.uid()
   order by l.ord, m.full_name;
$$;
revoke all on function public.my_supervisor() from public, anon;
grant execute on function public.my_supervisor() to authenticated;

drop function if exists public.message_my_supervisor(text);
create or replace function public.message_my_supervisor(p_message text, p_supervisor uuid default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_emp  uuid := public.my_employee_id();
  v_name text;
  v_text text := btrim(coalesce(p_message, ''));
  v_to   uuid;
begin
  if v_emp is null then
    raise exception 'No employee record is linked to this login' using errcode = 'P0001';
  end if;
  if length(v_text) = 0 then
    raise exception 'Write a message first' using errcode = 'P0001';
  end if;
  if length(v_text) > 1000 then
    raise exception 'Keep it under 1000 characters' using errcode = 'P0001';
  end if;
  if p_supervisor is null then
    v_to := public.supervisor_login_of(v_emp);
  elsif exists (select 1 from public.supervisor_logins_of(v_emp) l where l.login = p_supervisor) then
    v_to := p_supervisor;
  else
    raise exception 'That is not one of your supervisors' using errcode = 'P0001';
  end if;
  if v_to is null or v_to = auth.uid() then
    raise exception 'No supervisor is on file for you yet. Ask the office to set your manager.' using errcode = 'P0001';
  end if;
  select full_name into v_name from public.employees where id = v_emp;
  return public.dm_from_employee(v_to, v_name, v_text);
end;
$$;
revoke all on function public.message_my_supervisor(text, uuid) from public, anon;
grant execute on function public.message_my_supervisor(text, uuid) to authenticated;

create or replace function public.overtime_response_booked_notify()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_req  public.overtime_requests;
  v_user uuid;
  v_name text;
  v_when text;
  v_to   uuid;
begin
  if new.decision is null or new.decision not in ('accepted', 'reserve') then return null; end if;
  if tg_op = 'UPDATE' and old.decision is not distinct from new.decision then return null; end if;

  begin
    select * into v_req from public.overtime_requests where id = new.request_id;
    select user_id, full_name into v_user, v_name from public.employees where id = new.employee_id;
    v_when := to_char(v_req.on_date, 'Dy DD/MM') || ' · ' || left(v_req.starts_at::text, 5)
              || '–' || left(v_req.ends_at::text, 5) || coalesce(' · ' || v_req.department, '');

    if v_user is not null then
      insert into public.notifications (user_id, kind, title, body, priority, action_url)
      values (v_user, 'overtime_booked',
              case when new.decision = 'accepted' then 'You''re booked for overtime'
                   else 'You''re on the overtime reserve list' end,
              v_when, 'medium', '/dashboard/my-overtime?ask=' || v_req.id);
    end if;

    -- The supervisor on file and the poster, unless they did it themselves, or nobody
    -- did (the one-off backlog of BLOCO 105). Once per person per ask: only when the
    -- answer is first decided, so a reserve later accepted, or a retried yes, does not
    -- ring again — and `distinct`, so one login holding both roles is rung once.
    -- (Not BLOCO 100's unique key: that is one row per ask, and an ask has many people.)
    if auth.uid() is not null and (tg_op = 'INSERT' or old.decision is null) then
      for v_to in
        select distinct t from unnest(array_append(array(select l.login from public.supervisor_logins_of(new.employee_id) l), v_req.created_by)) t
         where t is not null and t <> auth.uid() and t is distinct from v_user
      loop
        insert into public.notifications (user_id, kind, title, body, priority, action_url)
        values (v_to, 'overtime_yes',
                coalesce(v_name, 'Somebody') ||
                  case when new.decision = 'accepted' then ' is coming in' else ' said yes (on reserve)' end,
                v_when, 'medium', '/dashboard/overtime');
      end loop;
    end if;
  exception when others then
    -- The booking is the record; the bell is a courtesy. Never undo it for the bell.
    raise warning 'overtime_response_booked_notify(%): %', new.id, sqlerrm;
  end;
  return null;
end;
$$;
revoke all on function public.overtime_response_booked_notify() from public, anon, authenticated;

create or replace function public.chat_departments_of(p_uid uuid)
returns setof text
language sql stable security definer set search_path = public
as $$
  select distinct d from (
    select e.department as d
      from public.employees e
     where e.user_id = p_uid and e.active
    union
    select r.department
      from public.employees me
      join public.employees r on r.active
       and (r.manager_id = me.id
            or exists (select 1 from public.employee_supervisors s where s.employee_id = r.id and s.supervisor_id = me.id))
     where me.user_id = p_uid and me.active
  ) x
  where d is not null and btrim(d) <> '';
$$;
revoke all on function public.chat_departments_of(uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';
