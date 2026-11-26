-- APLICAR 164 — Employee Announcements: comunicados por departamento e turno, com confirmação de leitura.
--
-- PT: Colar no SQL Editor do projeto AN Maintenance (Supabase), o ficheiro inteiro. É o
-- BLOCO 164 do APPLY-ALL-IN-ORDER.sql, byte a byte. As tabelas announcements e
-- announcement_reads JÁ EXISTEM na produção (criadas pelo agente do Lovable a 27/10, sem
-- migração, 0 linhas): este bloco escreve-as numa migração sem as mudar, acrescenta as
-- colunas rung_at, updated_at e updated_by, e cria/recria as funções: publicar (com
-- agendamento), editar, retirar, apagar, a lista do funcionário, a lista do gestor e o
-- relatório de leitura. Agenda o job announcements-ring-due (de 5 em 5 minutos). Não muda
-- dados existentes. Pode colar-se duas vezes. Depois correr VERIFY-164 (só lê) e, se quiser,
-- supabase/tests/employee_announcements_test.sql (faz ROLLBACK).
--
-- EN: Paste the whole file into the AN Maintenance SQL Editor; it is BLOCO 164. Writes down
-- the announcements back end that is already in production and finishes it (schedule, edit,
-- delete, read report). No existing data changes. Then run VERIFY-164.
--
-- ================================================================
-- BLOCO 164
-- 20261126120000_employee_announcements.sql
-- ================================================================
-- Employee Announcements. BLOCO 164.
--
-- WHERE THIS COMES FROM. On 27/10/2026 the Lovable agent built a "Company Updates" back end
-- straight into the old Lovable Cloud database: `announcements`, `announcement_reads`,
-- `notifications.announcement_id` and eleven functions. Only the generated types reached
-- this repository (commit d4771a38) — no migration and no screen. The 05/11 copy carried
-- all of it into AN Maintenance, where it sits with 0 rows. Nothing reads it.
--
-- This file does two things with it:
--   1. WRITES IT DOWN. Every object the screens use is created here, in the exact shape it
--      has in production, so a fresh database gets it too (see
--      aAppNaoLeNadaQueNaoEstejaNumaMigracao.test.ts). On production these statements
--      change nothing: CREATE … IF NOT EXISTS, CREATE OR REPLACE with the same body.
--   2. FINISHES IT for the Employee Announcements screens:
--      - scheduling: `publish_announcement` takes `p_publish_at`. A future time stores the
--        announcement and rings nobody; `announcements_ring_due()`, every 5 minutes by
--        pg_cron, rings it once it is due. `rung_at` is claimed by the same UPDATE that
--        decides, so two runs ring one person once; the unique index on the bell row is
--        the second lock.
--      - edit (`update_announcement`) and delete (`delete_announcement`).
--      - the read report (`announcement_read_report`), which also lists the targeted
--        employees WITHOUT an app login. They cannot read it, and the manager must see
--        that rather than a 100% that only counts the people who could.
--      - the employee's own list (`my_announcements`) and the manager's list with counts
--        (`announcements_manage_list`).
--
-- TARGETING uses what employees already carry: `employees.department` and
-- `employees.shift_group`, compared trimmed and case-blind. No department or shift table is
-- created or copied. Both empty = the whole company (every login that is not a shared line
-- tablet). One filled = everybody in that department, or on that shift. Both = that
-- department on that shift.
--
-- WHO PUBLISHES: `has_action(uid, 'announcements.publish', '{admin}')`, so the Permissions
-- screen is the one place to give it to a manager role. A non-admin may only publish to a
-- department they belong to or manage (`chat_departments_of`), and never to the whole
-- company. Edit, withdraw, delete and the report: the author or an admin.
--
-- WHO READS: only the people in the audience, only while it is live (published, not
-- withdrawn, not expired). The RLS policy and every function say the same thing through
-- `announcement_is_for`.
--
-- A READ is one row per person per announcement (primary key), and the acknowledgment time
-- is written once: pressing the button again keeps the first time.
--
-- DEPENDS ON: `has_role`, `has_action` (BLOCO 83), `chat_departments_of` (20261019160000),
-- `notifications` with `kind` and its push trigger (117), pg_cron.
-- Idempotent: it can be pasted twice.

