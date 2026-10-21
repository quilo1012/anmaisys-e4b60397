-- ================================================================
-- BLOCO 116
-- 20261021190000_an_ask_can_skip_a_crew.sql
-- ================================================================
--
-- Ao divulgar um overtime, o escritorio pode escolher NAO enviar a uma ou mais equipas
-- (por exemplo "todos menos a equipa Night"). Ate aqui so dava para escolher uma equipa ou todas.
--   * `overtime_requests.excluded_shift_groups` (text[], por omissao vazio): so acrescenta
--     uma coluna; os pedidos que ja existem ficam como estao (ninguem excluido).
--   * `overtime_notify_targets`: quem e avisado no sino deixa de incluir essas equipas.
--   * uma guarda em `overtime_responses`: um "sim" ou "nao" da PROPRIA pessoa dessas equipas
--     e recusado (quem acrescenta um sim dado ao balcao continua a poder).
-- No telemovel o pedido deixa de aparecer a essas equipas (o ecra ja usa a mesma regra
-- que a base). Nao apaga nem muda nenhuma resposta ou pedido.
--
-- When publishing an overtime ask the office can now choose NOT to send it to one or more
-- crews ("everybody except the Night crew"). One new column (default empty, so every existing
-- ask is unchanged); the bell skips those crews; a guard on `overtime_responses` refuses a person's own answer from them (a supervisor adding a desk yes is unaffected).
-- Nothing is deleted or changed.

alter table public.overtime_requests
  add column if not exists excluded_shift_groups text[] not null default '{}';

create or replace function public.overtime_notify_targets(p_request_id uuid)
returns table (employee_id uuid, user_id uuid)
-- plpgsql, not sql: a sql body is checked when it is created, and this one names
-- BLOCO 95's function. Out of order, the paste must not stop here.
language plpgsql stable security definer set search_path = public
as $$
begin
  return query
  select e.id, e.user_id
    from public.overtime_requests q
    join public.employees e
      on e.active
     and e.user_id is not null
     and (q.department  is null or q.department  is not distinct from e.department)
     and (q.shift_group is null or q.shift_group is not distinct from e.shift_group)
     and (e.shift_group is null or not (e.shift_group = any (coalesce(q.excluded_shift_groups, '{}'))))
   where q.id = p_request_id
     and q.status = 'open'
     and (q.on_date + q.starts_at) > (now() at time zone 'Europe/London')
     and not exists (select 1 from public.overtime_responses r
                      where r.request_id = q.id and r.employee_id = e.id)
     and not exists (select 1 from public.overtime_block_for(e.id))
     and public.overtime_schedule_clash(e.id, q.id) is null;
end;
$$;

revoke all on function public.overtime_notify_targets(uuid) from public, anon, authenticated;

-- A trigger and not a new answer_overtime: that function is defined in older blocks that
-- must stay the last word on it, and a trigger also covers any other way a person answers
-- for themselves. It only looks at a person's OWN answer, so the supervisor who adds a yes
-- given at the desk can still put somebody from a skipped crew on an ask, as before.
create or replace function public.overtime_response_crew_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_skip  text[];
  v_shift text;
begin
  if new.employee_id is distinct from public.my_employee_id() then return new; end if;
  select coalesce(q.excluded_shift_groups, '{}') into v_skip
    from public.overtime_requests q where q.id = new.request_id;
  select e.shift_group into v_shift from public.employees e where e.id = new.employee_id;
  if v_shift is not null and v_shift = any (coalesce(v_skip, '{}')) then
    raise exception 'This overtime is not being asked of the % crew', v_shift using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.overtime_response_crew_guard() from public, anon, authenticated;

drop trigger if exists overtime_response_crew_guard_t on public.overtime_responses;
create trigger overtime_response_crew_guard_t
  before insert or update of answer on public.overtime_responses
  for each row execute function public.overtime_response_crew_guard();

notify pgrst, 'reload schema';
