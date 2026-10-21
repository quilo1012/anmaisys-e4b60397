-- ================================================================
-- BLOCO 111
-- 20261021090000_the_presence_draft_gets_its_migration_and_its_grants.sql
-- ================================================================
--
-- REGISTA o rascunho de disponibilidade do Communication Hub, que estava na producao sem
-- migracao (3 tabelas e 8 funcoes, todas vazias/por usar), FECHA as permissoes das tabelas
-- (authenticated tinha TRUNCATE, DELETE e UPDATE, e anon tinha SELECT) e faz o batimento
-- calar-se: so avisa quando alguem passa a estar ligado ou desligado, nao de 60 em 60
-- segundos por separador. Passa tambem a LER o dia de trabalho (ferias e baixas aprovadas,
-- quadro de presencas, escala do turno): ferias -> On Holiday, baixa/falta -> Offline, Online fora do
-- turno (30 min de folga) -> Away; Busy e Do Not Disturb nunca mudam. Nao muda dados, nem as
-- politicas das mensagens.
-- Pode colar-se duas vezes. Precisa dos BLOCOS 107 a 110.
-- Teste depois: supabase/tests/communication_presence_test.sql (acaba em ALL TESTS PASSED, com ROLLBACK).
--
-- The Communication presence draft gets its migration, its grants, and a quieter heartbeat.
--
-- WHAT WAS THERE. A server side for availability was applied to production directly, with
-- no migration: three tables (communication_availability, communication_connection_leases,
-- communication_presence_changes) and eight functions. Read from production on 21/10/2026:
-- every table empty, nothing in the app calling any of it. The client half is
-- src/lib/communicationPresence.ts, whose rules these functions already follow:
-- availability is a PREFERENCE, a connection is a 180-second LEASE, the final status is
-- derived on the server with the server's clock, and nothing private leaves it.
--
-- This file does not build a second implementation. It does three things to that one:
--
--   1. RECORDS it. `create table if not exists` and `create or replace function`, with the
--      bodies production has, so a fresh database gets the same objects (the app now reads
--      them, and an object the app reads must exist in a migration).
--
--   2. CLOSES THE GRANTS. The tables were created with the platform's default grants:
--      `authenticated` could INSERT, UPDATE, DELETE and TRUNCATE all three, and `anon` could
--      SELECT them. Row level security stops the first three only where a policy says so;
--      TRUNCATE ignores it entirely, so any signed-in account could empty everyone's
--      presence. After this file the tables are read-only to `authenticated` (and the lease
--      table is not readable at all), `anon` has nothing, and every write goes through the
--      functions below, which take the identity from the JWT and never from an argument.
--
--   3. QUIETS THE HEARTBEAT. `communication_touch_presence` bumped the person's row in
--      `communication_presence_changes` on EVERY beat, i.e. once a minute per open tab, and
--      Realtime evaluates that table's policy (communication_can_view_presence, which calls
--      chat_contactable_people()) once per subscriber per change. That is people x viewers
--      policy evaluations a minute for nothing: a viewer only needs to hear when somebody
--      BECOMES connected or STOPS being connected. Now the revision moves when the person
--      goes from no live lease to a live one (touch), when their last live lease ends (end),
--      and when they change their preference. A lease that simply times out cannot announce
--      itself; clients re-read on a timer for that.
--
-- THE RULES (communication_presence_for). The system reads the person's WORK STATE from what
-- it already knows (communication_work_state), the person's choice never being rewritten:
--   approved holiday leave today, or a holiday on the attendance board  -> on_holiday
--   approved sick/unpaid leave today, or sick/unpaid/absent on the board -> offline
--   preference 'on_holiday'                                              -> on_holiday
--   preference 'offline', or no live lease                               -> offline
--   preference 'online' but outside the shift (30 min grace either side) -> away
--   otherwise                                                            -> the preference
-- Busy and Do Not Disturb are never changed by the schedule. Sick/unpaid is shown as Offline,
-- never as a word that tells colleagues why. No pattern or no linked employee = no opinion.
-- A preference is kept until its owner changes it; there is no automatic expiry. Automatic
-- states last only while they are true and the preference is back untouched afterwards.
--
-- NOTHING HERE TOUCHES MESSAGE DELIVERY: no policy on direct_messages or the group tables
-- changes, and none of these functions is called by them.
--
-- Needs: leave_requests, employees, profiles, direct_messages, chat_group_members,
-- chat_is_member and chat_contactable_people (20261020100000).