-- ── 1. Tables (as they are in production) ──────────────────────────────────
create table if not exists public.announcements (
  id                   uuid primary key default gen_random_uuid(),
  title                text not null,
  body                 text not null default '',
  category             text not null default 'company',
  image_path           text,
  audience_department  text,
  audience_shift_group text,
  requires_ack         boolean not null default false,
  urgent               boolean not null default false,
  published_at         timestamptz not null default now(),
  expires_at           timestamptz,
  created_by           uuid not null references auth.users(id),
  withdrawn_at         timestamptz,
  withdrawn_by         uuid references auth.users(id),
  constraint announcements_body_check check (length(body) <= 4000),
  constraint announcements_category_check check (category = any (array['company', 'shifts', 'safety', 'recognition'])),
  constraint announcements_expires_after_publish check (expires_at is null or expires_at > published_at),
  constraint announcements_title_check check (length(btrim(title)) >= 1 and length(btrim(title)) <= 120)
);
create index if not exists announcements_published_idx on public.announcements (published_at desc);

create table if not exists public.announcement_reads (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  read_at         timestamptz not null default now(),
  acknowledged_at timestamptz,
  primary key (announcement_id, user_id)
);
create index if not exists announcement_reads_user_idx on public.announcement_reads (user_id);

alter table public.notifications
  add column if not exists announcement_id uuid references public.announcements(id) on delete cascade;
create unique index if not exists notifications_one_per_announcement
  on public.notifications (user_id, announcement_id) where announcement_id is not null;

-- ── 2. New columns ─────────────────────────────────────────────────────────
-- rung_at: when the bell went out. Null = not yet (scheduled, or due and waiting for cron).
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'announcements' and column_name = 'rung_at') then
    alter table public.announcements add column rung_at timestamptz;
    -- Anything published before this column existed rang when it was published.
    update public.announcements a set rung_at = a.published_at
     where exists (select 1 from public.notifications n where n.announcement_id = a.id);
  end if;
end $$;
alter table public.announcements add column if not exists updated_at timestamptz;
alter table public.announcements add column if not exists updated_by uuid references auth.users(id);

create index if not exists announcements_due_idx on public.announcements (published_at)
  where rung_at is null and withdrawn_at is null;

-- ── 3. Who is it for ───────────────────────────────────────────────────────
create or replace function public.announcement_audience_for(p_department text, p_shift_group text)
returns table(user_id uuid)
language sql stable security definer set search_path to 'public'
as $function$
  select distinct x.user_id from (
    -- The whole company: every login with a role that is not a shared line tablet,
    -- and every active employee with a login.
    select ur.user_id
      from public.user_roles ur
     where nullif(btrim(p_department), '') is null and nullif(btrim(p_shift_group), '') is null
       and ur.role <> 'operator'::app_role
    union
    select e.user_id
      from public.employees e
     where e.active and e.user_id is not null
       and (nullif(btrim(p_department), '') is null
            or lower(btrim(e.department)) = lower(btrim(p_department)))
       and (nullif(btrim(p_shift_group), '') is null
            or lower(btrim(e.shift_group)) = lower(btrim(p_shift_group)))
  ) x
  where x.user_id is not null;
$function$;
revoke all on function public.announcement_audience_for(text, text) from public, anon, authenticated;

create or replace function public.announcement_audience(p_id uuid)
returns table(user_id uuid)
language sql stable security definer set search_path to 'public'
as $function$
  select t.user_id
    from public.announcements a,
         lateral public.announcement_audience_for(a.audience_department, a.audience_shift_group) t
   where a.id = p_id;
