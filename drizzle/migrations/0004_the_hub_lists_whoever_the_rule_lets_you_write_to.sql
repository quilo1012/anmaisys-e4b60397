create or replace function public.chat_may_start(p_from uuid, p_to uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  -- Word for word the WITH CHECK of "dm_insert_routing", with sender = p_from and
  -- recipient = p_to. If that policy changes, this changes with it (the test fails
  -- until it does).
  select p_from is not null and p_to is not null and p_from <> p_to and (
       (public.has_role(p_from, 'operator'::app_role)
         and (public.has_role(p_to, 'supervisor'::app_role) or public.is_operator_chat_admin(p_to)))
     or public.has_role(p_from, 'supervisor'::app_role)
     or public.is_operator_chat_admin(p_from)
     or ((public.has_role(p_from, 'admin'::app_role) or public.has_role(p_from, 'manager'::app_role)
          or public.has_role(p_from, 'maintenance_manager'::app_role) or public.has_role(p_from, 'warehouse'::app_role))
         and not public.has_role(p_to, 'operator'::app_role))
  );
$$;
revoke all on function public.chat_may_start(uuid, uuid) from public, anon, authenticated;

create or replace function public.chat_contactable_people()
returns table (user_id uuid, name text, avatar_path text, job text)
language sql stable security definer set search_path = public
as $$
  with me as (select auth.uid() as id),
  sup as (
    -- An employee's door: the supervisor on file (BLOCO 107), written to through
    -- message_my_supervisor.
    select s.user_id from public.my_supervisor() s
  )
  select p.id,
         coalesce(e.full_name, nullif(btrim(p.name), ''), p.email, 'User'),
         p.avatar_path,
         coalesce(nullif(btrim(e.position), ''),
                  initcap(replace((select r.role::text from public.user_roles r where r.user_id = p.id limit 1), '_', ' ')))
           || coalesce(' · ' || nullif(btrim(e.department), ''), '')
    from public.profiles p
    cross join me
    left join lateral (select x.full_name, x.position, x.department from public.employees x
                        where x.user_id = p.id and x.active limit 1) e on true
   where me.id is not null
     and p.id <> me.id
     and coalesce(p.active, true)
     and (public.chat_may_start(me.id, p.id) or p.id in (select user_id from sup))
   order by 2;
$$;
revoke all on function public.chat_contactable_people() from public, anon;
grant execute on function public.chat_contactable_people() to authenticated;

notify pgrst, 'reload schema';