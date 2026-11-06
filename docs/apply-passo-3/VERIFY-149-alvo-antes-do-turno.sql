-- Verificação do BLOCO 149 — alvo do Smart Target antes do turno. Só lê.
--
-- Esperado depois de colar: todas as linhas 'ok', menos as duas últimas, que são
-- informação (a última hora a que o servidor guardou previsões, e o que o cron respondeu
-- da última vez; ficam vazias até ao primeiro turno depois da colagem).

select '149 colunas novas' as check,
       case when (select count(*) from information_schema.columns
                   where table_schema = 'public' and table_name = 'smart_target_forecasts'
                     and column_name in ('expected_per_hour', 'source', 'queue_read_at', 'notes')) = 4
            then 'ok' else 'FALTAM' end as result
union all
select '149 função do tablet existe e é SECURITY DEFINER',
       case when (select prosecdef from pg_proc
                   where oid = to_regprocedure('public.smart_target_line_targets(date, text)'))
            then 'ok' else 'FALTA OU NÃO É DEFINER' end
union all
select '149 anon não lê o alvo do tablet',
       case when has_function_privilege('anon', 'public.smart_target_line_targets(date, text)', 'EXECUTE')
            then 'ANON EXECUTA' else 'ok' end
union all
select '149 o servidor pode gravar previsões e fila',
       case when has_function_privilege('service_role', 'public.save_smart_target_forecasts(date, text, jsonb)', 'EXECUTE')
             and has_function_privilege('service_role', 'public.save_smart_target_queue(date, text, jsonb)', 'EXECUTE')
            then 'ok' else 'FALTA GRANT' end
union all
select '149 anon não grava',
       case when has_function_privilege('anon', 'public.save_smart_target_forecasts(date, text, jsonb)', 'EXECUTE')
              or has_function_privilege('anon', 'public.save_smart_target_queue(date, text, jsonb)', 'EXECUTE')
            then 'ANON EXECUTA' else 'ok' end
union all
select '149 cron ligado, aponta para esta base',
       coalesce((select case when j.active and j.command like '%ybtrzqzliepknpzqdajx%' then 'ok'
                             when not j.active then 'DESLIGADO'
                             else 'URL DE OUTRA BASE' end
                   from cron.job j where j.jobname = 'smart-target-ahead'), 'FALTA')
union all
select '149 CRON_SECRET no vault',
       case when exists (select 1 from vault.decrypted_secrets where name = 'CRON_SECRET')
            then 'ok' else 'FALTA (o cron chama sem segredo e leva 401)' end
union all
select '149 última previsão do servidor (informação)',
       coalesce((select to_char(max(frozen_at) at time zone 'Europe/London', 'DD/MM HH24:MI')
                   from public.smart_target_forecasts where source = 'ahead'), 'nenhuma ainda')
union all
select '149 última resposta da função (informação)',
       coalesce((select r.status_code::text || ' ' || left(coalesce(r.content, ''), 160)
                   from net._http_response r
                  where r.content like '%"date"%' or r.content like '%No shift starts%'
                  order by r.created desc limit 1), 'nenhuma ainda');