$function$;
revoke all on function public.announcement_audience(uuid) from public, anon, authenticated;

create or replace function public.announcement_is_for(p_uid uuid, p_id uuid)
returns boolean
language sql stable security definer set search_path to 'public'
as $function$
  select exists (
    select 1 from public.announcements a
     where a.id = p_id
       and (a.created_by = p_uid
            or public.has_role(p_uid, 'admin'::app_role)
            or (a.withdrawn_at is null
                and a.published_at <= now()
                and (a.expires_at is null or a.expires_at > now())
                and exists (select 1 from public.announcement_audience(a.id) t where t.user_id = p_uid)))
  );
$function$;
revoke all on function public.announcement_is_for(uuid, uuid) from public, anon;
grant execute on function public.announcement_is_for(uuid, uuid) to authenticated;

create or replace function public.announcements_may_publish(p_uid uuid, p_department text)
returns boolean
language sql stable security definer set search_path to 'public'
as $function$
  select public.has_action(p_uid, 'announcements.publish', array['admin']::app_role[])
     and (public.has_role(p_uid, 'admin'::app_role)
          or (nullif(btrim(p_department), '') is not null
              and exists (select 1 from public.chat_departments_of(p_uid) d
                           where lower(d) = lower(btrim(p_department)))));
$function$;
revoke all on function public.announcements_may_publish(uuid, text) from public, anon;
grant execute on function public.announcements_may_publish(uuid, text) to authenticated;

-- The departments and shifts the form offers: the values employees actually carry.
create or replace function public.announcement_audience_options()
returns table(kind text, value text)
language sql stable security definer set search_path to 'public'
as $function$
  select distinct 'department'::text, btrim(e.department)
    from public.employees e
   where e.active and nullif(btrim(e.department), '') is not null
     and public.has_action(auth.uid(), 'announcements.publish', array['admin']::app_role[])
  union
  select distinct 'shift_group'::text, btrim(e.shift_group)
    from public.employees e
   where e.active and nullif(btrim(e.shift_group), '') is not null
     and public.has_action(auth.uid(), 'announcements.publish', array['admin']::app_role[])
  order by 1, 2;
$function$;
revoke all on function public.announcement_audience_options() from public, anon;
grant execute on function public.announcement_audience_options() to authenticated;

create or replace function public.announcement_audience_count(p_department text, p_shift_group text)
returns integer
language sql stable security definer set search_path to 'public'
as $function$
  select case when public.has_action(auth.uid(), 'announcements.publish', array['admin']::app_role[])
              then (select count(*)::integer from public.announcement_audience_for(p_department, p_shift_group)
                     where user_id <> auth.uid())
         end;
$function$;
revoke all on function public.announcement_audience_count(text, text) from public, anon;
grant execute on function public.announcement_audience_count(text, text) to authenticated;

-- The form's preview: how many will get it, and how many of the targeted employees have no
-- app login and so will not.
create or replace function public.announcement_audience_preview(p_department text, p_shift_group text)
returns table(with_login integer, without_login integer)
language sql stable security definer set search_path to 'public'
as $function$
  select (select count(*)::integer from public.announcement_audience_for(p_department, p_shift_group)
           where user_id <> auth.uid()),
         (select count(*)::integer from public.employees e
           where e.active and e.user_id is null
             and (nullif(btrim(p_department), '') is null or lower(btrim(e.department)) = lower(btrim(p_department)))
             and (nullif(btrim(p_shift_group), '') is null or lower(btrim(e.shift_group)) = lower(btrim(p_shift_group))))
   where public.has_action(auth.uid(), 'announcements.publish', array['admin']::app_role[]);
$function$;
revoke all on function public.announcement_audience_preview(text, text) from public, anon;
grant execute on function public.announcement_audience_preview(text, text) to authenticated;

