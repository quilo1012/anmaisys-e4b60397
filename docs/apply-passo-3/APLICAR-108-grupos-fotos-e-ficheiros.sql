-- ================================================================
-- BLOCO 108
-- 20261019160000_conversations_have_groups_photos_and_files.sql
-- ================================================================
--
-- MESSAGES GANHA GRUPOS, FOTOS E FICHEIROS: grupos de departamento e de equipa (turno),
-- criados so por supervisores e administradores, para os departamentos que gerem; foto
-- de perfil (bucket privado avatars, 2 MB); anexos (bucket privado chat-files, 10 MB,
-- imagens/PDF/Office/texto); o sino toca uma vez por grupo, sem o texto da mensagem.
-- As conversas privadas continuam em direct_messages, com as regras de sempre; o admin
-- NAO passa a ler mensagens privadas de ninguem.
-- Precisa dos BLOCOS 100 (notifications.kind) e 107. Nao reescreve linha nenhuma e nao
-- muda nenhuma politica existente. Pode colar-se duas vezes.
-- Teste depois: supabase/tests/chat_groups_and_files_test.sql (acaba em ALL TESTS PASSED, com ROLLBACK).
--
-- Conversations get groups, photos and files.
--
-- WHAT WAS THERE. Messages is one-to-one only: `direct_messages` (sender, recipient,
-- read_at), routed by role in `dm_insert_routing`, `dm_insert_reply` (BLOCO 103b) and
-- the employee's two doors, `message_my_supervisor` / `message_overtime_supervisor`
-- (BLOCO 107). A private conversation is the PAIR of logins, so there is no
-- conversation row that could be created twice — that stays. Nobody in the system has
-- a photo (no avatar column anywhere), the chat cannot carry a file
-- (`direct_messages.image_url` has no writer), and there are no groups.
--
-- WHAT THIS ADDS. Nothing here rewrites a row or changes an existing policy.
--   1. Profile photos: `profiles.avatar_path`, a PRIVATE `avatars` bucket (2 MB,
--      jpeg/png/webp, enforced by the bucket itself), written only under the owner's
--      own folder, set only through `set_avatar()` — a person sets their own; an admin
--      may set anybody's.
--   2. Department and team groups: `chat_groups`, `chat_group_members`,
--      `chat_group_messages`, and `chat_group_events` (who created, added, removed,
--      promoted, renamed — the audit trail of membership). Every write goes through a
--      SECURITY DEFINER function that checks the caller against the database:
--        * create / manage: `has_action(uid, 'chat.groups.manage', {admin, supervisor,
--          production_office_admin})` — so the Permissions screen governs it, and the
--          employee ceiling in `has_action` keeps employees out whatever it says;
--        * scope: an admin, any department; everybody else, only the departments they
--          run — their own record's department and those of the people whose
--          `manager_id` points at them. A supervisor adds only active people of that
--          department (and that crew, for a team group);
--        * only an admin makes or unmakes a group manager. Nobody promotes themselves.
--      Reading is for current members only. A removed member loses the whole history
--      (and gets it back if re-added); messages are never edited or deleted.
--   3. Files: a PRIVATE `chat-files` bucket (10 MB; images, PDF, Office, text/CSV,
--      enforced by the bucket) under `g/<group>/…` or `dm/<low uid>_<high uid>/…`.
--      Storage policies let only the group's members, or the two people of the pair,
--      read or upload there. `chat_attachments` records each file against its message;
--      the size and type recorded are the ones storage measured, not what the browser
--      said.
--   4. The bell: a group message rings each other member once — while a group's
--      notification is unread it is refreshed, not duplicated — and says who wrote in
--      which group, never what.
--   5. Realtime on the group tables and on attachments (a file is recorded just after
--      its message, so the screen hears about both). RLS applies to what each
--      subscriber receives.
--
-- Admins do NOT gain read access to anybody's private messages: `dm_select_own` is
-- untouched, and no function here returns a direct message that is not the caller's.

