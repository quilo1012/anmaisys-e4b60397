-- ================================================================
-- BLOCO 121
-- 20261021240000_a_phone_belongs_to_one_login_and_every_group_message_buzzes.sql
-- ================================================================
--
-- PT: Duas falhas do push no telemovel, ambas do lado da base de dados.
--
--   1. UM TELEMOVEL, UM LOGIN. O endpoint de push identifica o aparelho, nao a pessoa. Num
--      telemovel ou tablet partilhado, quem entra depois guardava o mesmo endpoint com o seu
--      user_id e a linha de quem entrou antes ficava la: as mensagens da primeira pessoa
--      continuavam a tocar no aparelho da segunda. `register_push_subscription()` guarda a
--      subscricao do login que esta a chamar e apaga a mesma subscricao de qualquer outro
--      login, na mesma transaccao. A tabela tem RLS e um login so apaga as suas proprias
--      linhas, por isso so uma funcao SECURITY DEFINER o pode fazer.
--
--   2. UMA MENSAGEM DE GRUPO, UM TOQUE. A linha do sino de um grupo e reescrita (nao
--      inserida) enquanto estiver por ler, para nao encher o sino. O trigger do BLOCO 117
--      so dispara em INSERT, por isso so a primeira mensagem de um grupo tocava no
--      telemovel; as seguintes ficavam em silencio. Passa a disparar tambem quando a
--      linha do sino de um grupo e renovada. A etiqueta da notificacao e a mesma, por isso
--      no aparelho a nova substitui a anterior em vez de empilhar.
--
-- Nao muda nem apaga dados. A tabela push_subscriptions e as suas politicas ficam como estao.
--
-- EN: Two push faults, both in the database.
--   1. One phone, one login: the push endpoint identifies the device, not the person. On a
--      shared phone the previous login's row stayed and kept buzzing the device.
--      `register_push_subscription()` stores the caller's subscription and removes the same
--      endpoint from every other login, in one transaction. RLS lets a login delete only its
--      own rows, so only a SECURITY DEFINER function can.
--   2. One group message, one buzz: a group's bell row is rewritten while unread, and the
--      BLOCO 117 trigger fires on INSERT only, so only a group's first message reached the
--      phone. It now also fires when a group's bell row is renewed; the tag is the same, so
--      the device replaces the notification instead of stacking.
-- No data is touched.

create or replace function public.register_push_subscription(
  p_endpoint   text,
  p_p256dh     text,
  p_auth       text,
  p_user_agent text default null
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  if p_endpoint is null or p_endpoint !~ '^https://' or length(p_endpoint) > 2048
     or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'Invalid push subscription' using errcode = '22023';
  end if;

  delete from public.push_subscriptions where endpoint = p_endpoint and user_id <> v_uid;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (v_uid, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 400))
  on conflict (user_id, endpoint)
  do update set p256dh = excluded.p256dh, auth = excluded.auth,
                user_agent = coalesce(excluded.user_agent, public.push_subscriptions.user_agent);
end;
$$;
revoke all on function public.register_push_subscription(text, text, text, text) from public;
revoke execute on function public.register_push_subscription(text, text, text, text) from anon;
grant execute on function public.register_push_subscription(text, text, text, text) to authenticated;

drop trigger if exists notification_push_again on public.notifications;
create trigger notification_push_again
  after update of created_at on public.notifications
  for each row
  when (new.kind = 'chat_group' and new.read_at is null and new.created_at > old.created_at)
  execute function public.notification_push();

notify pgrst, 'reload schema';