-- ── 1. Tables, as production has them ───────────────────────────────────────
create table if not exists public.communication_availability (
  user_id    uuid primary key,
  preference text not null default 'online'
    check (preference in ('online', 'busy', 'do_not_disturb', 'away', 'offline', 'on_holiday')),
  updated_at timestamptz not null default clock_timestamp()
);

create table if not exists public.communication_connection_leases (
  user_id         uuid not null,
  auth_session_id uuid not null,
  tab_id          uuid not null,
  expires_at      timestamptz not null,
  primary key (user_id, auth_session_id, tab_id)
);
create index if not exists communication_connection_leases_expiry_idx
  on public.communication_connection_leases (expires_at);

create table if not exists public.communication_presence_changes (
  user_id  uuid primary key,
  revision uuid not null default gen_random_uuid()
);

alter table public.communication_availability      enable row level security;
alter table public.communication_connection_leases enable row level security;
alter table public.communication_presence_changes  enable row level security;

-- ── 2. Grants: read what a policy allows, write only through the functions ──
revoke all on public.communication_availability      from public, anon, authenticated;
revoke all on public.communication_connection_leases from public, anon, authenticated;
revoke all on public.communication_presence_changes  from public, anon, authenticated;
grant select on public.communication_availability     to authenticated;   -- own row only (policy)
grant select on public.communication_presence_changes to authenticated;   -- Realtime, scoped by policy
-- The lease table has no grant and no policy: it is reachable through the functions only.

-- ── 3. Functions ────────────────────────────────────────────────────────────
create or replace function public.communication_presence_actor()
returns uuid
language plpgsql stable security definer set search_path to ''
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null or not exists (
    select 1 from public.profiles p where p.id = v_me and coalesce(p.active, true)
  ) then raise exception 'Sign in with an active account' using errcode = '42501'; end if;
  return v_me;
end;
$$;

create or replace function public.communication_has_approved_holiday(p_target uuid)
returns boolean
language sql stable security definer set search_path to ''
as $$
  select exists (
    select 1 from public.employees e join public.leave_requests r on r.employee_id = e.id
    where e.user_id = p_target and e.active and r.kind = 'holiday' and r.status = 'approved'
      and (statement_timestamp() at time zone 'Europe/London')::date between r.start_date and r.end_date
  );
$$;

-- What the system knows about this person's working day, in the London calendar: 'holiday',
-- 'absent' (sick, unpaid, absent), 'on_shift', 'off_shift', or null when it cannot tell (no
-- linked employee, no shift pattern). Reads leave, the attendance board and the rota; returns
-- only the word, never the record. Used by the definers below; nobody calls it directly.
create or replace function public.communication_work_state(p_target uuid)
returns text
language plpgsql stable security definer set search_path to ''
as $$
declare
  v_local   timestamp := statement_timestamp() at time zone 'Europe/London';
  v_today   date := (statement_timestamp() at time zone 'Europe/London')::date;
  v_pattern uuid;
  v_days    smallint[];
  v_s time; v_e time; v_ps time; v_pe time;
  v_d date; v_start timestamp; v_end timestamp;
