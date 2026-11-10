-- Meetings in the Communication Hub (roadmap Stage 3 — meeting scheduling). BLOCO 159.
--
-- WHAT THIS DOES.
--   1. Two tables: `meetings` (one row per occurrence; a recurring meeting is several
--      rows sharing `series_id`) and `meeting_participants` (one row per person per
--      occurrence, with their answer).
--   2. RLS: only who holds `meetings.manage` (admin by default, through `has_action`, so
--      the Permissions screen is the one place it changes) writes meetings or invites.
--      Everybody else reads only the occurrences they are invited to, and changes only
--      their own answer — the column grant leaves nothing else they could write.
--   3. The admin's writes go through four functions — create, update, cancel and the
--      people list — so an occurrence, its invitations and its notices land together or
--      not at all. Each checks `meetings.manage` again: RLS is not the only gate.
--   4. Notices are rows in `notifications` (`kind` + the new `meeting_id`), so the bell
--      shows them and the existing `notification_push` trigger buzzes the phone. Nothing
--      new talks to send-push.
--   5. A reminder 15 minutes before, to whoever has not declined, written by a pg_cron
--      job every minute. `meeting_participants.reminder_sent_at` is claimed by the same
--      UPDATE that decides who is due, so two runs at once remind one person once; a
--      unique index on the notification is the second lock.
--
-- A TEAM OR A CREW IS RESOLVED WHEN THE INVITE IS SENT. The form turns "Packing, crew A"
-- into people and the function stores those people. Whoever joins the crew next month is
-- not in last month's meeting, and whoever leaves keeps the invite they had.
--
-- TIME. `starts_at`/`ends_at` are instants. Recurrence repeats the Europe/London wall
-- clock: a weekly 09:00 stays 09:00 across the clock change. A monthly meeting on the
-- 31st lands on the last day of shorter months (Postgres month arithmetic), counted from
-- the first occurrence each time, so it does not drift to the 28th for good.
--
-- DEPENDS ON: `has_action` (BLOCO 83), `notifications` with `kind` (BLOCO 100) and its
-- push trigger (117), pg_cron. Idempotent: it can be pasted twice.

-- ── 1. Tables ────────────────────────────────────────────────────────────────
create table if not exists public.meetings (
  id               uuid primary key default gen_random_uuid(),
  series_id        uuid not null default gen_random_uuid(),
  title            text not null check (length(btrim(title)) between 1 and 200),
  description      text check (description is null or length(description) <= 5000),
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  location         text check (location is null or length(location) <= 300),
  video_link       text check (video_link is null or (length(video_link) <= 2048 and video_link ~* '^https://')),
  recurrence       text not null default 'none' check (recurrence in ('none', 'daily', 'weekly', 'monthly')),
  recurrence_until date,
  created_by       uuid not null references auth.users(id),
  cancelled_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint meetings_ends_after_start check (ends_at > starts_at),
  constraint meetings_until_with_recurrence check ((recurrence = 'none') = (recurrence_until is null))
);

create index if not exists meetings_starts_at_idx on public.meetings (starts_at);
create index if not exists meetings_series_idx on public.meetings (series_id, starts_at);