-- ── 4. RLS ─────────────────────────────────────────────────────────────────
-- Reads only. Every write goes through a function below.
alter table public.announcements enable row level security;
alter table public.announcement_reads enable row level security;

drop policy if exists "announcements read when it is for me" on public.announcements;
create policy "announcements read when it is for me" on public.announcements
  for select to authenticated using (public.announcement_is_for(auth.uid(), id));

drop policy if exists "announcement_reads my own" on public.announcement_reads;
create policy "announcement_reads my own" on public.announcement_reads
  for select to authenticated using (user_id = auth.uid());

revoke all on public.announcements, public.announcement_reads from anon, public;
revoke all on public.announcements, public.announcement_reads from authenticated;
grant select on public.announcements, public.announcement_reads to authenticated;

-- ── 5. Ringing the bell ────────────────────────────────────────────────────
-- Rings one announcement if it is due and has not rung. Returns how many were rung.
-- Not callable by clients: publish, update and the cron call it.
create or replace function public.announcement_ring(p_id uuid)
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_a    public.announcements;
  v_rows integer;
begin
  update public.announcements
     set rung_at = now()
   where id = p_id
     and rung_at is null
     and withdrawn_at is null
     and published_at <= now()
     and (expires_at is null or expires_at > now())
  returning * into v_a;
  if v_a.id is null then return 0; end if;

  insert into public.notifications (user_id, kind, announcement_id, title, body, priority, action_url)
  select t.user_id, 'announcement', v_a.id,
         left(case when v_a.urgent then 'Urgent: ' else '' end || v_a.title, 200),
         left(coalesce(nullif(btrim(v_a.body), ''), 'Open Announcements to read it.'), 200),
         case when v_a.urgent then 'high' else 'medium' end,
         '/dashboard/updates?a=' || v_a.id
    from public.announcement_audience(v_a.id) t
   where t.user_id <> v_a.created_by
  on conflict (user_id, announcement_id) where announcement_id is not null do nothing;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$function$;
revoke all on function public.announcement_ring(uuid) from public, anon, authenticated;

create or replace function public.announcements_ring_due()
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_id    uuid;
  v_total integer := 0;
begin
  for v_id in
    select id from public.announcements
     where rung_at is null and withdrawn_at is null and published_at <= now()
       and (expires_at is null or expires_at > now())
     order by published_at
     limit 50
  loop
    v_total := v_total + public.announcement_ring(v_id);
  end loop;
  return v_total;
end;
$function$;
revoke all on function public.announcements_ring_due() from public, anon, authenticated;

create or replace function public.announcements_forget_expired()
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_rows integer;
begin
  delete from public.notifications n
   using public.announcements a
   where n.announcement_id = a.id
     and n.read_at is null
     and (a.withdrawn_at is not null or (a.expires_at is not null and a.expires_at <= now()));
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$function$;
revoke all on function public.announcements_forget_expired() from public, anon, authenticated;

-- ── 6. Publish, edit, withdraw, delete ─────────────────────────────────────
-- Shared checks for publish and update. Raises with a message the form can show.
create or replace function public.announcement_check_fields(p_title text, p_body text, p_publish_at timestamptz, p_expires_at timestamptz)
returns void
language plpgsql immutable set search_path to 'public'
as $function$
begin
  if length(btrim(coalesce(p_title, ''))) = 0 then
    raise exception 'Give the announcement a title' using errcode = 'P0001';
  end if;
  if length(btrim(p_title)) > 120 then
    raise exception 'The title can be at most 120 characters' using errcode = 'P0001';
  end if;
  if length(btrim(coalesce(p_body, ''))) = 0 then
    raise exception 'Write the message' using errcode = 'P0001';
  end if;
  if length(p_body) > 4000 then
    raise exception 'The message can be at most 4000 characters' using errcode = 'P0001';
  end if;
  if p_expires_at is not null and p_expires_at <= p_publish_at then
    raise exception 'The end date must be after the publish date' using errcode = 'P0001';
  end if;
