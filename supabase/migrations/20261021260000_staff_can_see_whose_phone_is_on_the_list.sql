-- ================================================================
-- BLOCO 123
-- 20261021260000_staff_can_see_whose_phone_is_on_the_list.sql
-- ================================================================
--
-- PT: Uma mensagem so chega a um telemovel bloqueado se ESSE telemovel disse "sim" uma vez.
-- Quem gere o overtime nao tinha maneira de ver quem ainda nao disse: a 21/10 uma mensagem para
-- o Maikon nao chegou a ninguem porque ele tinha 0 telemoveis na lista. `push_coverage()`
-- devolve, por login, quantos telemoveis tem registados, de que tipo, e quando foi o ultimo.
--
--   * So para quem pode gerir overtime (admin, manager, production office admin, e as
--     permissoes dadas pela matriz). Todos os outros recebem zero linhas.
--   * Devolve o tipo (iPhone/iPad, Android/Chrome, Firefox, Windows) deduzido do servidor do
--     endpoint, nunca o endpoint nem as chaves: com elas qualquer pessoa podia enviar push
--     para esse telemovel.
--   * So le. Nao muda nem apaga dados.
--
-- EN: A message reaches a locked phone only if THAT phone said yes once. Whoever manages
-- overtime had no way to see who had not: on 21/10 a message to Maikon reached nobody because
-- he had 0 phones on the list. `push_coverage()` returns, per login, how many phones are
-- registered, of what kind, and when the last one was. Only for people who can manage
-- overtime (everyone else gets no rows). The kind is derived from the endpoint's host; the
-- endpoint and keys are never returned. Read-only.

create or replace function public.push_coverage()
returns table (user_id uuid, phones integer, platforms text[], last_registered timestamptz)
language sql stable security definer set search_path = public
as $$
  select s.user_id,
         count(*)::int,
         array_agg(distinct case
           when s.endpoint like '%web.push.apple.com%'          then 'iPhone/iPad'
           when s.endpoint like '%fcm.googleapis.com%'          then 'Android/Chrome'
           when s.endpoint like '%push.services.mozilla.com%'   then 'Firefox'
           when s.endpoint like '%notify.windows.com%'          then 'Windows'
           else 'Other' end),
         max(s.created_at)
    from public.push_subscriptions s
   where auth.uid() is not null and public.can_manage_overtime(auth.uid())
   group by s.user_id;
$$;
revoke all on function public.push_coverage() from public;
revoke execute on function public.push_coverage() from anon;
grant execute on function public.push_coverage() to authenticated;

notify pgrst, 'reload schema';
