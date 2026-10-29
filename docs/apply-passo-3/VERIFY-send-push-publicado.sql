-- O send-push que está no ar aceita os pedidos da base?
--
-- Porquê isto existe (29/10/2026): o sino era escrito, mas nada tocava no telemóvel. O
-- send-push publicado era uma versão de antes de 21/10 às 19:19, que não conhece a chave
-- do agendador (x-cron-secret, BLOCO 117) e respondia 401 à base. As alterações ao
-- send-push entraram no `main` pelo GitHub, e um merge publica a app mas NÃO publica as
-- funções. Ver a secção "A merge does not publish the server functions" no AGENTS.md.
--
-- Um sino no ecrã não prova uma entrega. Isto mede o último passo.
--
-- ── Parte 1: só lê ───────────────────────────────────────────────────────────────────
-- Os lembretes e confirmações de overtime (BLOCO 136) guardam a resposta do send-push.
-- É a única prova que fica: o pg_net não guarda a URL das respostas, e mais dez funções
-- respondem o mesmo {"error":"unauthorized"}.

select 'send-push recusou a base (lembretes e confirmações, últimas 24 h)' as check,
       case when count(*) = 0 then 'ok (ou nenhum envio tentado)'
            else count(*)::text || ' recusados com 401: o send-push publicado está desatualizado, publicar a partir do main'
       end as result
  from public.overtime_booking_notices
 where last_attempt_at > now() - interval '24 hours'
   and last_error like 'HTTP 401%'
union all
select 'último envio aceite pelo send-push (informação)',
       coalesce((select to_char(max(sent_at) at time zone 'Europe/London', 'DD/MM HH24:MI')
                   from public.overtime_booking_notices
                  where status = 'sent' and attempts > 0), 'nenhum');

-- ── Parte 2: a sonda (opcional) ───────────────────────────────────────────────────────
-- Escreve um pedido HTTP, mas não manda notificação nenhuma: o corpo vazio não tem
-- `title`, e o send-push actual recusa-o com 400 DEPOIS de aceitar a chave. Um 401 quer
-- dizer que a chave foi recusada, ou seja, que a versão no ar não a conhece.
--
-- 2a. Correr sozinho e guardar o número que devolve:
--
--   select net.http_post(
--     url := 'https://ybtrzqzliepknpzqdajx.supabase.co/functions/v1/send-push',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'CRON_SECRET' limit 1)),
--     body := '{}'::jsonb,
--     timeout_milliseconds := 10000) as sonda;
--
-- 2b. Uns segundos depois, com esse número no lugar de 0:
--
--   select case status_code
--            when 400 then 'ok: o send-push no ar aceita a base'
--            when 401 then 'DESATUALIZADO: publicar o send-push a partir do main'
--            else 'inesperado: ' || coalesce(status_code::text, error_msg)
--          end as resultado,
--          content
--     from net._http_response
--    where id = 0;