begin
  select e.shift_pattern_id into v_pattern
    from public.employees e where e.user_id = p_target and e.active order by e.created_at limit 1;
  if not found then return null; end if;

  if public.communication_has_approved_holiday(p_target)
     or exists (select 1 from public.employees e join public.employee_attendance a on a.employee_id = e.id
                where e.user_id = p_target and e.active and a.on_date = v_today and a.status = 'holiday') then
    return 'holiday';
  end if;
  if exists (select 1 from public.employees e join public.leave_requests r on r.employee_id = e.id
             where e.user_id = p_target and e.active and r.kind in ('sick', 'unpaid') and r.status = 'approved'
               and v_today between r.start_date and r.end_date)
     or exists (select 1 from public.employees e join public.employee_attendance a on a.employee_id = e.id
                where e.user_id = p_target and e.active and a.on_date = v_today
                  and a.status in ('sick', 'unpaid', 'absent')) then
    return 'absent';
  end if;
  -- Recorded present today: at work, whatever the rota says (overtime, a swapped day).
  if exists (select 1 from public.employees e join public.employee_attendance a on a.employee_id = e.id
             where e.user_id = p_target and e.active and a.on_date = v_today and a.status in ('present', 'training')) then
    return 'on_shift';
  end if;

  if v_pattern is null then return null; end if;
  select p.days, p.starts_at, p.ends_at into v_days, v_s, v_e
    from public.shift_patterns p where p.id = v_pattern and p.active;
  if not found then return null; end if;
  -- A rota with days only: the whole of a covered day counts.
  if v_s is null or v_e is null then
    return case when extract(isodow from v_today)::smallint = any (v_days) then 'on_shift' else 'off_shift' end;
  end if;
  -- Today's shift, and yesterday's if it runs past midnight. Per-day hours override the pattern.
  foreach v_d in array array[v_today - 1, v_today] loop
    if extract(isodow from v_d)::smallint = any (v_days) then
      v_ps := null; v_pe := null;
      select d.starts_at, d.ends_at into v_ps, v_pe from public.shift_pattern_days d
        where d.pattern_id = v_pattern and d.weekday = extract(isodow from v_d)::smallint;
      v_ps := coalesce(v_ps, v_s); v_pe := coalesce(v_pe, v_e);
      v_start := v_d + v_ps;
      v_end   := v_d + v_pe + case when v_pe <= v_ps then interval '1 day' else interval '0' end;
      if v_local between v_start - interval '30 minutes' and v_end + interval '30 minutes' then
        return 'on_shift';
      end if;
    end if;
  end loop;
  return 'off_shift';
end;
$$;

create or replace function public.communication_can_view_presence(p_target uuid)
returns boolean
language sql stable security definer set search_path to ''
as $$
  select auth.uid() is not null
    and exists (select 1 from public.profiles me where me.id = auth.uid() and coalesce(me.active, true))
    and exists (select 1 from public.profiles p where p.id = p_target and coalesce(p.active, true))
    and (
      p_target = auth.uid()
      or exists (select 1 from public.chat_contactable_people() c where c.user_id = p_target)
      or exists (select 1 from public.direct_messages d
        where (d.sender_id = auth.uid() and d.recipient_id = p_target)
           or (d.recipient_id = auth.uid() and d.sender_id = p_target))
      or exists (select 1 from public.chat_group_members m
        where m.user_id = p_target and m.left_at is null
          and public.chat_is_member(auth.uid(), m.group_id))
    );
$$;

create or replace function public.communication_set_availability(p_preference text)
returns void
language plpgsql security definer set search_path to ''
as $$
declare v_me uuid := public.communication_presence_actor();
begin
  if p_preference is null or p_preference not in ('online', 'busy', 'do_not_disturb', 'away', 'offline', 'on_holiday') then
    raise exception 'Choose a permitted availability status' using errcode = '22023';
  end if;
  insert into public.communication_availability(user_id, preference, updated_at)
    values (v_me, p_preference, clock_timestamp())
    on conflict (user_id) do update set preference = excluded.preference, updated_at = excluded.updated_at;
  insert into public.communication_presence_changes(user_id, revision) values (v_me, gen_random_uuid())
    on conflict (user_id) do update set revision = excluded.revision;
end;
$$;

-- The return type changed (it gained the automatic state), so the old function goes first.
drop function if exists public.communication_my_availability();
create function public.communication_my_availability()
returns table (preference text, approved_holiday boolean, automatic_status text, automatic_reason text)
language plpgsql stable security definer set search_path to ''
as $$
declare
  v_me   uuid := public.communication_presence_actor();
  v_pref text := coalesce((select a.preference from public.communication_availability a where a.user_id = v_me), 'online');
  v_work text := public.communication_work_state(v_me);
begin
  return query select v_pref, v_work = 'holiday',
    case when v_work = 'holiday' then 'on_holiday'
         when v_work = 'absent' then 'offline'
         when v_work = 'off_shift' and v_pref = 'online' then 'away' end,
    case when v_work = 'holiday' then 'holiday'
         when v_work = 'absent' then 'absence'
         when v_work = 'off_shift' and v_pref = 'online' then 'off_shift' end;
