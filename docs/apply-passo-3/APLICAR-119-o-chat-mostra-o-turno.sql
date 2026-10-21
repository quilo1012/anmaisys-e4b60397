-- ================================================================
-- BLOCO 119
-- 20261021220000_the_chat_list_shows_the_shift_each_person_works.sql
-- ================================================================
--
-- PT: Na lista do chat cada pessoa aparecia como "Employee · Lab" (funcao e departamento).
-- Passa a mostrar tambem o turno em que trabalha, o `employees.shift_group` (o mesmo que o
-- resto da app): "Employee · Lab · Night shift". Sem registo de employee, ou sem turno, a
-- linha fica como estava. So muda o texto de `job`; quem aparece na lista nao muda.
--
-- EN: The chat list showed each person as "Employee · Lab" (role and department). It now
-- also shows the shift they work, `employees.shift_group` (the same one the rest of the app
-- uses): "Employee · Lab · Night shift". No employee record, or no shift, and the line is
-- unchanged. Only the `job` text changes; who is listed does not.

create or replace function public.chat_contactable_people()
returns table (user_id uuid, name text, avatar_path text, job text)
language sql stable security definer set search_path = public
as $$
  with me as (select auth.uid() as id),
  sup as (
    select s.user_id from public.my_supervisor() s
  )
  select p.id,
         coalesce(e.full_name, nullif(btrim(p.name), ''), p.email, 'User'),
         p.avatar_path,
         coalesce(nullif(btrim(e.position), ''),
                  initcap(replace((select r.role::text from public.user_roles r where r.user_id = p.id limit 1), '_', ' ')))
           || coalesce(' · ' || nullif(btrim(e.department), ''), '')
           || coalesce(' · ' || nullif(btrim(e.shift_group), '') || ' shift', '')
    from public.profiles p
    cross join me
    left join lateral (select x.full_name, x.position, x.department, x.shift_group from public.employees x
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
