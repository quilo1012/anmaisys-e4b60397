-- ================================================================
-- BLOCO 109
-- 20261020100000_the_hub_lists_whoever_the_rule_lets_you_write_to.sql
-- ================================================================
--
-- A PESQUISA DO COMMUNICATION HUB: passa a listar toda a gente a quem a regra de envio
-- (dm_insert_routing) deixa escrever, mais o supervisor da ficha de um employee. Antes,
-- um admin podia escrever aos 24 employees e nao encontrava nenhum. So acrescenta duas
-- funcoes de leitura; nao muda nenhuma politica nem nenhuma linha. Pode colar-se duas vezes.
-- Precisa dos BLOCOS 107 e 108.
-- Teste depois: supabase/tests/hub_contactable_people_test.sql (acaba em ALL TESTS PASSED, com ROLLBACK).
--
-- The Communication Hub lists whoever the rule lets you write to.
--
-- WHAT WAS THERE. The hub's list of people came from `list_dm_partners` (20260723170000),
-- which picks by role and never lists an `employee` login: the role did not exist when
-- it was written. The rule that decides who may write to whom is a different thing,
-- `dm_insert_routing` on `direct_messages` (read from production on 20/10/2026):
--
--   operator                                  -> a supervisor, or an operator-chat admin
--   supervisor, or an operator-chat admin     -> anybody
--   admin / manager / maintenance_manager /
--   warehouse                                 -> anybody who is not an operator
--
-- So an admin was allowed to write to every employee and could find none of them: 24
-- employee logins in production, 0 in the list. And an employee's only way to start a
-- conversation is `message_my_supervisor` (BLOCO 107), to the supervisor on file.
--
-- WHAT THIS DOES. `chat_contactable_people()` lists the active logins the caller may
-- start a conversation with, by evaluating THE SAME expression as `dm_insert_routing`
-- for each of them, plus the employee's supervisor on file. It decides nothing new and
-- grants nothing: a name it returns is a name the insert would accept, and the test
-- (supabase/tests/hub_contactable_people_test.sql) checks exactly that, pair by pair.
-- Only names, photos and job titles come back — what the hub already shows.
--
-- Nothing is rewritten; no policy changes. Needs BLOCOS 107 and 108.

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
