-- Overtime keeps its own record of what happened, and nobody can rewrite it.
--
-- The three overtime tables hold the CURRENT state. A changed answer is an UPDATE, a
-- corrected outcome is an upsert, a cancelled ask keeps only its last status, and a
-- deleted ask takes its answers with it (`on delete cascade`). So "who said yes first",
-- "who moved me to reserve" and "what were the hours before they were changed" are
-- gone the moment they stop being true. That is the argument the floor keeps having.
--
-- WHY NOT `audit_logs`. It exists and was looked at first. It is the whole app's log:
-- admin and manager read every row of it, any signed-in user can write any text into
-- it through `log_audit_event`, and it has no employee column. Giving an employee
-- their own rows there means a policy over somebody else's general log, and its
-- content is only as true as whatever the screen chose to send. This table is
-- narrower on purpose: overtime and the employee things that touch it, written only
-- by triggers on the tables themselves, so a screen cannot forget to log and cannot
-- log something that did not happen.
--
-- WHAT IS RECORDED, one row per event:
--   asks       created, edited (date, hours, headcount, audience, note), closed,
--              reopened, cancelled, deleted
--   answers    yes / no, and a changed mind
--   decisions  assigned, put on reserve, declined, removed, reserve promoted, cleared
--   outcomes   attended, no-show, called sick, cancelled (in time / late)
--   the board  a sick / holiday / unpaid day on a date the person has accepted overtime
--   rules      the no-show block and late-cancellation rule
--   access     a Permissions Matrix override on any `overtime.*` action
--
-- PRIVACY. Never a password, token or invite code: nothing here reads them. The note
-- on a `called_sick` outcome is NOT copied — the row says a note exists, not what it
-- says; the original stays where it is, behind its own policy. A board sick day is
-- recorded as the word "sick" and nothing more, which is all the board holds.
--
-- WHO READS IT. Somebody who runs overtime (`can_manage_overtime`, which is
-- `has_action('overtime.manage')`, so the Permissions Matrix decides) reads all of it.
-- Everybody else reads only the rows about themselves (`my_employee_id()`), and never
-- the rules or access rows, which are about nobody in particular.
--
-- APPEND-ONLY. No role gets insert, update or delete; the trigger functions write as
-- the owner. A guard trigger refuses UPDATE, DELETE and TRUNCATE for everyone else.
--
-- Depends on nothing from blocks 78–89 (in particular not on
-- `overtime_responses.answered_for_*`, which production does not have yet).
-- Idempotent: the history is backfilled once, only while the table is empty.

create table if not exists public.overtime_audit (
  id             bigint generated always as identity primary key,
  occurred_at    timestamptz not null default now(),
  event_type     text not null check (event_type in (
                   'opportunity_created', 'opportunity_edited', 'opportunity_closed',
                   'opportunity_reopened', 'opportunity_cancelled', 'opportunity_deleted',
                   'answered_yes', 'answered_no',
                   'assigned', 'placed_on_reserve', 'declined_by_supervisor',
                   'removed_from_overtime', 'reserve_promoted', 'decision_cleared',
                   'reassigned', 'response_deleted',
                   'attended', 'no_show', 'called_sick', 'employee_cancelled', 'outcome_removed',
                   'absence_affects_overtime',
                   'rules_changed', 'permission_override_changed')),
  -- Plain ids, no foreign keys: the record has to outlive the row it is about.
  request_id     uuid,
  response_id    uuid,
  employee_id    uuid,
  employee_name  text,
  actor_id       uuid,
  actor_name     text,
  actor_role     text,
  actor_kind     text not null check (actor_kind in ('employee', 'supervisor', 'administrator', 'system', 'other')),
  source         text not null check (source in ('employee_app', 'supervisor_interface', 'system', 'backfill', 'other')),
  on_date        date,
  shift          text,
  starts_at      time,
  ends_at        time,
  old_value      jsonb,
  new_value      jsonb,
  note           text
);

create index if not exists overtime_audit_occurred_idx on public.overtime_audit (occurred_at desc);
create index if not exists overtime_audit_employee_idx on public.overtime_audit (employee_id, occurred_at desc);
create index if not exists overtime_audit_request_idx  on public.overtime_audit (request_id, occurred_at desc);

comment on table public.overtime_audit is
  'Append-only history of overtime and the employee events that affect it. Written only '
  'by triggers. See 20261018110000.';

-- ---------------------------------------------------------------------------
-- 1. Who did it, from the session — never from anything the caller sends
-- ---------------------------------------------------------------------------
create or replace function public.overtime_audit_actor(p_uid uuid, p_employee_id uuid)
returns table (actor_name text, actor_role text, actor_kind text, source text)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_role    text;
  v_self    boolean;
  v_manages boolean;
