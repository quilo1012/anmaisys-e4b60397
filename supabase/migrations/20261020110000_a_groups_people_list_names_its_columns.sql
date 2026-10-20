-- A group's people list names its columns.
--
-- WHAT WAS THERE. `chat_group_people` (BLOCO 108) is PL/pgSQL and RETURNS TABLE
-- (user_id, …), which makes `user_id` a variable inside its body. Its lateral lookup
-- said `where user_id = m.user_id` without a table prefix, so Postgres could not tell
-- the column from the variable and refused every call: "column reference "user_id" is
-- ambiguous" (Root Diagnostics, /dashboard/communication, 20/10 10:27). The group's
-- details sheet — members, Add, Remove, Make manager — showed "Members could not be
-- loaded" for everybody. The BLOCO 108 test only called it on the refusal path, which
-- raises before reaching that query; the test now calls it for real.
--
-- WHAT THIS DOES. The same function, the same signature, grants and checks, with every
-- column named by its table. Nothing else changes.

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
      left join lateral (select x.full_name, x.position from public.employees x
                          where x.user_id = m.user_id and x.active limit 1) e on true
     where m.group_id = p_group and m.left_at is null
     order by (m.role = 'manager') desc, 2;
end;
$$;
revoke all on function public.chat_group_people(uuid) from public, anon;
grant execute on function public.chat_group_people(uuid) to authenticated;

notify pgrst, 'reload schema';
