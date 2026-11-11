-- A reason, optional, when someone declines a meeting. BLOCO 161.
--
-- WHAT THIS DOES.
--   1. `meeting_participants.decline_reason`: up to 200 characters, or nothing.
--   2. `meeting_respond` takes it as a fourth argument, `p_reason`, with a default, so the
--      bell and every other caller that sends three arguments keeps working. Accepting
--      clears it. Declining again with a different reason is a change, and is saved.
--      The organiser's notice carries it.
--   3. `meeting_participant_list` returns it, but only to who may see it: whoever holds
--      `meetings.manage`, the person who made the meeting, and the person who declined.
--      The other participants see that someone declined, not why.
--
-- WHY THE OLD meeting_respond IS DROPPED. Adding an argument with `create or replace`
-- makes a second function beside the first. A call with three named arguments then fits
-- both and PostgREST refuses it as ambiguous (PGRST203). Dropping the three-argument one
-- leaves one function that answers both kinds of call. The same goes for the list, whose
-- returned columns change, which `create or replace` cannot do.
--
-- DEPENDS ON: BLOCO 159. Idempotent: it can be pasted twice.

alter table public.meeting_participants
  add column if not exists decline_reason text
  check (decline_reason is null or length(decline_reason) <= 200);

-- Not in the column grant: the reason is written only by meeting_respond.

drop function if exists public.meeting_respond(uuid, text, text);

create or replace function public.meeting_respond(
  p_meeting  uuid,
  p_response text,
  p_scope    text default 'one',
  p_reason   text default null
)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_me     uuid := auth.uid();
  v_m      public.meetings%rowtype;
  v_n      integer;
  v_reason text := case when p_response = 'declined'
                        then nullif(left(btrim(coalesce(p_reason, '')), 200), '') end;
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
     set response = p_response, responded_at = now(), decline_reason = v_reason
    from public.meetings m
   where mp.meeting_id = m.id
     and mp.user_id = v_me
     and m.cancelled_at is null
     and case when coalesce(p_scope, 'one') = 'following'
              then m.series_id = v_m.series_id and m.starts_at >= v_m.starts_at
              else m.id = p_meeting end
     and (mp.response is distinct from p_response or mp.decline_reason is distinct from v_reason);
  get diagnostics v_n = row_count;

  if v_n > 0 and v_m.created_by <> v_me then
    insert into public.notifications (user_id, kind, meeting_id, title, body, priority, action_url)
    values (v_m.created_by, 'meeting_response', p_meeting,
            left(public.meeting_person_name(v_me) || ' ' || p_response || ' ' || v_m.title, 200),
            public.meeting_when(v_m.starts_at, v_m.ends_at)
              || case when v_n > 1 then ' · and the next ' || (v_n - 1) else '' end
              || case when v_reason is not null then ' · "' || v_reason || '"' else '' end,
            'low', '/dashboard/communication/meetings?meeting=' || p_meeting);
  end if;
  return v_n;
end;
$$;
revoke all on function public.meeting_respond(uuid, text, text, text) from public, anon;
grant execute on function public.meeting_respond(uuid, text, text, text) to authenticated;

drop function if exists public.meeting_participant_list(uuid);

-- Names and answers of everybody in one occurrence, for whoever may read it. The reason
-- for a decline goes only to who manages meetings, who made this one, and who declined.
create or replace function public.meeting_participant_list(p_meeting uuid)
returns table (user_id uuid, name text, response text, responded_at timestamptz, decline_reason text)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_me        uuid := auth.uid();
  v_sees_all  boolean;
begin
  if not (public.meeting_can_manage(v_me) or public.meeting_is_participant(p_meeting, v_me)) then
    raise exception 'You are not invited to this meeting' using errcode = '42501';
  end if;
  v_sees_all := public.meeting_can_manage(v_me)
             or exists (select 1 from public.meetings m where m.id = p_meeting and m.created_by = v_me);
  return query
  select mp.user_id, public.meeting_person_name(mp.user_id), mp.response, mp.responded_at,
         case when mp.response = 'declined' and (v_sees_all or mp.user_id = v_me)
              then mp.decline_reason end
    from public.meeting_participants mp
   where mp.meeting_id = p_meeting
   order by case mp.response when 'accepted' then 0 when 'pending' then 1 else 2 end, 2;
end;
$$;
revoke all on function public.meeting_participant_list(uuid) from public, anon;
grant execute on function public.meeting_participant_list(uuid) to authenticated;

notify pgrst, 'reload schema';
