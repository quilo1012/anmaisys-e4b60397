-- ================================================================
-- BLOCO 117
-- 20261021200000_the_bell_rings_the_phone.sql
-- ================================================================
--
-- As linhas do sino que a propria base escreve passam a fazer vibrar o telemovel, mesmo
-- com o ecra bloqueado. Ate aqui so os pedidos de overtime chegavam ao telemovel, porque
-- so o browser de quem os cria chamava o `send-push` (`overtimeAnnounce.ts`). Uma mensagem
-- directa (`dm_employee_bell`), um "you're booked" ou um "X said yes" ficavam no sino a
-- espera que a pessoa abrisse a app.
--
--   1. `notification_push()`: um trigger AFTER INSERT em `notifications` que chama o
--      `send-push` por `pg_net`, com o `CRON_SECRET` do vault no header `x-cron-secret`
--      (o mesmo caminho do job 63, que esta vivo) e `in_app: false`, para nao escrever o
--      sino uma segunda vez.
--   2. Quais linhas: todas as que tem `kind`, menos `overtime_new`. As sem `kind` sao
--      escritas pelo proprio `send-push`, que ja fez o push nesse momento; o `overtime_new`
--      e enviado pelo browser de quem cria o pedido (`announceAsk`). Qualquer das duas aqui
--      seria um segundo toque no mesmo telemovel.
--   3. So chama quando o destinatario tem pelo menos uma subscricao, para nao encher o
--      `net._http_response` com pedidos que nao vao a lado nenhum.
--
-- Nunca recusa a linha do sino: qualquer falha (vault vazio, pg_net em baixo) fica num
-- WARNING e o INSERT segue. O `pg_net` so envia depois do COMMIT, por isso uma linha
-- revertida nao toca telemovel nenhum.
--
-- Precisa do `send-push` publicado com o ramo do `x-cron-secret` (mesmo PR). Antes disso
-- o `send-push` responde 401 ao trigger e nada pior acontece: o sino continua a funcionar.
-- Nao muda nem apaga dados.
--
-- The bell rows the database writes itself now buzz the phone too, even when it is locked.
-- An AFTER INSERT trigger on `notifications` calls `send-push` through pg_net with the
-- vault's CRON_SECRET and `in_app: false`, for every row with a `kind` except
-- `overtime_new` (the browser already pushes those) — rows without a kind are written by
-- `send-push` itself, which has already pushed them. Only for recipients with a
-- subscription. It never refuses the bell row. No data is touched.

create or replace function public.notification_push()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_secret text;
begin
  begin
    if not exists (select 1 from public.push_subscriptions s where s.user_id = new.user_id) then
      return null;
    end if;

    select decrypted_secret into v_secret
      from vault.decrypted_secrets where name = 'CRON_SECRET' limit 1;
    if v_secret is null then
      raise warning 'notification_push(%): CRON_SECRET missing from the vault', new.id;
      return null;
    end if;

    perform net.http_post(
      url := 'https://ybtrzqzliepknpzqdajx.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', v_secret
      ),
      body := jsonb_strip_nulls(jsonb_build_object(
        'user_id', new.user_id,
        'title', left(coalesce(nullif(new.title, ''), 'PMSystem'), 200),
        'body', left(new.body, 2000),
        'priority', case when new.priority in ('low', 'medium', 'high', 'critical')
                         then new.priority else 'medium' end,
        'tag', left(new.kind || ':' || new.id, 100),
        'action_url', left(new.action_url, 2048),
        'wo_id', new.wo_id,
        'in_app', false
      )),
      timeout_milliseconds := 10000
    );
  exception when others then
    raise warning 'notification_push(%): %', new.id, sqlerrm;
  end;
  return null;
end;
$$;
revoke all on function public.notification_push() from public, anon, authenticated;

drop trigger if exists notification_push on public.notifications;
create trigger notification_push
  after insert on public.notifications
  for each row
  when (new.kind is not null and new.kind <> 'overtime_new')
  execute function public.notification_push();