begin
  if p_uid is null then
    -- No session: a cron job, the service role, or SQL pasted in the editor.
    return query select null::text, null::text, 'system'::text, 'system'::text;
    return;
  end if;

  -- The highest role the login holds, so an admin who is also an employee reads as admin.
  select ur.role::text into v_role
    from public.user_roles ur
   where ur.user_id = p_uid
   order by case ur.role::text
              when 'admin' then 0
              when 'production_office_admin' then 1
              when 'manager' then 2
              when 'supervisor' then 3
              else 9 end
   limit 1;

  v_self := p_employee_id is not null and exists (
    select 1 from public.employees e where e.id = p_employee_id and e.user_id = p_uid);
  v_manages := public.can_manage_overtime(p_uid);

  return query select
    (select p.name from public.profiles p where p.id = p_uid),
    v_role,
    case
      when v_role = 'admin' then 'administrator'
      when v_role in ('production_office_admin', 'manager', 'supervisor') or v_manages then 'supervisor'
      when v_role = 'employee' or v_self then 'employee'
      else 'other'
    end,
    case
      when v_self then 'employee_app'
      when v_manages then 'supervisor_interface'
      else 'other'
    end;
end;
$$;

revoke all on function public.overtime_audit_actor(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The one writer
-- ---------------------------------------------------------------------------
create or replace function public.overtime_audit_write(
  p_event       text,
  p_request_id  uuid,
  p_response_id uuid,
  p_employee_id uuid,
  p_old         jsonb,
  p_new         jsonb,
  p_note        text,
  p_actor       uuid default auth.uid(),
  p_at          timestamptz default now(),
  p_source      text default null
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_req   public.overtime_requests;
  v_actor record;
begin
  select * into v_req from public.overtime_requests where id = p_request_id;
  select * into v_actor from public.overtime_audit_actor(p_actor, p_employee_id);

  insert into public.overtime_audit (
    occurred_at, event_type, request_id, response_id, employee_id, employee_name,
    actor_id, actor_name, actor_role, actor_kind, source,
    on_date, shift, starts_at, ends_at, old_value, new_value, note)
  values (
    p_at, p_event, p_request_id, p_response_id, p_employee_id,
    (select e.full_name from public.employees e where e.id = p_employee_id),
    p_actor, v_actor.actor_name, v_actor.actor_role, v_actor.actor_kind,
    coalesce(p_source, v_actor.source),
    -- A deleted ask is no longer in its table; its date and hours ride in the value.
    coalesce(v_req.on_date, (p_old ->> 'on_date')::date),
    coalesce(public.overtime_board_shift(v_req.on_date, v_req.starts_at), p_old ->> 'shift'),
    coalesce(v_req.starts_at, (p_old ->> 'starts_at')::time),
    coalesce(v_req.ends_at, (p_old ->> 'ends_at')::time),
    nullif(p_old, '{}'::jsonb), nullif(p_new, '{}'::jsonb), p_note);
end;
$$;

revoke all on function public.overtime_audit_write(text, uuid, uuid, uuid, jsonb, jsonb, text, uuid, timestamptz, text)
  from public, anon, authenticated;

-- Only the keys that changed, old and new side by side.
create or replace function public.overtime_audit_diff(p_old jsonb, p_new jsonb, p_keys text[])
returns table (old_value jsonb, new_value jsonb)
language sql immutable set search_path = public
as $$
  select coalesce(jsonb_object_agg(k, p_old -> k), '{}'::jsonb),
         coalesce(jsonb_object_agg(k, p_new -> k), '{}'::jsonb)
    from unnest(p_keys) k
   where (p_old -> k) is distinct from (p_new -> k);
$$;

-- ---------------------------------------------------------------------------
-- 3. The ask
-- ---------------------------------------------------------------------------
create or replace function public.overtime_audit_requests()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_fields constant text[] := array['on_date', 'starts_at', 'ends_at', 'headcount', 'department', 'shift_group', 'note'];
  v_old    jsonb;
  v_new    jsonb;
  d        record;
begin
  if tg_op = 'INSERT' then
    perform public.overtime_audit_write('opportunity_created', new.id, null, null, null,
      jsonb_build_object('on_date', new.on_date, 'starts_at', new.starts_at, 'ends_at', new.ends_at,
        'headcount', new.headcount, 'department', new.department, 'shift_group', new.shift_group,
        'status', new.status),
      new.note);
    return new;
  end if;

  if tg_op = 'DELETE' then
    -- The ask is already gone from the table, so the date and hours go in the value.
    perform public.overtime_audit_write('opportunity_deleted', old.id, null, null,
      jsonb_build_object('on_date', old.on_date, 'starts_at', old.starts_at, 'ends_at', old.ends_at,
        'shift', public.overtime_board_shift(old.on_date, old.starts_at),
        'headcount', old.headcount, 'status', old.status),
      null, null);
    return old;
  end if;

  v_old := to_jsonb(old); v_new := to_jsonb(new);
  v_old := v_old || jsonb_build_object('shift', public.overtime_board_shift(old.on_date, old.starts_at));
  v_new := v_new || jsonb_build_object('shift', public.overtime_board_shift(new.on_date, new.starts_at));

  select * into d from public.overtime_audit_diff(v_old, v_new, v_fields || array['shift']);
  if d.new_value <> '{}'::jsonb then
    perform public.overtime_audit_write('opportunity_edited', new.id, null, null, d.old_value, d.new_value, null);
  end if;

  if new.status is distinct from old.status then
    perform public.overtime_audit_write(
      case new.status when 'cancelled' then 'opportunity_cancelled'
                      when 'closed'    then 'opportunity_closed'
                      else 'opportunity_reopened' end,
      new.id, null, null,
      jsonb_build_object('status', old.status), jsonb_build_object('status', new.status), null);
  end if;
  return new;
end;
$$;

drop trigger if exists overtime_audit_requests_t on public.overtime_requests;
create trigger overtime_audit_requests_t
  after insert or update or delete on public.overtime_requests
  for each row execute function public.overtime_audit_requests();

-- ---------------------------------------------------------------------------
-- 4. The answer and the decision
-- ---------------------------------------------------------------------------
create or replace function public.overtime_audit_decision_event(p_old text, p_new text)
returns text
language sql immutable set search_path = public
as $$
  select case
    when p_new = 'accepted' and p_old = 'reserve'  then 'reserve_promoted'
    when p_new = 'accepted'                         then 'assigned'
    when p_new = 'reserve'                          then 'placed_on_reserve'
    when p_old = 'accepted'                         then 'removed_from_overtime'
    when p_new = 'declined'                         then 'declined_by_supervisor'
    else 'decision_cleared'
  end;
$$;

create or replace function public.overtime_audit_responses()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.overtime_audit_write(
      case new.answer when 'yes' then 'answered_yes' else 'answered_no' end,
      new.request_id, new.id, new.employee_id, null, jsonb_build_object('answer', new.answer), null);
    if new.decision is not null then
      perform public.overtime_audit_write(public.overtime_audit_decision_event(null, new.decision),
        new.request_id, new.id, new.employee_id, null, jsonb_build_object('decision', new.decision), null);
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    -- A cascade from a deleted ask lands here too; that ask is logged separately.
    perform public.overtime_audit_write(
      case when old.decision = 'accepted' then 'removed_from_overtime' else 'response_deleted' end,
      old.request_id, old.id, old.employee_id,
      jsonb_build_object('answer', old.answer, 'decision', old.decision, 'deleted', true), null, null);
    return old;
  end if;

  if new.employee_id is distinct from old.employee_id or new.request_id is distinct from old.request_id then
    perform public.overtime_audit_write('reassigned', new.request_id, new.id, new.employee_id,
      jsonb_build_object('employee_id', old.employee_id, 'request_id', old.request_id,
        'employee_name', (select full_name from public.employees where id = old.employee_id)),
      jsonb_build_object('employee_id', new.employee_id, 'request_id', new.request_id), null);
  end if;

  if new.answer is distinct from old.answer then
    perform public.overtime_audit_write(
      case new.answer when 'yes' then 'answered_yes' else 'answered_no' end,
      new.request_id, new.id, new.employee_id,
      jsonb_build_object('answer', old.answer), jsonb_build_object('answer', new.answer), null);
  end if;

  if new.decision is distinct from old.decision then
    perform public.overtime_audit_write(public.overtime_audit_decision_event(old.decision, new.decision),
      new.request_id, new.id, new.employee_id,
      jsonb_build_object('decision', old.decision), jsonb_build_object('decision', new.decision), null);
  end if;
  return new;
end;
$$;

drop trigger if exists overtime_audit_responses_t on public.overtime_responses;
create trigger overtime_audit_responses_t
  after insert or update or delete on public.overtime_responses
  for each row execute function public.overtime_audit_responses();

-- ---------------------------------------------------------------------------
-- 5. What happened on the day
-- ---------------------------------------------------------------------------
create or replace function public.overtime_audit_outcome_event(p_outcome text)
returns text
language sql immutable set search_path = public
as $$
  select case p_outcome
    when 'attended'          then 'attended'
    when 'no_show'           then 'no_show'
    when 'called_sick'       then 'called_sick'
    when 'cancelled_in_time' then 'employee_cancelled'
    when 'cancelled_late'    then 'employee_cancelled'
  end;
$$;

create or replace function public.overtime_audit_outcomes()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_resp  public.overtime_responses;
  v_row   public.overtime_outcomes := case when tg_op = 'DELETE' then old else new end;
  v_sick  boolean;
  v_old   jsonb;
  v_new   jsonb;
begin
  select * into v_resp from public.overtime_responses where id = v_row.response_id;
  if v_resp.id is null then return v_row; end if;  -- the response is being deleted too

  -- A sickness note is the person's business: say that one exists, never what it says.
  v_sick := v_row.outcome = 'called_sick' or (tg_op = 'UPDATE' and old.outcome = 'called_sick');

  if tg_op = 'DELETE' then
    perform public.overtime_audit_write('outcome_removed', v_resp.request_id, v_resp.id, v_resp.employee_id,
      jsonb_build_object('outcome', old.outcome), null, null);
    return old;
  end if;

  if tg_op = 'UPDATE' and new.outcome is not distinct from old.outcome
     and new.note is not distinct from old.note then
    return new;
  end if;

  v_new := jsonb_build_object('outcome', new.outcome)
        || case when v_sick then jsonb_build_object('note_recorded', new.note is not null) else '{}'::jsonb end;
  v_old := case when tg_op = 'UPDATE' then jsonb_build_object('outcome', old.outcome) end;

  perform public.overtime_audit_write(public.overtime_audit_outcome_event(new.outcome),
    v_resp.request_id, v_resp.id, v_resp.employee_id, v_old, v_new,
    case when v_sick then null else new.note end);
  return new;
end;
$$;

drop trigger if exists overtime_audit_outcomes_t on public.overtime_outcomes;
create trigger overtime_audit_outcomes_t
  after insert or update or delete on public.overtime_outcomes
  for each row execute function public.overtime_audit_outcomes();

-- ---------------------------------------------------------------------------
-- 6. A day off on the board, on a date with accepted overtime
-- ---------------------------------------------------------------------------
-- Only when it touches overtime: a sick day on a date with no accepted ask is the
-- board's business and is not copied here. The board row carries a status word and
-- nothing else, so nothing more than the word can leak.
create or replace function public.overtime_audit_board()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  r record;
begin
  if new.status not in ('sick', 'holiday', 'unpaid') then return new; end if;
  if tg_op = 'UPDATE' and new.status is not distinct from old.status
     and new.on_date is not distinct from old.on_date then
    return new;
  end if;

  for r in
    select s.id as response_id, s.request_id
      from public.overtime_responses s
      join public.overtime_requests q on q.id = s.request_id
     where s.employee_id = new.employee_id
       and s.decision = 'accepted'
       and q.on_date = new.on_date
       and q.status <> 'cancelled'
  loop
    perform public.overtime_audit_write('absence_affects_overtime', r.request_id, r.response_id, new.employee_id,
      case when tg_op = 'UPDATE' then jsonb_build_object('board_status', old.status) end,
      jsonb_build_object('board_status', new.status, 'board_shift', new.shift), null);
  end loop;
  return new;
end;
$$;

drop trigger if exists overtime_audit_board_t on public.daily_allocations;
create trigger overtime_audit_board_t
  after insert or update of status, on_date on public.daily_allocations
  for each row execute function public.overtime_audit_board();

-- ---------------------------------------------------------------------------
-- 7. The rules and the access that decide who may have overtime
-- ---------------------------------------------------------------------------
create or replace function public.overtime_audit_rules()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare d record;
begin
  select * into d from public.overtime_audit_diff(to_jsonb(old), to_jsonb(new),
    array['no_show_block_days', 'late_cancel_hours', 'late_cancel_blocks']);
  if d.new_value <> '{}'::jsonb then
    perform public.overtime_audit_write('rules_changed', null, null, null, d.old_value, d.new_value, null);
  end if;
  return new;
end;
$$;

drop trigger if exists overtime_audit_rules_t on public.overtime_rules;
create trigger overtime_audit_rules_t
  after update on public.overtime_rules
  for each row execute function public.overtime_audit_rules();

create or replace function public.overtime_audit_permissions()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if coalesce(new.action, old.action) not like 'overtime.%' then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' and new.allowed is not distinct from old.allowed
     and new.role is not distinct from old.role and new.action is not distinct from old.action then
    return new;
  end if;
  perform public.overtime_audit_write('permission_override_changed', null, null, null,
    case when tg_op <> 'INSERT' then jsonb_build_object('role', old.role, 'action', old.action, 'allowed', old.allowed) end,
    case when tg_op <> 'DELETE' then jsonb_build_object('role', new.role, 'action', new.action, 'allowed', new.allowed)
         else jsonb_build_object('deleted', true) end,
    null);
  return coalesce(new, old);
end;
$$;

drop trigger if exists overtime_audit_permissions_t on public.role_permission_overrides;
create trigger overtime_audit_permissions_t
  after insert or update or delete on public.role_permission_overrides
  for each row execute function public.overtime_audit_permissions();

-- ---------------------------------------------------------------------------
-- 8. Append-only
-- ---------------------------------------------------------------------------
create or replace function public.overtime_audit_is_append_only()
returns trigger
language plpgsql set search_path = public
as $$
begin
  raise exception 'The overtime audit is append-only' using errcode = '42501';
end;
$$;

drop trigger if exists overtime_audit_no_rewrite_t on public.overtime_audit;
create trigger overtime_audit_no_rewrite_t
  before update or delete on public.overtime_audit
  for each row execute function public.overtime_audit_is_append_only();

drop trigger if exists overtime_audit_no_truncate_t on public.overtime_audit;
create trigger overtime_audit_no_truncate_t
  before truncate on public.overtime_audit
  for each statement execute function public.overtime_audit_is_append_only();

-- ---------------------------------------------------------------------------
-- 9. Who reads it
-- ---------------------------------------------------------------------------
alter table public.overtime_audit enable row level security;
revoke all on public.overtime_audit from public, anon, authenticated;
grant select on public.overtime_audit to authenticated;

drop policy if exists "overtime_audit_read" on public.overtime_audit;
create policy "overtime_audit_read" on public.overtime_audit
  for select to authenticated
  using (
    public.can_manage_overtime(auth.uid())
    or (employee_id is not null and employee_id = public.my_employee_id())
  );

-- ---------------------------------------------------------------------------
-- 10. What already happened, once
-- ---------------------------------------------------------------------------
-- From the rows as they stand today, so the record does not start empty. Only the
-- last state of each row survives in those tables, so this is marked `backfill`:
-- an answer changed three times before today appears once, as it is now.
do $$
begin
  if exists (select 1 from public.overtime_audit) then return; end if;

  perform public.overtime_audit_write('opportunity_created', q.id, null, null, null,
            jsonb_build_object('on_date', q.on_date, 'starts_at', q.starts_at, 'ends_at', q.ends_at,
              'headcount', q.headcount, 'department', q.department, 'shift_group', q.shift_group),
            q.note, q.created_by, q.created_at, 'backfill')
     from public.overtime_requests q;

  perform public.overtime_audit_write(
            case q.status when 'cancelled' then 'opportunity_cancelled' else 'opportunity_closed' end,
            q.id, null, null, jsonb_build_object('status', 'open'), jsonb_build_object('status', q.status),
            null, null, coalesce(q.closed_at, q.created_at), 'backfill')
     from public.overtime_requests q
    where q.status <> 'open';

  perform public.overtime_audit_write(
            case r.answer when 'yes' then 'answered_yes' else 'answered_no' end,
            r.request_id, r.id, r.employee_id, null, jsonb_build_object('answer', r.answer),
            null, (select e.user_id from public.employees e where e.id = r.employee_id),
            r.answered_at, 'backfill')
     from public.overtime_responses r;

  perform public.overtime_audit_write(public.overtime_audit_decision_event(null, r.decision),
            r.request_id, r.id, r.employee_id, null, jsonb_build_object('decision', r.decision),
            null, r.decided_by, coalesce(r.decided_at, r.answered_at), 'backfill')
     from public.overtime_responses r
    where r.decision is not null;

  perform public.overtime_audit_write(public.overtime_audit_outcome_event(o.outcome),
            r.request_id, r.id, r.employee_id, null,
            jsonb_build_object('outcome', o.outcome)
              || case when o.outcome = 'called_sick' then jsonb_build_object('note_recorded', o.note is not null) else '{}'::jsonb end,
            case when o.outcome = 'called_sick' then null else o.note end,
            o.recorded_by, o.recorded_at, 'backfill')
     from public.overtime_outcomes o
     join public.overtime_responses r on r.id = o.response_id;
end;
$$;