end;
$function$;
revoke all on function public.announcement_check_fields(text, text, timestamptz, timestamptz) from public, anon, authenticated;

-- The old nine-argument form (no schedule) goes; nothing calls it.
drop function if exists public.publish_announcement(text, text, text, text, text, boolean, boolean, timestamptz, text);

create or replace function public.publish_announcement(
  p_title text, p_body text, p_category text default 'company',
  p_department text default null, p_shift_group text default null,
  p_requires_ack boolean default true, p_urgent boolean default false,
  p_expires_at timestamptz default null, p_image_path text default null,
  p_publish_at timestamptz default null)
returns uuid
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_uid  uuid := auth.uid();
  v_dept text := nullif(btrim(p_department), '');
  v_crew text := nullif(btrim(p_shift_group), '');
  v_img  text := nullif(btrim(p_image_path), '');
  -- A time already past is "now": the form's clock and the database's disagree by seconds.
  v_at   timestamptz := greatest(coalesce(p_publish_at, now()), now());
  v_id   uuid;
begin
  if v_uid is null then
    raise exception 'Sign in first' using errcode = '28000';
  end if;
  if not public.announcements_may_publish(v_uid, v_dept) then
    raise exception 'You cannot publish an announcement to this audience' using errcode = '42501';
  end if;
  perform public.announcement_check_fields(p_title, p_body, v_at, p_expires_at);
  if v_img is not null and split_part(v_img, '/', 1) <> v_uid::text then
    raise exception 'That photo was not uploaded by you' using errcode = '42501';
  end if;

  insert into public.announcements (title, body, category, image_path, audience_department,
                                    audience_shift_group, requires_ack, urgent, published_at,
                                    expires_at, created_by)
  values (btrim(p_title), btrim(p_body), coalesce(nullif(p_category, ''), 'company'), v_img,
          v_dept, v_crew, coalesce(p_requires_ack, true), coalesce(p_urgent, false), v_at,
          p_expires_at, v_uid)
  returning id into v_id;

  -- Rings now if it is for now; a scheduled one waits for announcements_ring_due.
  perform public.announcement_ring(v_id);
  return v_id;
end;
$function$;
revoke all on function public.publish_announcement(text, text, text, text, text, boolean, boolean, timestamptz, text, timestamptz) from public, anon;
grant execute on function public.publish_announcement(text, text, text, text, text, boolean, boolean, timestamptz, text, timestamptz) to authenticated;

-- Edit. Before it goes out everything can change. After, only the words, the flags and the
-- end date: the people it already reached cannot be un-reached, so a new audience or time
-- means withdraw and publish again.
create or replace function public.update_announcement(
  p_id uuid, p_title text, p_body text,
  p_department text default null, p_shift_group text default null,
  p_requires_ack boolean default true, p_urgent boolean default false,
  p_expires_at timestamptz default null, p_publish_at timestamptz default null)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_uid  uuid := auth.uid();
  v_a    public.announcements;
  v_dept text := nullif(btrim(p_department), '');
  v_crew text := nullif(btrim(p_shift_group), '');
  v_at   timestamptz;
