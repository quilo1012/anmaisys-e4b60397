-- Announcements: the bell and the phone get the words without the marks. BLOCO 165.
--
-- WHAT HAPPENED. The first real announcement (26/11, 13:30, Production · Weekend) was
-- written with **bold** and "- " lists. The card draws them; the bell row and the phone
-- notification carried them raw — "- **11 December:** Company Christmas Party".
--
-- WHAT THIS DOES. `announcement_plain(text)` drops ** and turns list marks into "• ", on
-- one line. `announcement_ring` and `update_announcement` write the bell text through it,
-- and the bell rows already written for announcements are cleaned the same way. The
-- announcement itself is untouched: the card still reads its marks.
--
-- DEPENDS ON: BLOCO 164. Idempotent: it can be pasted twice.

create or replace function public.announcement_plain(p_body text)
returns text
language sql immutable set search_path to 'public'
as $function$
  select btrim(regexp_replace(
           regexp_replace(
             regexp_replace(coalesce(p_body, ''), '\*\*(.+?)\*\*', '\1', 'g'),
             '(^|\n)[ \t]*[-*•][ \t]+', '\1• ', 'g'),
           '\s*\n+\s*', ' ', 'g'));
$function$;
revoke all on function public.announcement_plain(text) from public, anon, authenticated;

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
         left(coalesce(nullif(public.announcement_plain(v_a.body), ''), 'Open Announcements to read it.'), 200),
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
           body  = left(public.announcement_plain(p_body), 200),
           priority = case when coalesce(p_urgent, false) then 'high' else 'medium' end
     where announcement_id = p_id and read_at is null;
  else
    perform public.announcement_ring(p_id);
  end if;
end;
$function$;
revoke all on function public.update_announcement(uuid, text, text, text, text, boolean, boolean, timestamptz, timestamptz) from public, anon;
grant execute on function public.update_announcement(uuid, text, text, text, text, boolean, boolean, timestamptz, timestamptz) to authenticated;

-- The bell rows already written: same words, without the marks.
update public.notifications n
   set body = left(public.announcement_plain(a.body), 200)
  from public.announcements a
 where n.announcement_id = a.id
   and n.body is distinct from left(public.announcement_plain(a.body), 200);

notify pgrst, 'reload schema';
