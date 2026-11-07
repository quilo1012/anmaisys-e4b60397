-- Verificação do BLOCO 154. Só lê. Esperado: as três primeiras linhas 'ok'; a última é
-- informação (Line 2 no dia 07/11: a última vez que correu).

select '154 a função existe e não é SECURITY DEFINER' as check,
       case when (select not prosecdef from pg_proc where oid = to_regprocedure('public.smart_target_shift_runs(date, date)'))
            then 'ok' else 'FALTA OU É DEFINER' end as result
union all
select '154 anon não executa',
       case when has_function_privilege('anon', 'public.smart_target_shift_runs(date, date)', 'EXECUTE')
            then 'ANON EXECUTA' else 'ok' end
union all
select '154 quem tem sessão executa',
       case when has_function_privilege('authenticated', 'public.smart_target_shift_runs(date, date)', 'EXECUTE')
            then 'ok' else 'FALTA GRANT' end
union all
select '154 Line 2, 07/11 dia, última vez a correr (informação)',
       coalesce((select to_char(last_run_at at time zone 'Europe/London', 'HH24:MI')
                   from public.smart_target_shift_runs('2026-11-07', '2026-11-07')
                  where line = 'Line 2' and shift = 'DAY'), 'nenhuma');
