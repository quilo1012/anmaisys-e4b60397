-- Verificação do BLOCO 151. Só lê. Esperado: todas as linhas 'ok', menos a última, que é
-- informação (a hora da última linha do log; mudanças de estado fazem-na avançar).

select '151 a função lê a última linha de cada máquina' as check,
       case when pg_get_functiondef(to_regprocedure('public.log_intouch_status()')) like '%left join lateral%'
             and pg_get_functiondef(to_regprocedure('public.log_intouch_status()')) not like '%distinct on%'
            then 'ok' else 'FALTA' end as result
union all
select '151 anon não executa',
       case when has_function_privilege('anon', 'public.log_intouch_status()', 'EXECUTE')
            then 'ANON EXECUTA' else 'ok' end
union all
select '151 cron ligado',
       coalesce((select case when j.active then 'ok' else 'DESLIGADO' end
                   from cron.job j where j.jobname = 'intouch-status-log-60s'), 'FALTA')
union all
select '151 última linha do log (informação)',
       coalesce((select to_char(max(changed_at) at time zone 'Europe/London', 'DD/MM HH24:MI')
                   from public.intouch_status_log), 'nenhuma');
