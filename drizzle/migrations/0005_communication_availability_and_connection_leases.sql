-- Review draft only. Additive objects; no existing message/leave/profile policy changes.
-- Dependencies reviewed: chat_contactable_people (20261020100000),
-- chat_is_member (20261019160000), dm_select_own (20260712154036),
-- leave_requests kind='holiday'/status='approved' (20260804183000).
-- Calendar date is London midnight, deliberately not the operational board date.

create table public.communication_availability (
  user_id uuid primary key,
  preference text not null default 'online'
    check (preference in ('online', 'busy', 'do_not_disturb', 'away', 'offline', 'on_holiday')),
  updated_at timestamptz not null default clock_timestamp()
);
grant select on public.communication_availability to authenticated;
grant all on public.communication_availability to service_role;
alter table public.communication_availability enable row level security;
create policy communication_availability_own_read on public.communication_availability
  for select to authenticated using (user_id = auth.uid());

-- Private leases: neither session identifiers nor per-device times leave the server.
create table public.communication_connection_leases (
  user_id uuid not null,
  auth_session_id uuid not null,
  tab_id uuid not null,
  expires_at timestamptz not null,
  primary key (user_id, auth_session_id, tab_id)
);
grant all on public.communication_connection_leases to service_role;
alter table public.communication_connection_leases enable row level security;
-- No authenticated grants/policies: only validated own-session RPCs write/read leases.
create index communication_connection_leases_expiry_idx
  on public.communication_connection_leases (expires_at);

-- Minimal invalidation only, not preferences, leave flags, or device/session data.
create table public.communication_presence_changes (
  user_id uuid primary key,
  revision uuid not null default gen_random_uuid()
);
grant select on public.communication_presence_changes to authenticated;
grant all on public.communication_presence_changes to service_role;
alter table public.communication_presence_changes enable row level security;

-- This helper always evaluates the current caller, never a supplied viewer.
-- Shared CURRENT groups and OWN historical conversations reuse existing read scope.
-- Contact discovery uses the existing helper verbatim, including supervisor exception.
create function public.communication_can_view_presence(p_target uuid)
returns boolean language sql stable security definer set search_path = ''
as $function$
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
$function$;
revoke all on function public.communication_can_view_presence(uuid) from public, anon;
grant execute on function public.communication_can_view_presence(uuid) to authenticated;

create policy communication_presence_changes_scoped_read on public.communication_presence_changes
  for select to authenticated using (public.communication_can_view_presence(user_id));

-- Caller authentication and active-account guard shared by mutating and own-read RPCs.
create function public.communication_presence_actor()
returns uuid language plpgsql stable security definer set search_path = ''
as $function$
declare v_me uuid := auth.uid();
begin
  if v_me is null or not exists (
    select 1 from public.profiles p where p.id = v_me and coalesce(p.active, true)
  ) then raise exception 'Sign in with an active account' using errcode = '42501'; end if;
  return v_me;
end;
$function$;
revoke all on function public.communication_presence_actor() from public, anon, authenticated;

create function public.communication_touch_presence(p_tab_id uuid)
returns void language plpgsql security definer set search_path = ''
as $function$
declare
  v_me uuid := public.communication_presence_actor();
  v_session uuid := nullif(auth.jwt()->>'session_id', '')::uuid;
  v_now timestamptz := clock_timestamp();
begin
  if p_tab_id is null or v_session is null then
    raise exception 'An authenticated session and tab are required' using errcode = '42501';
  end if;
  -- Serialize cap checks per account so concurrent new UUIDs cannot bypass it.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_me::text, 0));
  -- Bound storage for the returning account; no scheduled job or cross-user writes.
  delete from public.communication_connection_leases l where l.user_id = v_me and l.expires_at <= v_now;
  if not exists (select 1 from public.communication_connection_leases l
      where l.user_id = v_me and l.auth_session_id = v_session and l.tab_id = p_tab_id)
     and (select count(*) from public.communication_connection_leases l where l.user_id = v_me) >= 32 then
    raise exception 'Too many active presence sessions' using errcode = '54000';
  end if;
  insert into public.communication_connection_leases(user_id, auth_session_id, tab_id, expires_at)
    values (v_me, v_session, p_tab_id, v_now + interval '180 seconds')
    on conflict (user_id, auth_session_id, tab_id) do update set expires_at = excluded.expires_at;
  insert into public.communication_presence_changes(user_id, revision) values (v_me, gen_random_uuid())
    on conflict (user_id) do update set revision = excluded.revision;