end;
$$;

create or replace function public.communication_end_presence(p_tab_id uuid)
returns void
language plpgsql security definer set search_path to ''
as $$
declare
  v_me uuid := public.communication_presence_actor();
  v_session uuid := nullif(auth.jwt()->>'session_id', '')::uuid;
begin
  if p_tab_id is null or v_session is null then
    raise exception 'An authenticated session and tab are required' using errcode = '42501';
  end if;
  delete from public.communication_connection_leases l
    where l.user_id = v_me and l.auth_session_id = v_session and l.tab_id = p_tab_id;
  -- Only news if that was the last live lease: another open tab keeps the person connected.
  if not exists (select 1 from public.communication_connection_leases l
                  where l.user_id = v_me and l.expires_at > clock_timestamp()) then
    insert into public.communication_presence_changes(user_id, revision) values (v_me, gen_random_uuid())
      on conflict (user_id) do update set revision = excluded.revision;
  end if;
end;
$$;

create or replace function public.communication_presence_for(p_user_ids uuid[])
returns table (user_id uuid, status text)
language plpgsql stable security definer set search_path to ''
as $$
begin
  perform public.communication_presence_actor();
  if p_user_ids is null or cardinality(p_user_ids) > 300 then
    raise exception 'Request up to 300 people' using errcode = '22023';
  end if;
  return query
    select p.id,
      case when w.state = 'holiday' or a.preference = 'on_holiday' then 'on_holiday'
           when w.state = 'absent' then 'offline'
           when a.preference = 'offline' then 'offline'
           when not exists (select 1 from public.communication_connection_leases l
             where l.user_id = p.id and l.expires_at > statement_timestamp()) then 'offline'
           when w.state = 'off_shift' and coalesce(a.preference, 'online') = 'online' then 'away'
           else coalesce(a.preference, 'online') end
    from public.profiles p left join public.communication_availability a on a.user_id = p.id
    cross join lateral (select public.communication_work_state(p.id) as state) w
    where p.id = any(p_user_ids) and public.communication_can_view_presence(p.id);
end;
$$;

-- Execute: signed-in users on the six they call; the two helpers only the definers use.
revoke all on function public.communication_presence_actor()            from public, anon, authenticated;
revoke all on function public.communication_has_approved_holiday(uuid)  from public, anon, authenticated;
revoke all on function public.communication_work_state(uuid)            from public, anon, authenticated;
revoke all on function public.communication_can_view_presence(uuid)     from public, anon;
revoke all on function public.communication_set_availability(text)      from public, anon;
revoke all on function public.communication_my_availability()           from public, anon;
revoke all on function public.communication_touch_presence(uuid)        from public, anon;
revoke all on function public.communication_end_presence(uuid)          from public, anon;
revoke all on function public.communication_presence_for(uuid[])        from public, anon;
grant execute on function public.communication_can_view_presence(uuid)  to authenticated;  -- the policy below calls it as the invoker
grant execute on function public.communication_set_availability(text)   to authenticated;
grant execute on function public.communication_my_availability()        to authenticated;
grant execute on function public.communication_touch_presence(uuid)     to authenticated;
grant execute on function public.communication_end_presence(uuid)       to authenticated;
grant execute on function public.communication_presence_for(uuid[])     to authenticated;

-- ── 4. Policies ─────────────────────────────────────────────────────────────
drop policy if exists "communication_availability_own_read" on public.communication_availability;
create policy "communication_availability_own_read" on public.communication_availability
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "communication_presence_changes_scoped_read" on public.communication_presence_changes;
create policy "communication_presence_changes_scoped_read" on public.communication_presence_changes
  for select to authenticated using (public.communication_can_view_presence(user_id));

-- ── 5. Realtime: the change marker, not the data ───────────────────────────
-- The published row carries only a user id and a fresh revision. Each subscriber receives
-- it only if communication_can_view_presence says so, then re-reads the status through
-- communication_presence_for(), which applies the same check again.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public'
                        and tablename = 'communication_presence_changes') then
    alter publication supabase_realtime add table public.communication_presence_changes;
  end if;
end $$;

notify pgrst, 'reload schema';