create table if not exists public.meeting_participants (
  meeting_id       uuid not null references public.meetings(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  response         text not null default 'pending' check (response in ('pending', 'accepted', 'declined')),
  responded_at     timestamptz,
  reminder_sent_at timestamptz,
  created_at       timestamptz not null default now(),
  constraint meeting_participants_one_per_person unique (meeting_id, user_id)
);

create index if not exists meeting_participants_user_idx on public.meeting_participants (user_id);

-- The notice says which meeting it is about; deleting a meeting takes its notices.
alter table public.notifications
  add column if not exists meeting_id uuid references public.meetings(id) on delete cascade;
create index if not exists notifications_meeting_idx on public.notifications (meeting_id) where meeting_id is not null;
-- The second lock on the reminder: one per person per occurrence, ever.
create unique index if not exists notifications_one_meeting_reminder
  on public.notifications (user_id, meeting_id) where kind = 'meeting_reminder';

-- ── 2. Who may ───────────────────────────────────────────────────────────────
create or replace function public.meeting_can_manage(p_uid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select p_uid is not null and public.has_action(p_uid, 'meetings.manage', array['admin']::app_role[]);
$$;
revoke all on function public.meeting_can_manage(uuid) from public, anon;
grant execute on function public.meeting_can_manage(uuid) to authenticated;

-- Definer, so the participants policy can ask it without reading its own table under
-- RLS (the 42P17 recursion of BLOCO 102/103b).
create or replace function public.meeting_is_participant(p_meeting uuid, p_uid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.meeting_participants
                  where meeting_id = p_meeting and user_id = p_uid);
$$;
revoke all on function public.meeting_is_participant(uuid, uuid) from public, anon;
grant execute on function public.meeting_is_participant(uuid, uuid) to authenticated;

alter table public.meetings enable row level security;
alter table public.meeting_participants enable row level security;

drop policy if exists meetings_read on public.meetings;
create policy meetings_read on public.meetings for select to authenticated
  using (public.meeting_can_manage(auth.uid()) or public.meeting_is_participant(id, auth.uid()));

drop policy if exists meetings_write on public.meetings;
create policy meetings_write on public.meetings for all to authenticated
  using (public.meeting_can_manage(auth.uid()))
  with check (public.meeting_can_manage(auth.uid()));

drop policy if exists meeting_participants_read on public.meeting_participants;
create policy meeting_participants_read on public.meeting_participants for select to authenticated
  using (public.meeting_can_manage(auth.uid()) or public.meeting_is_participant(meeting_id, auth.uid()));

drop policy if exists meeting_participants_manage on public.meeting_participants;
create policy meeting_participants_manage on public.meeting_participants for all to authenticated
  using (public.meeting_can_manage(auth.uid()))
  with check (public.meeting_can_manage(auth.uid()));

-- One's own answer. The column grant below is what keeps it to the answer.
drop policy if exists meeting_participants_answer_own on public.meeting_participants;
create policy meeting_participants_answer_own on public.meeting_participants for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

revoke all on public.meetings, public.meeting_participants from anon;
revoke all on public.meetings, public.meeting_participants from authenticated;
grant select, insert, update, delete on public.meetings to authenticated;
grant select, insert, delete on public.meeting_participants to authenticated;
grant update (response, responded_at) on public.meeting_participants to authenticated;

-- ── 3. Helpers ───────────────────────────────────────────────────────────────
create or replace function public.meeting_person_name(p_uid uuid)
returns text
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select e.full_name from public.employees e where e.user_id = p_uid and e.active limit 1),
    (select nullif(btrim(p.name), '') from public.profiles p where p.id = p_uid),
    'Someone');
$$;
revoke all on function public.meeting_person_name(uuid) from public, anon, authenticated;

-- "Tue 11/11 09:00–09:30" in London time.
create or replace function public.meeting_when(p_start timestamptz, p_end timestamptz)
returns text
language sql stable set search_path = public
as $$
  select to_char(p_start at time zone 'Europe/London', 'Dy DD/MM HH24:MI')
         || '–' || to_char(p_end at time zone 'Europe/London', 'HH24:MI');
$$;
revoke all on function public.meeting_when(timestamptz, timestamptz) from public, anon, authenticated;

-- The occurrences of a series: the wall-clock start repeated until `p_until` (a London
-- date, inclusive). Always the first one; at most 366.
create or replace function public.meeting_occurrences(
  p_starts_at timestamptz, p_ends_at timestamptz, p_recurrence text, p_until date
)
returns table (starts_at timestamptz, ends_at timestamptz)
language sql stable set search_path = public
as $$
  with base as (
    select p_starts_at at time zone 'Europe/London' as local_start,
           p_ends_at - p_starts_at                  as len,
           case p_recurrence when 'daily' then interval '1 day'
                             when 'weekly' then interval '7 days'
                             when 'monthly' then interval '1 month' end as step
  ),
  seq as (
    select (b.local_start + (g.i * b.step)) as local_start, b.len
      from base b, generate_series(0, 365) as g(i)
     where p_recurrence in ('daily', 'weekly', 'monthly')
       and (b.local_start + (g.i * b.step))::date <= p_until
    union all
    select b.local_start, b.len from base b
     where p_recurrence = 'none' or p_until is null
  )
  select (s.local_start at time zone 'Europe/London'),
         (s.local_start at time zone 'Europe/London') + s.len
    from seq s
   order by 1;
$$;
revoke all on function public.meeting_occurrences(timestamptz, timestamptz, text, date) from public, anon;
grant execute on function public.meeting_occurrences(timestamptz, timestamptz, text, date) to authenticated;