begin
  if v_uid is null then
    raise exception 'Sign in first' using errcode = '28000';
  end if;
  select * into v_a from public.announcements where id = p_id for update;
  if v_a.id is null then
    raise exception 'No such announcement' using errcode = 'P0001';
  end if;
  if v_a.created_by <> v_uid and not public.has_role(v_uid, 'admin'::app_role) then
    raise exception 'Only the author or an admin can edit this announcement' using errcode = '42501';
  end if;
  if v_a.withdrawn_at is not null then
    raise exception 'This announcement was withdrawn and cannot be edited' using errcode = 'P0001';
  end if;

  if v_a.rung_at is not null then
    if v_dept is distinct from v_a.audience_department or v_crew is distinct from v_a.audience_shift_group then
      raise exception 'It has already been sent. To change who receives it, withdraw it and publish a new one'
        using errcode = 'P0001';
    end if;
    v_at := v_a.published_at;
  else
    if not public.announcements_may_publish(v_uid, v_dept) then
      raise exception 'You cannot publish an announcement to this audience' using errcode = '42501';
    end if;
    v_at := greatest(coalesce(p_publish_at, now()), now());
  end if;
  perform public.announcement_check_fields(p_title, p_body, v_at, p_expires_at);

  update public.announcements
     set title = btrim(p_title), body = btrim(p_body),
         audience_department = v_dept, audience_shift_group = v_crew,
         requires_ack = coalesce(p_requires_ack, true), urgent = coalesce(p_urgent, false),
         published_at = v_at, expires_at = p_expires_at,
         updated_at = now(), updated_by = v_uid
   where id = p_id;

  if v_a.rung_at is not null then
    -- The bell rows nobody has opened yet show the new words.
    update public.notifications
       set title = left(case when coalesce(p_urgent, false) then 'Urgent: ' else '' end || btrim(p_title), 200),
           body  = left(btrim(p_body), 200),
           priority = case when coalesce(p_urgent, false) then 'high' else 'medium' end
     where announcement_id = p_id and read_at is null;
  else
    perform public.announcement_ring(p_id);
  end if;
end;
$function$;
revoke all on function public.update_announcement(uuid, text, text, text, text, boolean, boolean, timestamptz, timestamptz) from public, anon;
grant execute on function public.update_announcement(uuid, text, text, text, text, boolean, boolean, timestamptz, timestamptz) to authenticated;

