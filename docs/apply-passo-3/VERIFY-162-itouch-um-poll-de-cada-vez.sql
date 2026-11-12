-- Verificação do BLOCO 162. Só lê. Esperado: todas as linhas 'ok'.

select '162 tabela intouch_poll_lease com a linha' as check,
       case when to_regclass('public.intouch_poll_lease') is not null
             and (select count(*) from public.intouch_poll_lease) = 1
            then 'ok' else 'FALTA' end as result
union all
select '162 funções do lease existem',
       case when to_regprocedure('public.intouch_poll_try_start(integer)') is not null
             and to_regprocedure('public.intouch_poll_finish()') is not null
            then 'ok' else 'FALTA' end
union all
select '162 só service_role executa',
       case when has_function_privilege('service_role', 'public.intouch_poll_try_start(integer)', 'execute')
             and not has_function_privilege('anon', 'public.intouch_poll_try_start(integer)', 'execute')
             and not has_function_privilege('authenticated', 'public.intouch_poll_try_start(integer)', 'execute')
             and not has_function_privilege('anon', 'public.intouch_poll_finish()', 'execute')
             and not has_function_privilege('authenticated', 'public.intouch_poll_finish()', 'execute')
            then 'ok' else 'PERMISSÕES A MAIS' end
union all
select '162 job intouch-poll-60s espera 30 s',
       case when (select command from cron.job where jobname = 'intouch-poll-60s') like '%timeout_milliseconds:=30000%'
            then 'ok' else 'FALTA' end
union all
select '162 job continua a ler o segredo do vault',
       case when (select command from cron.job where jobname = 'intouch-poll-60s') like '%vault.decrypted_secrets%'
            then 'ok' else 'VER JOB' end
union all
select '162 job continua ativo, a cada minuto',
       case when (select active and schedule = '* * * * *' from cron.job where jobname = 'intouch-poll-60s')
            then 'ok' else 'VER JOB' end;

-- Depois de publicar a função (passo 3), uma hora depois: quantos pedidos expiraram.
-- Esperado: timed_out perto de 0. (Só contagens; a tabela não guarda o URL.)
select count(*) as pedidos_1h,
       count(*) filter (where timed_out) as timed_out_1h
  from net._http_response
 where created > now() - interval '1 hour';