-- ── 4. The people an admin can invite ────────────────────────────────────────
-- Every active login, with the department and crew of its employee record when there is
-- one. The form groups these into departments, teams (department + crew) and crews.
create or replace function public.meeting_invitable_people()
returns table (user_id uuid, name text, department text, crew text, job text)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.meeting_can_manage(auth.uid()) then
    raise exception 'Only an admin schedules meetings' using errcode = '42501';
  end if;
  return query
  select p.id,
         coalesce(e.full_name, nullif(btrim(p.name), ''), p.email, 'User')::text,
         nullif(btrim(e.department), '')::text,
         nullif(btrim(e.shift_group), '')::text,
         coalesce(nullif(btrim(e.position), ''),
                  initcap(replace((select r.role::text from public.user_roles r where r.user_id = p.id limit 1), '_', ' ')))::text
    from public.profiles p
    left join lateral (select x.full_name, x.position, x.department, x.shift_group
                         from public.employees x
                        where x.user_id = p.id and x.active limit 1) e on true
   where coalesce(p.active, true)
     and exists (select 1 from auth.users u where u.id = p.id)
   order by 2;
end;
$$;
revoke all on function public.meeting_invitable_people() from public, anon;
grant execute on function public.meeting_invitable_people() to authenticated;

-- Names and answers of everybody in one occurrence, for whoever may read it.
create or replace function public.meeting_participant_list(p_meeting uuid)
returns table (user_id uuid, name text, response text, responded_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not (public.meeting_can_manage(auth.uid()) or public.meeting_is_participant(p_meeting, auth.uid())) then
    raise exception 'You are not invited to this meeting' using errcode = '42501';
  end if;
  return query
  select mp.user_id, public.meeting_person_name(mp.user_id), mp.response, mp.responded_at
    from public.meeting_participants mp
   where mp.meeting_id = p_meeting
   order by case mp.response when 'accepted' then 0 when 'pending' then 1 else 2 end, 2;
end;
$$;
revoke all on function public.meeting_participant_list(uuid) from public, anon;
grant execute on function public.meeting_participant_list(uuid) to authenticated;

-- ── 5. Create ────────────────────────────────────────────────────────────────
-- Returns the series id. The creator is a participant, already accepted. Each invited
-- person gets one invite for the series (on its first occurrence), not one per week.
create or replace function public.meeting_create(
  p_title            text,
  p_description      text,
  p_starts_at        timestamptz,
  p_ends_at          timestamptz,
  p_location         text,
  p_video_link       text,
  p_recurrence       text,
  p_recurrence_until date,
  p_participants     uuid[]
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_me      uuid := auth.uid();
  v_series  uuid := gen_random_uuid();
  v_first   uuid;
  v_count   integer;
  v_people  uuid[];
  v_rec     text := coalesce(nullif(p_recurrence, ''), 'none');
  v_until   date := case when coalesce(nullif(p_recurrence, ''), 'none') = 'none' then null else p_recurrence_until end;
  v_repeat  text;
begin
  if not public.meeting_can_manage(v_me) then
    raise exception 'Only an admin schedules meetings' using errcode = '42501';
  end if;
  if p_ends_at is null or p_starts_at is null or p_ends_at <= p_starts_at then
    raise exception 'The meeting must end after it starts' using errcode = '22023';
  end if;
  if v_rec <> 'none' and v_until is null then
    raise exception 'A repeating meeting needs a "repeat until" date' using errcode = '22023';
  end if;
  if v_rec <> 'none' and v_until < (p_starts_at at time zone 'Europe/London')::date then
    raise exception '"Repeat until" is before the first meeting' using errcode = '22023';
  end if;

  select array_agg(distinct x) into v_people
    from unnest(coalesce(p_participants, '{}'::uuid[])) x
   where x is not null and x <> v_me
     and exists (select 1 from auth.users u where u.id = x);
  if coalesce(array_length(v_people, 1), 0) = 0 then
    raise exception 'Invite at least one person' using errcode = '22023';
  end if;

  insert into public.meetings (series_id, title, description, starts_at, ends_at, location,
                               video_link, recurrence, recurrence_until, created_by)
  select v_series, btrim(p_title), nullif(btrim(p_description), ''), o.starts_at, o.ends_at,
         nullif(btrim(p_location), ''), nullif(btrim(p_video_link), ''), v_rec, v_until, v_me
    from public.meeting_occurrences(p_starts_at, p_ends_at, v_rec, v_until) o;
  get diagnostics v_count = row_count;

  insert into public.meeting_participants (meeting_id, user_id, response, responded_at)
  select m.id, v_me, 'accepted', now() from public.meetings m where m.series_id = v_series
  union all
  select m.id, u, 'pending', null from public.meetings m, unnest(v_people) u where m.series_id = v_series;

  select id into v_first from public.meetings where series_id = v_series order by starts_at limit 1;
  v_repeat := case v_rec when 'none' then ''
                         else ' · repeats ' || v_rec || ' until ' || to_char(v_until, 'DD/MM/YYYY') end;

  insert into public.notifications (user_id, kind, meeting_id, title, body, priority, action_url)
  select u, 'meeting_invite', v_first,
         left(public.meeting_person_name(v_me) || ' invited you to ' || btrim(p_title), 200),
         public.meeting_when(m.starts_at, m.ends_at) || v_repeat,
         'medium', '/dashboard/communication/meetings?meeting=' || v_first
    from unnest(v_people) u, public.meetings m
   where m.id = v_first;

  return v_series;
end;
$$;
revoke all on function public.meeting_create(text, text, timestamptz, timestamptz, text, text, text, date, uuid[]) from public, anon;
grant execute on function public.meeting_create(text, text, timestamptz, timestamptz, text, text, text, date, uuid[]) to authenticated;

-- ── 6. Update ────────────────────────────────────────────────────────────────
-- p_scope 'one' = this occurrence; 'following' = this and the later ones of its series.
-- New times move every chosen occurrence by the same wall-clock shift as this one and
-- give them the new length. A moved meeting is reminded afresh. Participants: whoever is
-- in p_participants and was not is invited; whoever was and is not is removed; the
-- others keep their answer. Date, time or place changed → everybody still invited hears.
create or replace function public.meeting_update(
  p_meeting      uuid,
  p_scope        text,
  p_title        text,
  p_description  text,
  p_starts_at    timestamptz,
  p_ends_at      timestamptz,
  p_location     text,
  p_video_link   text,
  p_participants uuid[]
)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_me      uuid := auth.uid();
  v_m       public.meetings%rowtype;
  v_shift   interval;
  v_len     interval;
  v_ids     uuid[];
  v_people  uuid[];
  v_moved   boolean;
  v_placed  boolean;
  v_new     uuid[];
begin
  if not public.meeting_can_manage(v_me) then
    raise exception 'Only an admin changes meetings' using errcode = '42501';
  end if;
  select * into v_m from public.meetings where id = p_meeting for update;
  if not found then
    raise exception 'Meeting not found' using errcode = 'P0002';
  end if;
  if v_m.cancelled_at is not null then
    raise exception 'This meeting is cancelled' using errcode = '22023';
  end if;
  if p_scope not in ('one', 'following') then
    raise exception 'Scope is "one" or "following"' using errcode = '22023';
  end if;
  if p_ends_at is null or p_starts_at is null or p_ends_at <= p_starts_at then
    raise exception 'The meeting must end after it starts' using errcode = '22023';
  end if;

  select array_agg(distinct x) into v_people
    from unnest(coalesce(p_participants, '{}'::uuid[])) x
   where x is not null and exists (select 1 from auth.users u where u.id = x);
  if not (v_me = any (coalesce(v_people, '{}'))) then
    v_people := array_append(coalesce(v_people, '{}'), v_me);
  end if;
  if array_length(v_people, 1) < 2 then
    raise exception 'Invite at least one person' using errcode = '22023';
  end if;

  select array_agg(id order by starts_at) into v_ids
    from public.meetings
   where case when p_scope = 'one' then id = p_meeting
              else series_id = v_m.series_id and starts_at >= v_m.starts_at and cancelled_at is null end;

  v_shift  := (p_starts_at at time zone 'Europe/London') - (v_m.starts_at at time zone 'Europe/London');
  v_len    := p_ends_at - p_starts_at;
  v_moved  := v_shift <> interval '0' or v_len <> (v_m.ends_at - v_m.starts_at);
  v_placed := coalesce(nullif(btrim(p_location), ''), '') is distinct from coalesce(v_m.location, '');

  update public.meetings m
     set title       = btrim(p_title),
         description = nullif(btrim(p_description), ''),
         location    = nullif(btrim(p_location), ''),
         video_link  = nullif(btrim(p_video_link), ''),
         starts_at   = ((m.starts_at at time zone 'Europe/London') + v_shift) at time zone 'Europe/London',
         ends_at     = (((m.starts_at at time zone 'Europe/London') + v_shift) at time zone 'Europe/London') + v_len,
         updated_at  = now()
   where m.id = any (v_ids);

  if v_moved then
    update public.meeting_participants set reminder_sent_at = null where meeting_id = any (v_ids);
    delete from public.notifications where kind = 'meeting_reminder' and meeting_id = any (v_ids);
  end if;

  delete from public.meeting_participants
   where meeting_id = any (v_ids) and not (user_id = any (v_people));

  select array_agg(u) into v_new
    from unnest(v_people) u
   where not exists (select 1 from public.meeting_participants mp
                      where mp.meeting_id = p_meeting and mp.user_id = u);

  insert into public.meeting_participants (meeting_id, user_id, response, responded_at)
  select i, u, case when u = v_me then 'accepted' else 'pending' end,
         case when u = v_me then now() end
    from unnest(v_ids) i, unnest(v_people) u
  on conflict (meeting_id, user_id) do nothing;

  select * into v_m from public.meetings where id = p_meeting;

  -- Newly invited: an invite. Already there and something they rely on moved: a change.
  insert into public.notifications (user_id, kind, meeting_id, title, body, priority, action_url)
  select u, 'meeting_invite', p_meeting,
         left(public.meeting_person_name(v_me) || ' invited you to ' || v_m.title, 200),
         public.meeting_when(v_m.starts_at, v_m.ends_at)
           || case when p_scope = 'following' and array_length(v_ids, 1) > 1
                   then ' · and ' || (array_length(v_ids, 1) - 1) || ' more' else '' end,
         'medium', '/dashboard/communication/meetings?meeting=' || p_meeting
    from unnest(coalesce(v_new, '{}')) u
   where u <> v_me;

  if v_moved or v_placed then
    insert into public.notifications (user_id, kind, meeting_id, title, body, priority, action_url)
    select u, 'meeting_changed', p_meeting,
           left('Meeting changed: ' || v_m.title, 200),
           public.meeting_when(v_m.starts_at, v_m.ends_at)
             || coalesce(' · ' || v_m.location, '')
             || case when p_scope = 'following' and array_length(v_ids, 1) > 1
                     then ' · this and the next ' || (array_length(v_ids, 1) - 1) else '' end,
           'high', '/dashboard/communication/meetings?meeting=' || p_meeting
      from unnest(v_people) u
     where u <> v_me and not (u = any (coalesce(v_new, '{}')));
  end if;

  return array_length(v_ids, 1);
end;
$$;
revoke all on function public.meeting_update(uuid, text, text, text, timestamptz, timestamptz, text, text, uuid[]) from public, anon;
grant execute on function public.meeting_update(uuid, text, text, text, timestamptz, timestamptz, text, text, uuid[]) to authenticated;

-- ── 7. Cancel ────────────────────────────────────────────────────────────────
create or replace function public.meeting_cancel(p_meeting uuid, p_scope text)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_me  uuid := auth.uid();
  v_m   public.meetings%rowtype;
  v_ids uuid[];
begin
  if not public.meeting_can_manage(v_me) then
    raise exception 'Only an admin cancels meetings' using errcode = '42501';
  end if;
  if p_scope not in ('one', 'following') then
    raise exception 'Scope is "one" or "following"' using errcode = '22023';
  end if;
  select * into v_m from public.meetings where id = p_meeting for update;
  if not found then
    raise exception 'Meeting not found' using errcode = 'P0002';
  end if;

  with done as (
    update public.meetings
       set cancelled_at = now(), updated_at = now()
     where cancelled_at is null
       and case when p_scope = 'one' then id = p_meeting
                else series_id = v_m.series_id and starts_at >= v_m.starts_at end
    returning id, starts_at
  )
  select array_agg(id order by starts_at) into v_ids from done;

  if v_ids is null then return 0; end if;

  delete from public.notifications
   where kind = 'meeting_reminder' and meeting_id = any (v_ids) and read_at is null;

  insert into public.notifications (user_id, kind, meeting_id, title, body, priority, action_url)
  select mp.user_id, 'meeting_cancelled', p_meeting,
         left('Meeting cancelled: ' || v_m.title, 200),
         public.meeting_when(v_m.starts_at, v_m.ends_at)
           || case when array_length(v_ids, 1) > 1
                   then ' · and the next ' || (array_length(v_ids, 1) - 1) else '' end,
         'high', '/dashboard/communication/meetings?meeting=' || p_meeting
    from public.meeting_participants mp
   where mp.meeting_id = p_meeting and mp.user_id <> v_me;

  return array_length(v_ids, 1);
end;
$$;
revoke all on function public.meeting_cancel(uuid, text) from public, anon;
grant execute on function public.meeting_cancel(uuid, text) to authenticated;

-- ── 8. Answer ────────────────────────────────────────────────────────────────
-- 'one' answers this occurrence; 'following' this and the later ones of the series the
-- person is invited to (what Accept on a series invite means). The creator hears once.
create or replace function public.meeting_respond(p_meeting uuid, p_response text, p_scope text default 'one')
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_me    uuid := auth.uid();
  v_m     public.meetings%rowtype;
  v_n     integer;
begin
  if v_me is null then
    raise exception 'Sign in to answer' using errcode = '42501';
  end if;
  if p_response not in ('accepted', 'declined') then
    raise exception 'Answer accepted or declined' using errcode = '22023';
  end if;
  select * into v_m from public.meetings where id = p_meeting;
  if not found or not public.meeting_is_participant(p_meeting, v_me) then
    raise exception 'You are not invited to this meeting' using errcode = '42501';
  end if;
  if v_m.cancelled_at is not null then
    raise exception 'This meeting is cancelled' using errcode = '22023';
  end if;

  update public.meeting_participants mp
     set response = p_response, responded_at = now()
    from public.meetings m
   where mp.meeting_id = m.id
     and mp.user_id = v_me
     and m.cancelled_at is null
     and case when coalesce(p_scope, 'one') = 'following'
              then m.series_id = v_m.series_id and m.starts_at >= v_m.starts_at
              else m.id = p_meeting end
     and mp.response is distinct from p_response;
  get diagnostics v_n = row_count;

  if v_n > 0 and v_m.created_by <> v_me then
    insert into public.notifications (user_id, kind, meeting_id, title, body, priority, action_url)
    values (v_m.created_by, 'meeting_response', p_meeting,
            left(public.meeting_person_name(v_me) || ' ' || p_response || ' ' || v_m.title, 200),
            public.meeting_when(v_m.starts_at, v_m.ends_at)
              || case when v_n > 1 then ' · and the next ' || (v_n - 1) else '' end,
            'low', '/dashboard/communication/meetings?meeting=' || p_meeting);
  end if;
  return v_n;
end;
$$;
revoke all on function public.meeting_respond(uuid, text, text) from public, anon;
grant execute on function public.meeting_respond(uuid, text, text) to authenticated;

-- ── 9. The reminder, 15 minutes before ───────────────────────────────────────
-- Claim first, notify second, in one statement: the UPDATE takes the row lock, so a
-- second run waiting on it re-reads `reminder_sent_at` and skips. A meeting found late
-- (the job was off) is still reminded until it starts, never after.
create or replace function public.meeting_reminders_due(p_now timestamptz default now())
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_n integer;
begin
  with claimed as (
    update public.meeting_participants mp
       set reminder_sent_at = p_now
      from public.meetings m
     where mp.meeting_id = m.id
       and m.cancelled_at is null
       and m.starts_at > p_now
       and m.starts_at <= p_now + interval '15 minutes'
       and mp.response <> 'declined'
       and mp.reminder_sent_at is null
    returning mp.user_id, m.id, m.title, m.starts_at, m.ends_at, m.location
  )
  insert into public.notifications (user_id, kind, meeting_id, title, body, priority, action_url)
  select c.user_id, 'meeting_reminder', c.id,
         left('Starting soon: ' || c.title, 200),
         public.meeting_when(c.starts_at, c.ends_at) || coalesce(' · ' || c.location, ''),
         'high', '/dashboard/communication/meetings?meeting=' || c.id
    from claimed c
  on conflict (user_id, meeting_id) where kind = 'meeting_reminder' do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.meeting_reminders_due(timestamptz) from public, anon, authenticated;

-- cron.schedule with a name replaces the job of that name: a second paste adds nothing.
select cron.schedule('meeting-reminders', '* * * * *', 'select public.meeting_reminders_due();');

notify pgrst, 'reload schema';