-- ── 0. Who runs which department ────────────────────────────────────────────
create or replace function public.chat_can_manage_groups(p_uid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.has_action(p_uid, 'chat.groups.manage',
                           array['admin', 'supervisor', 'production_office_admin']::app_role[]);
$$;
revoke all on function public.chat_can_manage_groups(uuid) from public, anon, authenticated;

create or replace function public.chat_is_admin(p_uid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.has_role(p_uid, 'admin'::app_role);
$$;
revoke all on function public.chat_is_admin(uuid) from public, anon, authenticated;

-- The departments a person runs: their own record's, and their reports'.
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
      join public.employees r on r.manager_id = me.id and r.active
     where me.user_id = p_uid and me.active
  ) x
  where d is not null and btrim(d) <> '';
$$;
revoke all on function public.chat_departments_of(uuid) from public, anon, authenticated;

create or replace function public.chat_runs_department(p_uid uuid, p_department text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.chat_can_manage_groups(p_uid)
     and (public.chat_is_admin(p_uid)
          or exists (select 1 from public.chat_departments_of(p_uid) d where d = p_department));
$$;
revoke all on function public.chat_runs_department(uuid, text) from public, anon, authenticated;

-- ── 1. Profile photos ───────────────────────────────────────────────────────
alter table public.profiles add column if not exists avatar_path text;
comment on column public.profiles.avatar_path is
  'Caminho no bucket PRIVADO avatars (<user_id>/<ficheiro>), nunca um URL. Assinar na leitura. '
  'So muda por set_avatar(). Ver 20261019160000.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- A path's first folder is the login it belongs to, or `groups/<id>` for a group photo.
create or replace function public.chat_may_write_avatar(p_name text)
returns boolean
language plpgsql stable security definer set search_path = public
as $$
declare
  v_parts text[] := string_to_array(coalesce(p_name, ''), '/');
  v_group uuid;
begin
  if auth.uid() is null or array_length(v_parts, 1) is null then return false; end if;
  if v_parts[1] = auth.uid()::text then return true; end if;
  if v_parts[1] = 'groups' and array_length(v_parts, 1) >= 3 then
    begin v_group := v_parts[2]::uuid; exception when others then return false; end;
    return public.chat_manages_group(auth.uid(), v_group);
  end if;
  -- An admin may put a photo in anybody's folder (and then set it with set_avatar).
  return public.chat_is_admin(auth.uid())
     and v_parts[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
end;
$$;

-- ── 2. Groups ───────────────────────────────────────────────────────────────
create table if not exists public.chat_groups (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('department', 'team')),
  name        text not null check (length(btrim(name)) between 2 and 80),
  description text check (description is null or length(description) <= 500),
  department  text not null check (length(btrim(department)) > 0),
  -- The crew (`employees.shift_group`) a team group is for; only a team group has one.
  team        text,
  avatar_path text,
  created_by  uuid not null references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint chat_groups_team_only_for_teams check ((kind = 'team') = (team is not null))
);

create table if not exists public.chat_group_members (
  group_id     uuid not null references public.chat_groups(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         text not null default 'member' check (role in ('manager', 'member')),
  added_by     uuid references auth.users(id),
  -- clock_timestamp, not now(): unread is "after I last read", and a transaction's
  -- now() is one instant for everything in it.
  joined_at    timestamptz not null default clock_timestamp(),
  -- Removal keeps the row (who, when, by whom); `left_at` set = no access at all.
  left_at      timestamptz,
  removed_by   uuid references auth.users(id),
  last_read_at timestamptz,
  primary key (group_id, user_id)
);
create index if not exists chat_group_members_user_idx
  on public.chat_group_members (user_id) where left_at is null;

create table if not exists public.chat_group_messages (
  -- The client chooses the id, so a retried send is the same message, not a second one.
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.chat_groups(id) on delete cascade,
  sender_id   uuid not null references auth.users(id),
  body        text not null check (length(body) <= 4000),
  reply_to_id uuid references public.chat_group_messages(id) on delete set null,
  created_at  timestamptz not null default clock_timestamp()
);
create index if not exists chat_group_messages_group_time_idx
  on public.chat_group_messages (group_id, created_at desc, id desc);

create table if not exists public.chat_group_events (
  id             uuid primary key default gen_random_uuid(),
  group_id       uuid not null references public.chat_groups(id) on delete cascade,
  actor_id       uuid references auth.users(id),
  action         text not null check (action in ('created', 'member_added', 'member_removed',
                                                 'role_changed', 'details_changed')),
  target_user_id uuid references auth.users(id),
  detail         jsonb,
  at             timestamptz not null default now()
);
create index if not exists chat_group_events_group_idx on public.chat_group_events (group_id, at desc);

create or replace function public.chat_is_member(p_uid uuid, p_group uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.chat_group_members m
                  where m.group_id = p_group and m.user_id = p_uid and m.left_at is null);
$$;
revoke all on function public.chat_is_member(uuid, uuid) from public, anon, authenticated;

-- The policies' question, only ever about whoever asks: nobody can use it to learn
-- who else is in a group.
create or replace function public.chat_i_am_in(p_group uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.chat_is_member(auth.uid(), p_group);
$$;
revoke all on function public.chat_i_am_in(uuid) from public, anon;
grant execute on function public.chat_i_am_in(uuid) to authenticated;

-- Manages a group: an admin, or a current member holding the manager role.
create or replace function public.chat_manages_group(p_uid uuid, p_group uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.chat_is_admin(p_uid)
      or exists (select 1 from public.chat_group_members m
                  where m.group_id = p_group and m.user_id = p_uid
                    and m.left_at is null and m.role = 'manager');
$$;
revoke all on function public.chat_manages_group(uuid, uuid) from public, anon, authenticated;
revoke all on function public.chat_may_write_avatar(text) from public, anon;
grant execute on function public.chat_may_write_avatar(text) to authenticated;

alter table public.chat_groups         enable row level security;
alter table public.chat_group_members  enable row level security;
alter table public.chat_group_messages enable row level security;
alter table public.chat_group_events   enable row level security;

-- Reading only. Every write is a function below; no INSERT/UPDATE/DELETE policy exists.
drop policy if exists "chat_groups_members_read" on public.chat_groups;
create policy "chat_groups_members_read" on public.chat_groups
  for select to authenticated using (public.chat_i_am_in(id));

drop policy if exists "chat_group_members_members_read" on public.chat_group_members;
create policy "chat_group_members_members_read" on public.chat_group_members
  for select to authenticated using (public.chat_i_am_in(group_id));

drop policy if exists "chat_group_messages_members_read" on public.chat_group_messages;
create policy "chat_group_messages_members_read" on public.chat_group_messages
  for select to authenticated using (public.chat_i_am_in(group_id));

drop policy if exists "chat_group_events_members_read" on public.chat_group_events;
create policy "chat_group_events_members_read" on public.chat_group_events
  for select to authenticated using (public.chat_i_am_in(group_id));

revoke all on public.chat_groups, public.chat_group_members, public.chat_group_messages,
              public.chat_group_events from anon;
revoke insert, update, delete on public.chat_groups, public.chat_group_members,
              public.chat_group_messages, public.chat_group_events from authenticated;
grant select on public.chat_groups, public.chat_group_members, public.chat_group_messages,
              public.chat_group_events to authenticated;

-- Who a supervisor may put in a group of this department (and crew).
create or replace function public.chat_eligible_for(p_uid uuid, p_department text, p_team text, p_member uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select case
    when public.chat_is_admin(p_uid) then
      exists (select 1 from public.profiles p where p.id = p_member and coalesce(p.active, true))
    else
      p_member = p_uid
      or exists (select 1 from public.employees e
                  where e.user_id = p_member and e.active
                    and e.department = p_department
                    and (p_team is null or e.shift_group = p_team))
  end;
$$;
revoke all on function public.chat_eligible_for(uuid, text, text, uuid) from public, anon, authenticated;

-- What the "New group" form offers: the departments this person runs, with their crews.
create or replace function public.chat_my_group_scope()
returns table (department text, teams text[])
language sql stable security definer set search_path = public
as $$
  with mine as (
    select d from public.chat_departments_of(auth.uid()) d
    where public.chat_can_manage_groups(auth.uid())
    union
    select distinct e.department from public.employees e
     where public.chat_is_admin(auth.uid()) and e.active
       and e.department is not null and btrim(e.department) <> ''
  )
  select m.d,
         coalesce(array(select distinct e.shift_group from public.employees e
                         where e.active and e.department = m.d and e.shift_group is not null
                         order by 1), '{}')
    from mine m
   order by 1;
$$;
revoke all on function public.chat_my_group_scope() from public, anon;
grant execute on function public.chat_my_group_scope() to authenticated;

-- The people the form offers for a department (and crew).
create or replace function public.chat_eligible_members(p_department text, p_team text default null)
returns table (user_id uuid, name text, avatar_path text, job text)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.chat_runs_department(auth.uid(), p_department) then
    raise exception 'You do not run this department' using errcode = '42501';
  end if;
  return query
    select distinct on (e.user_id) e.user_id, e.full_name, p.avatar_path, e.position
      from public.employees e
      left join public.profiles p on p.id = e.user_id
     where e.active and e.user_id is not null and e.user_id <> auth.uid()
       and e.department = p_department
       and (p_team is null or e.shift_group = p_team)
     order by e.user_id, e.full_name;
end;
$$;
revoke all on function public.chat_eligible_members(text, text) from public, anon;
grant execute on function public.chat_eligible_members(text, text) to authenticated;

create or replace function public.chat_create_group(
  p_kind text, p_name text, p_department text, p_team text default null,
  p_description text default null, p_members uuid[] default '{}'
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_me    uuid := auth.uid();
  v_id    uuid;
  v_team  text := nullif(btrim(coalesce(p_team, '')), '');
  v_m     uuid;
begin
  if v_me is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if not public.chat_can_manage_groups(v_me) then
    raise exception 'Only supervisors and administrators create groups' using errcode = '42501';
  end if;
  if p_kind not in ('department', 'team') then
    raise exception 'A group is for a department or a team' using errcode = 'P0001';
  end if;
  if not public.chat_runs_department(v_me, p_department) then
    raise exception 'You can only create groups for a department you run' using errcode = '42501';
  end if;
  if p_kind = 'team' and v_team is null then
    raise exception 'Choose the crew this team group is for' using errcode = 'P0001';
  end if;
  if p_kind = 'department' then v_team := null; end if;

  insert into public.chat_groups (kind, name, description, department, team, created_by)
  values (p_kind, btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''), p_department, v_team, v_me)
  returning id into v_id;

  insert into public.chat_group_members (group_id, user_id, role, added_by)
  values (v_id, v_me, 'manager', v_me);
  insert into public.chat_group_events (group_id, actor_id, action, detail)
  values (v_id, v_me, 'created', jsonb_build_object('name', btrim(p_name), 'kind', p_kind,
                                                   'department', p_department, 'team', v_team));

  foreach v_m in array coalesce(p_members, '{}') loop
    if v_m = v_me then continue; end if;
    if not public.chat_eligible_for(v_me, p_department, v_team, v_m) then
      raise exception 'Somebody chosen is not in this department or crew' using errcode = '42501';
    end if;
    insert into public.chat_group_members (group_id, user_id, role, added_by)
    values (v_id, v_m, 'member', v_me)
    on conflict (group_id, user_id) do nothing;
    insert into public.chat_group_events (group_id, actor_id, action, target_user_id)
    values (v_id, v_me, 'member_added', v_m);
  end loop;
  return v_id;
end;
$$;
revoke all on function public.chat_create_group(text, text, text, text, text, uuid[]) from public, anon;
grant execute on function public.chat_create_group(text, text, text, text, text, uuid[]) to authenticated;

create or replace function public.chat_add_members(p_group uuid, p_members uuid[])
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_me  uuid := auth.uid();
  v_g   public.chat_groups;
  v_m   uuid;
  v_n   integer := 0;
begin
  select * into v_g from public.chat_groups where id = p_group;
  if v_g.id is null or not public.chat_manages_group(v_me, p_group) then
    raise exception 'Only this group''s managers change who is in it' using errcode = '42501';
  end if;
  foreach v_m in array coalesce(p_members, '{}') loop
    if not public.chat_eligible_for(v_me, v_g.department, v_g.team, v_m) then
      raise exception 'Somebody chosen is not in this department or crew' using errcode = '42501';
    end if;
    insert into public.chat_group_members (group_id, user_id, role, added_by)
    values (p_group, v_m, 'member', v_me)
    on conflict (group_id, user_id) do update
      set left_at = null, removed_by = null, joined_at = clock_timestamp(), added_by = v_me, role = 'member'
      where public.chat_group_members.left_at is not null;
    if found then
      v_n := v_n + 1;
      insert into public.chat_group_events (group_id, actor_id, action, target_user_id)
      values (p_group, v_me, 'member_added', v_m);
    end if;
  end loop;
  update public.chat_groups set updated_at = now() where id = p_group;
  return v_n;
end;
$$;
revoke all on function public.chat_add_members(uuid, uuid[]) from public, anon;
grant execute on function public.chat_add_members(uuid, uuid[]) to authenticated;

create or replace function public.chat_remove_member(p_group uuid, p_user uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_me   uuid := auth.uid();
  v_role text;
begin
  if not public.chat_manages_group(v_me, p_group) then
    raise exception 'Only this group''s managers change who is in it' using errcode = '42501';
  end if;
  select role into v_role from public.chat_group_members
   where group_id = p_group and user_id = p_user and left_at is null;
  if v_role is null then return; end if;
  -- A manager is removed by an admin only, so one supervisor cannot push out another.
  if v_role = 'manager' and not public.chat_is_admin(v_me) then
    raise exception 'Only an administrator removes a group manager' using errcode = '42501';
  end if;
  update public.chat_group_members set left_at = clock_timestamp(), removed_by = v_me
   where group_id = p_group and user_id = p_user and left_at is null;
  insert into public.chat_group_events (group_id, actor_id, action, target_user_id)
  values (p_group, v_me, 'member_removed', p_user);
end;
$$;
revoke all on function public.chat_remove_member(uuid, uuid) from public, anon;
grant execute on function public.chat_remove_member(uuid, uuid) to authenticated;

create or replace function public.chat_set_member_role(p_group uuid, p_user uuid, p_role text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.chat_is_admin(auth.uid()) then
    raise exception 'Only an administrator names group managers' using errcode = '42501';
  end if;
  if p_role not in ('manager', 'member') then
    raise exception 'A member is a manager or a member' using errcode = 'P0001';
  end if;
  update public.chat_group_members set role = p_role
   where group_id = p_group and user_id = p_user and left_at is null and role <> p_role;
  if found then
    insert into public.chat_group_events (group_id, actor_id, action, target_user_id, detail)
    values (p_group, auth.uid(), 'role_changed', p_user, jsonb_build_object('role', p_role));
  end if;
end;
$$;
revoke all on function public.chat_set_member_role(uuid, uuid, text) from public, anon;
grant execute on function public.chat_set_member_role(uuid, uuid, text) to authenticated;

create or replace function public.chat_update_group(
  p_group uuid, p_name text, p_description text, p_avatar_path text
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.chat_manages_group(auth.uid(), p_group) then
    raise exception 'Only this group''s managers change it' using errcode = '42501';
  end if;
  if p_avatar_path is not null and p_avatar_path not like 'groups/' || p_group::text || '/%' then
    raise exception 'That photo is not this group''s' using errcode = '42501';
  end if;
  update public.chat_groups
     set name = btrim(p_name),
         description = nullif(btrim(coalesce(p_description, '')), ''),
         avatar_path = p_avatar_path,
         updated_at = now()
   where id = p_group;
  insert into public.chat_group_events (group_id, actor_id, action, detail)
  values (p_group, auth.uid(), 'details_changed', jsonb_build_object('name', btrim(p_name)));
end;
$$;
revoke all on function public.chat_update_group(uuid, text, text, text) from public, anon;
grant execute on function public.chat_update_group(uuid, text, text, text) to authenticated;

-- ── 3. Files ────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-files', 'chat-files', false, 10485760, array[
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'application/pdf', 'text/plain', 'text/csv',
  'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'
])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- `g/<group>/…`: the group's current members. `dm/<a>_<b>/…`: the two of the pair.
create or replace function public.chat_may_use_file(p_name text)
returns boolean
language plpgsql stable security definer set search_path = public
as $$
declare
  v_parts text[] := string_to_array(coalesce(p_name, ''), '/');
  v_group uuid;
  v_pair  text[];
begin
  if auth.uid() is null or coalesce(array_length(v_parts, 1), 0) < 3 then return false; end if;
  if v_parts[1] = 'g' then
    begin v_group := v_parts[2]::uuid; exception when others then return false; end;
    return public.chat_is_member(auth.uid(), v_group);
  elsif v_parts[1] = 'dm' then
    v_pair := string_to_array(v_parts[2], '_');
    if coalesce(array_length(v_pair, 1), 0) <> 2 then return false; end if;
    begin
      -- The same order as `least`/`greatest` on uuid, whatever the collation.
      if v_pair[1]::uuid >= v_pair[2]::uuid then return false; end if;
    exception when others then return false; end;
    return auth.uid() in (v_pair[1]::uuid, v_pair[2]::uuid);
  end if;
  return false;
end;
$$;
revoke all on function public.chat_may_use_file(text) from public, anon;
grant execute on function public.chat_may_use_file(text) to authenticated;

drop policy if exists "chat-files read in conversation" on storage.objects;
create policy "chat-files read in conversation" on storage.objects
  for select to authenticated
  using (bucket_id = 'chat-files' and public.chat_may_use_file(name));

drop policy if exists "chat-files upload in conversation" on storage.objects;
create policy "chat-files upload in conversation" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'chat-files' and owner = auth.uid() and public.chat_may_use_file(name));

drop policy if exists "avatars read signed in" on storage.objects;
create policy "avatars read signed in" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars');

drop policy if exists "avatars write own" on storage.objects;
create policy "avatars write own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and public.chat_may_write_avatar(name));

drop policy if exists "avatars replace own" on storage.objects;
create policy "avatars replace own" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and public.chat_may_write_avatar(name))
  with check (bucket_id = 'avatars' and public.chat_may_write_avatar(name));

drop policy if exists "avatars delete own" on storage.objects;
create policy "avatars delete own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and public.chat_may_write_avatar(name));

create table if not exists public.chat_attachments (
  id                uuid primary key default gen_random_uuid(),
  group_message_id  uuid references public.chat_group_messages(id) on delete cascade,
  direct_message_id uuid references public.direct_messages(id) on delete cascade,
  storage_path      text not null unique,
  file_name         text not null check (length(file_name) between 1 and 200),
  content_type      text not null,
  size_bytes        bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  uploaded_by       uuid not null references auth.users(id),
  created_at        timestamptz not null default now(),
  constraint chat_attachments_one_message check (num_nonnulls(group_message_id, direct_message_id) = 1)
);
create index if not exists chat_attachments_group_msg_idx on public.chat_attachments (group_message_id);
create index if not exists chat_attachments_dm_idx on public.chat_attachments (direct_message_id);

alter table public.chat_attachments enable row level security;
drop policy if exists "chat_attachments_read_in_conversation" on public.chat_attachments;
create policy "chat_attachments_read_in_conversation" on public.chat_attachments
  for select to authenticated
  using (public.chat_may_use_file(storage_path));
revoke all on public.chat_attachments from anon;
revoke insert, update, delete on public.chat_attachments from authenticated;
grant select on public.chat_attachments to authenticated;

-- Records the files of a message the caller just sent. Each file must already be in
-- storage, uploaded by the caller, inside that message's conversation folder; the
-- size and type are read from storage, so the browser's word is never the record.
create or replace function public.chat_record_attachments(
  p_group_message uuid, p_direct_message uuid, p_files jsonb
)
returns integer
language plpgsql security definer set search_path = public, storage
as $$
declare
  v_me     uuid := auth.uid();
  v_prefix text;
  v_sender uuid;
  v_at     timestamptz;
  v_f      jsonb;
  v_obj    storage.objects;
  v_n      integer := 0;
  v_dm     public.direct_messages;
begin
  if num_nonnulls(p_group_message, p_direct_message) <> 1 then
    raise exception 'Name one message' using errcode = 'P0001';
  end if;
  if jsonb_typeof(coalesce(p_files, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_files, '[]'::jsonb)) > 5 then
    raise exception 'Up to 5 files per message' using errcode = 'P0001';
  end if;
  if p_group_message is not null then
    select sender_id, created_at, 'g/' || group_id::text || '/' into v_sender, v_at, v_prefix
      from public.chat_group_messages where id = p_group_message;
  else
    select * into v_dm from public.direct_messages where id = p_direct_message;
    v_sender := v_dm.sender_id; v_at := v_dm.created_at;
    v_prefix := 'dm/' || least(v_dm.sender_id, v_dm.recipient_id)::text || '_'
                      || greatest(v_dm.sender_id, v_dm.recipient_id)::text || '/';
  end if;
  if v_sender is null or v_sender <> v_me then
    raise exception 'Only the sender adds files to a message' using errcode = '42501';
  end if;
  if v_at < now() - interval '15 minutes' then
    raise exception 'Files are added when the message is sent' using errcode = 'P0001';
  end if;

  for v_f in select * from jsonb_array_elements(coalesce(p_files, '[]'::jsonb)) loop
    if (v_f->>'path') not like v_prefix || '%' then
      raise exception 'A file is not in this conversation' using errcode = '42501';
    end if;
    select * into v_obj from storage.objects
     where bucket_id = 'chat-files' and name = v_f->>'path' and owner = v_me;
    if v_obj.id is null then
      raise exception 'A file did not finish uploading' using errcode = 'P0001';
    end if;
    insert into public.chat_attachments
      (group_message_id, direct_message_id, storage_path, file_name, content_type, size_bytes, uploaded_by)
    values (p_group_message, p_direct_message, v_obj.name,
            left(coalesce(nullif(btrim(v_f->>'name'), ''), regexp_replace(v_obj.name, '^.*/', '')), 200),
            coalesce(v_obj.metadata->>'mimetype', 'application/octet-stream'),
            coalesce((v_obj.metadata->>'size')::bigint, 1), v_me)
    on conflict (storage_path) do nothing;
    if found then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.chat_record_attachments(uuid, uuid, jsonb) from public, anon;
grant execute on function public.chat_record_attachments(uuid, uuid, jsonb) to authenticated;

-- ── Sending and reading a group ─────────────────────────────────────────────
create or replace function public.chat_send_group_message(
  p_id uuid, p_group uuid, p_body text, p_reply_to uuid default null, p_files jsonb default '[]'
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_me   uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_old  public.chat_group_messages;
begin
  if not public.chat_is_member(v_me, p_group) then
    raise exception 'You are not in this group' using errcode = '42501';
  end if;
  -- A retry of a message already written is that message.
  select * into v_old from public.chat_group_messages where id = p_id;
  if v_old.id is not null then
    if v_old.sender_id <> v_me or v_old.group_id <> p_group then
      raise exception 'That message id is taken' using errcode = '42501';
    end if;
    perform public.chat_record_attachments(p_id, null, p_files);
    return p_id;
  end if;
  if length(v_body) = 0 and jsonb_array_length(coalesce(p_files, '[]'::jsonb)) = 0 then
    raise exception 'Write a message first' using errcode = 'P0001';
  end if;
  if length(v_body) > 4000 then
    raise exception 'Keep it under 4000 characters' using errcode = 'P0001';
  end if;
  if p_reply_to is not null
     and not exists (select 1 from public.chat_group_messages where id = p_reply_to and group_id = p_group) then
    raise exception 'That reply is to a message in another conversation' using errcode = 'P0001';
  end if;

  insert into public.chat_group_messages (id, group_id, sender_id, body, reply_to_id)
  values (coalesce(p_id, gen_random_uuid()), p_group, v_me, v_body, p_reply_to)
  returning id into p_id;
  perform public.chat_record_attachments(p_id, null, p_files);
  update public.chat_group_members set last_read_at = clock_timestamp()
   where group_id = p_group and user_id = v_me;
  return p_id;
end;
$$;
revoke all on function public.chat_send_group_message(uuid, uuid, text, uuid, jsonb) from public, anon;
grant execute on function public.chat_send_group_message(uuid, uuid, text, uuid, jsonb) to authenticated;

create or replace function public.chat_mark_group_read(p_group uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.chat_group_members set last_read_at = clock_timestamp()
   where group_id = p_group and user_id = auth.uid() and left_at is null;
  update public.notifications set read_at = now()
   where user_id = auth.uid() and kind = 'chat_group' and read_at is null
     and action_url = '/dashboard/messages?group=' || p_group::text;
end;
$$;
revoke all on function public.chat_mark_group_read(uuid) from public, anon;
grant execute on function public.chat_mark_group_read(uuid) to authenticated;

-- The sidebar: each of my groups, its last message and how many I have not read.
create or replace function public.chat_my_groups()
returns table (
  id uuid, kind text, name text, description text, department text, team text,
  avatar_path text, my_role text, member_count integer,
  last_at timestamptz, last_sender_name text, last_body text, last_has_files boolean, unread integer
)
language sql stable security definer set search_path = public
as $$
  select g.id, g.kind, g.name, g.description, g.department, g.team, g.avatar_path, me.role,
         (select count(*)::int from public.chat_group_members x where x.group_id = g.id and x.left_at is null),
         lm.created_at, lp.name, left(lm.body, 140),
         exists (select 1 from public.chat_attachments a where a.group_message_id = lm.id),
         (select count(*)::int from public.chat_group_messages u
           where u.group_id = g.id and u.sender_id <> auth.uid()
             and u.created_at > coalesce(me.last_read_at, me.joined_at))
    from public.chat_group_members me
    join public.chat_groups g on g.id = me.group_id
    left join lateral (select * from public.chat_group_messages m where m.group_id = g.id
                        order by m.created_at desc, m.id desc limit 1) lm on true
    left join public.profiles lp on lp.id = lm.sender_id
   where me.user_id = auth.uid() and me.left_at is null
   order by coalesce(lm.created_at, g.created_at) desc;
$$;
revoke all on function public.chat_my_groups() from public, anon;
grant execute on function public.chat_my_groups() to authenticated;

-- The people of a group I am in.
create or replace function public.chat_group_people(p_group uuid)
returns table (user_id uuid, name text, avatar_path text, role text, job text, joined_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.chat_is_member(auth.uid(), p_group) and not public.chat_is_admin(auth.uid()) then
    raise exception 'You are not in this group' using errcode = '42501';
  end if;
  return query
    select m.user_id, coalesce(e.full_name, nullif(p.name, ''), p.email, 'User'), p.avatar_path, m.role,
           e.position, m.joined_at
      from public.chat_group_members m
      left join public.profiles p on p.id = m.user_id
      left join lateral (select full_name, position from public.employees
                          where user_id = m.user_id and active limit 1) e on true
     where m.group_id = p_group and m.left_at is null
     order by (m.role = 'manager') desc, 2;
end;
$$;
revoke all on function public.chat_group_people(uuid) from public, anon;
grant execute on function public.chat_group_people(uuid) to authenticated;

-- ── Private conversations: one summary row per person I have written with ─────
-- Runs as the caller, so RLS (`dm_select_own`) decides what it can see.
create or replace function public.chat_my_dm_summaries()
returns table (partner_id uuid, last_at timestamptz, last_body text, last_from_me boolean,
               last_has_audio boolean, unread integer)
language sql stable security invoker set search_path = public
as $$
  with mine as (
    select d.*, case when d.sender_id = auth.uid() then d.recipient_id else d.sender_id end as partner
      from public.direct_messages d
     where d.sender_id = auth.uid() or d.recipient_id = auth.uid()
  ), last as (
    select distinct on (partner) partner, created_at, message, sender_id, audio_url
      from mine order by partner, created_at desc, id desc
  )
  select l.partner, l.created_at, left(l.message, 140), l.sender_id = auth.uid(), l.audio_url is not null,
         (select count(*)::int from mine u
           where u.partner = l.partner and u.recipient_id = auth.uid() and u.read_at is null)
    from last l;
$$;
revoke all on function public.chat_my_dm_summaries() from public, anon;
grant execute on function public.chat_my_dm_summaries() to authenticated;

-- Names, photos and job titles of the people on screen.
create or replace function public.chat_people(p_ids uuid[])
returns table (user_id uuid, name text, avatar_path text, job text)
language sql stable security definer set search_path = public
as $$
  select p.id, coalesce(e.full_name, nullif(p.name, ''), p.email, 'User'), p.avatar_path, e.position
    from public.profiles p
    left join lateral (select full_name, position from public.employees
                        where user_id = p.id and active limit 1) e on true
   where auth.uid() is not null
     and p.id = any (p_ids[1:300]);
$$;
revoke all on function public.chat_people(uuid[]) from public, anon;
grant execute on function public.chat_people(uuid[]) to authenticated;

-- ── Photos are set here, nowhere else ───────────────────────────────────────
create or replace function public.set_avatar(p_path text, p_user uuid default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_for uuid := coalesce(p_user, auth.uid());
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if v_for <> auth.uid() and not public.chat_is_admin(auth.uid()) then
    raise exception 'You can only change your own photo' using errcode = '42501';
  end if;
  if p_path is not null and p_path not like v_for::text || '/%' then
    raise exception 'That photo is not in this person''s folder' using errcode = '42501';
  end if;
  perform set_config('app.avatar_change', 'on', true);
  update public.profiles set avatar_path = p_path where id = v_for;
  perform set_config('app.avatar_change', '', true);
end;
$$;
revoke all on function public.set_avatar(text, uuid) from public, anon;
grant execute on function public.set_avatar(text, uuid) to authenticated;

create or replace function public.profiles_avatar_only_via_set_avatar()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if new.avatar_path is distinct from old.avatar_path
     and coalesce(current_setting('app.avatar_change', true), '') <> 'on' then
    raise exception 'A photo is changed with set_avatar()' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_avatar_only_via_set_avatar_t on public.profiles;
create trigger profiles_avatar_only_via_set_avatar_t
  before update of avatar_path on public.profiles
  for each row execute function public.profiles_avatar_only_via_set_avatar();

-- ── 4. The bell for a group message ─────────────────────────────────────────
-- One unread row per person per group: a second message while the first is unread
-- refreshes that row instead of adding one. Who wrote and where; never what.
create or replace function public.chat_group_message_bell()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_group text;
  v_from  text;
  v_url   text := '/dashboard/messages?group=' || new.group_id::text;
  v_to    uuid;
begin
  begin
    select name into v_group from public.chat_groups where id = new.group_id;
    select coalesce(nullif(name, ''), 'Somebody') into v_from from public.profiles where id = new.sender_id;
    for v_to in
      select user_id from public.chat_group_members
       where group_id = new.group_id and left_at is null and user_id <> new.sender_id
    loop
      update public.notifications
         set title = 'New messages in ' || coalesce(v_group, 'a group'),
             body = coalesce(v_from, 'Somebody') || ' wrote',
             created_at = now()
       where user_id = v_to and kind = 'chat_group' and action_url = v_url and read_at is null;
      if not found then
        insert into public.notifications (user_id, kind, title, body, priority, action_url)
        values (v_to, 'chat_group', 'New message in ' || coalesce(v_group, 'a group'),
                coalesce(v_from, 'Somebody') || ' wrote', 'medium', v_url);
      end if;
    end loop;
  exception when others then
    -- The message is the record; the bell is a courtesy. Never undo it for the bell.
    raise warning 'chat_group_message_bell(%): %', new.id, sqlerrm;
  end;
  return null;
end;
$$;
revoke all on function public.chat_group_message_bell() from public, anon, authenticated;

drop trigger if exists chat_group_message_bell_t on public.chat_group_messages;
create trigger chat_group_message_bell_t
  after insert on public.chat_group_messages
  for each row execute function public.chat_group_message_bell();

-- ── 5. Realtime ─────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'No supabase_realtime publication here; nothing to do.';
    return;
  end if;
  foreach t in array array['chat_group_messages', 'chat_group_members', 'chat_attachments'] loop
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