end;
$function$;
revoke all on function public.communication_touch_presence(uuid) from public, anon;
grant execute on function public.communication_touch_presence(uuid) to authenticated;

create function public.communication_end_presence(p_tab_id uuid)
returns void language plpgsql security definer set search_path = ''
as $function$
declare
  v_me uuid := public.communication_presence_actor();
  v_session uuid := nullif(auth.jwt()->>'session_id', '')::uuid;
begin
  if p_tab_id is null or v_session is null then
    raise exception 'An authenticated session and tab are required' using errcode = '42501';
  end if;
  delete from public.communication_connection_leases l
    where l.user_id = v_me and l.auth_session_id = v_session and l.tab_id = p_tab_id;
  insert into public.communication_presence_changes(user_id, revision) values (v_me, gen_random_uuid())
    on conflict (user_id) do update set revision = excluded.revision;
end;
$function$;
revoke all on function public.communication_end_presence(uuid) from public, anon;
grant execute on function public.communication_end_presence(uuid) to authenticated;

create function public.communication_set_availability(p_preference text)
returns void language plpgsql security definer set search_path = ''
as $function$
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
$function$;
revoke all on function public.communication_set_availability(text) from public, anon;
grant execute on function public.communication_set_availability(text) to authenticated;

-- Private leave derivation: one boolean internally, never dates/kind/note to contacts.
create function public.communication_has_approved_holiday(p_target uuid)
returns boolean language sql stable security definer set search_path = ''
as $function$
  select exists (
    select 1 from public.employees e join public.leave_requests r on r.employee_id = e.id
    where e.user_id = p_target and e.active and r.kind = 'holiday' and r.status = 'approved'
      and (statement_timestamp() at time zone 'Europe/London')::date between r.start_date and r.end_date
  );
$function$;
revoke all on function public.communication_has_approved_holiday(uuid) from public, anon, authenticated;

create function public.communication_my_availability()
returns table(preference text, approved_holiday boolean)
language plpgsql stable security definer set search_path = ''
as $function$
declare v_me uuid := public.communication_presence_actor();
begin
  return query select coalesce((select a.preference from public.communication_availability a where a.user_id = v_me), 'online'),
    public.communication_has_approved_holiday(v_me);
end;
$function$;
revoke all on function public.communication_my_availability() from public, anon;
grant execute on function public.communication_my_availability() to authenticated;

create function public.communication_presence_for(p_user_ids uuid[])
returns table(user_id uuid, status text)
language plpgsql stable security definer set search_path = ''
as $function$
begin
  perform public.communication_presence_actor();
  if p_user_ids is null or cardinality(p_user_ids) > 300 then
    raise exception 'Request up to 300 people' using errcode = '22023';
  end if;
  return query
    select p.id,
      case when public.communication_has_approved_holiday(p.id) or a.preference = 'on_holiday' then 'on_holiday'
           when a.preference = 'offline' then 'offline'
           when not exists (select 1 from public.communication_connection_leases l
             where l.user_id = p.id and l.expires_at > statement_timestamp()) then 'offline'
           else coalesce(a.preference, 'online') end
    from public.profiles p left join public.communication_availability a on a.user_id = p.id
    where p.id = any(p_user_ids) and public.communication_can_view_presence(p.id);
end;
$function$;
revoke all on function public.communication_presence_for(uuid[]) from public, anon;
grant execute on function public.communication_presence_for(uuid[]) to authenticated;

-- Only minimal invalidations are published, not leases/preferences/private leave.
alter publication supabase_realtime add table public.communication_presence_changes;
notify pgrst, 'reload schema';