create or replace function public.withdraw_announcement(p_id uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_a public.announcements;
begin
  select * into v_a from public.announcements where id = p_id for update;
  if v_a.id is null then
    raise exception 'No such announcement' using errcode = 'P0001';
  end if;
  if auth.uid() is null or (v_a.created_by <> auth.uid() and not public.has_role(auth.uid(), 'admin'::app_role)) then
    raise exception 'Only the author or an admin can withdraw this announcement' using errcode = '42501';
  end if;
  if v_a.withdrawn_at is not null then return; end if;
  update public.announcements set withdrawn_at = now(), withdrawn_by = auth.uid() where id = p_id;
  -- Nothing left to read: the bell rows nobody opened go too.
  delete from public.notifications where announcement_id = p_id and read_at is null;
end;
$function$;
revoke all on function public.withdraw_announcement(uuid) from public, anon;
grant execute on function public.withdraw_announcement(uuid) to authenticated;

-- Delete for good. The reads and the bell rows go with it (both foreign keys cascade), so
-- the record of who confirmed is lost; the screen says so before asking. Withdraw keeps it.
create or replace function public.delete_announcement(p_id uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_a public.announcements;
begin
  select * into v_a from public.announcements where id = p_id for update;
  if v_a.id is null then return; end if;
  if auth.uid() is null or (v_a.created_by <> auth.uid() and not public.has_role(auth.uid(), 'admin'::app_role)) then
    raise exception 'Only the author or an admin can delete this announcement' using errcode = '42501';
  end if;
  delete from public.announcements where id = p_id;
end;
$function$;
revoke all on function public.delete_announcement(uuid) from public, anon;
grant execute on function public.delete_announcement(uuid) to authenticated;

-- ── 7. Reading and confirming ──────────────────────────────────────────────
create or replace function public.read_announcement(p_id uuid, p_acknowledge boolean default false)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_a   public.announcements;
begin
  if v_uid is null then
    raise exception 'Sign in first' using errcode = '28000';
  end if;
  if not public.announcement_is_for(v_uid, p_id) then
    raise exception 'This announcement is not available' using errcode = '42501';
  end if;
  select * into v_a from public.announcements where id = p_id;
  if p_acknowledge and not v_a.requires_ack then
    raise exception 'This announcement does not ask for confirmation' using errcode = 'P0001';
  end if;

  insert into public.announcement_reads (announcement_id, user_id, read_at, acknowledged_at)
  values (p_id, v_uid, now(), case when p_acknowledge then now() end)
  on conflict (announcement_id, user_id) do update
    set acknowledged_at = coalesce(public.announcement_reads.acknowledged_at, excluded.acknowledged_at);

  -- Opening it here is reading the bell row too.
  update public.notifications set read_at = now()
   where user_id = v_uid and announcement_id = p_id and read_at is null;
end;
$function$;
revoke all on function public.read_announcement(uuid, boolean) from public, anon;
grant execute on function public.read_announcement(uuid, boolean) to authenticated;

-- The signed-in person's live announcements, newest first. Strictly the ones addressed to
-- them: an admin's own feed is not every announcement in the company.
create or replace function public.my_announcements(p_limit integer default 50)
returns table(id uuid, title text, body text, category text, urgent boolean, requires_ack boolean,
              published_at timestamptz, expires_at timestamptz,
              audience_department text, audience_shift_group text,
              read_at timestamptz, acknowledged_at timestamptz)
language sql stable security definer set search_path to 'public'
as $function$
  select a.id, a.title, a.body, a.category, a.urgent, a.requires_ack,
         a.published_at, a.expires_at, a.audience_department, a.audience_shift_group,
         r.read_at, r.acknowledged_at
    from public.announcements a
    left join public.announcement_reads r on r.announcement_id = a.id and r.user_id = auth.uid()
   where auth.uid() is not null
     and a.withdrawn_at is null
     and a.published_at <= now()
     and (a.expires_at is null or a.expires_at > now())
     and a.created_by <> auth.uid()
     and exists (select 1 from public.announcement_audience_for(a.audience_department, a.audience_shift_group) t
                  where t.user_id = auth.uid())
   order by a.published_at desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200);
$function$;
revoke all on function public.my_announcements(integer) from public, anon;
grant execute on function public.my_announcements(integer) to authenticated;

-- ── 8. The read report ─────────────────────────────────────────────────────
-- One row per targeted person: every login in the audience (with their employee record when
-- there is one) and every active employee in the department/shift with NO login, who
-- cannot receive it. The author is not waiting on themselves.
-- The rows, with no check: only the two functions below call it.
create or replace function public.announcement_report_rows(p_id uuid)
returns table(employee_id uuid, user_id uuid, name text, department text, shift_group text,
              has_login boolean, read_at timestamptz, acknowledged_at timestamptz)
language sql stable security definer set search_path to 'public'
as $function$
  with a as (select * from public.announcements where id = p_id)
  select x.employee_id, x.user_id, x.name, x.department, x.shift_group, x.has_login,
         r.read_at, r.acknowledged_at
    from (
      select e.id as employee_id, t.user_id,
             coalesce(e.full_name, nullif(p.name, ''), 'Unknown')::text as name,
             e.department::text as department, e.shift_group::text as shift_group, true as has_login
        from public.announcement_audience(p_id) t
        left join lateral (select em.id, em.full_name, em.department, em.shift_group
                             from public.employees em
                            where em.user_id = t.user_id and em.active
                            order by em.created_at limit 1) e on true
        left join public.profiles p on p.id = t.user_id
       where t.user_id is distinct from (select a.created_by from a)
      union all
      select em.id, null::uuid, em.full_name::text, em.department::text, em.shift_group::text, false
        from public.employees em, a
       where em.active and em.user_id is null
         and (a.audience_department is null or lower(btrim(em.department)) = lower(btrim(a.audience_department)))
         and (a.audience_shift_group is null or lower(btrim(em.shift_group)) = lower(btrim(a.audience_shift_group)))
    ) x
    left join public.announcement_reads r on r.announcement_id = p_id and r.user_id = x.user_id;
$function$;
revoke all on function public.announcement_report_rows(uuid) from public, anon, authenticated;

create or replace function public.announcement_read_report(p_id uuid)
returns table(employee_id uuid, user_id uuid, name text, department text, shift_group text,
              has_login boolean, read_at timestamptz, acknowledged_at timestamptz)
language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if auth.uid() is null or not exists (
       select 1 from public.announcements a
        where a.id = p_id
          and (a.created_by = auth.uid() or public.has_role(auth.uid(), 'admin'::app_role))) then
    raise exception 'Only the author or an admin can see who has read this announcement' using errcode = '42501';
  end if;
  return query
  select r.employee_id, r.user_id, r.name, r.department, r.shift_group, r.has_login, r.read_at, r.acknowledged_at
    from public.announcement_report_rows(p_id) r
   order by r.has_login desc, (r.acknowledged_at is null) desc, r.name;
end;
$function$;
revoke all on function public.announcement_read_report(uuid) from public, anon;
grant execute on function public.announcement_read_report(uuid) to authenticated;

-- Kept for anything written against the first version; the report above replaces it.
create or replace function public.announcement_confirmations(p_id uuid)
returns table(user_id uuid, name text, department text, read_at timestamptz, acknowledged_at timestamptz)
language sql stable security definer set search_path to 'public'
as $function$
  select r.user_id, r.name, r.department, r.read_at, r.acknowledged_at
    from public.announcement_read_report(p_id) r
   where r.has_login;
$function$;
revoke all on function public.announcement_confirmations(uuid) from public, anon;
grant execute on function public.announcement_confirmations(uuid) to authenticated;

-- The manager's list: what they may manage (their own; an admin, all), newest first, with
-- the counts the report would give.
create or replace function public.announcements_manage_list()
returns table(id uuid, title text, body text, category text, urgent boolean, requires_ack boolean,
              audience_department text, audience_shift_group text,
              published_at timestamptz, expires_at timestamptz, rung_at timestamptz,
              withdrawn_at timestamptz, updated_at timestamptz,
              created_by uuid, author_name text,
              targeted integer, reachable integer, acknowledged integer)
language sql stable security definer set search_path to 'public'
as $function$
  select a.id, a.title, a.body, a.category, a.urgent, a.requires_ack,
         a.audience_department, a.audience_shift_group,
         a.published_at, a.expires_at, a.rung_at, a.withdrawn_at, a.updated_at,
         a.created_by, coalesce(nullif(p.name, ''), 'Unknown')::text,
         c.targeted, c.reachable, c.acknowledged
    from public.announcements a
    left join public.profiles p on p.id = a.created_by
    cross join lateral (
      select count(*)::integer as targeted,
             count(*) filter (where r.has_login)::integer as reachable,
             count(*) filter (where case when a.requires_ack then r.acknowledged_at is not null
                                         else r.read_at is not null end)::integer as acknowledged
        from public.announcement_report_rows(a.id) r
    ) c
   where auth.uid() is not null
     and public.has_action(auth.uid(), 'announcements.publish', array['admin']::app_role[])
     and (a.created_by = auth.uid() or public.has_role(auth.uid(), 'admin'::app_role))
   order by a.published_at desc
   limit 200;
$function$;
revoke all on function public.announcements_manage_list() from public, anon;
grant execute on function public.announcements_manage_list() to authenticated;

-- ── 9. Jobs ────────────────────────────────────────────────────────────────
-- cron.schedule with a name replaces the job of that name: a second paste adds nothing.
-- Every 5 minutes, not every minute: the instance is small (incident of 15/11) and a
-- scheduled notice five minutes late harms nobody.
select cron.schedule('announcements-ring-due', '*/5 * * * *', 'select public.announcements_ring_due();');
select cron.schedule('announcements-forget-expired', '17 * * * *', 'select public.announcements_forget_expired();');

notify pgrst, 'reload schema';
