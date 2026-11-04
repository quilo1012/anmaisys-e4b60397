-- Verificação do BLOCO 146 — ciclos do iTouch. Só lê o catálogo e conta linhas.
--
-- Esperado depois de colar: todas as linhas 'ok', menos a última, que é informação
-- (0 antes do primeiro import; ~7602 depois do Excel de 04/11).

select '146 tabela existe' as check,
       case when to_regclass('public.itouch_cycle_times') is not null then 'ok' else 'FALTA' end as result
union all
select '146 RLS ligado',
       case when (select relrowsecurity from pg_class where oid = to_regclass('public.itouch_cycle_times'))
            then 'ok' else 'DESLIGADO' end
union all
select '146 política de leitura',
       case when exists (select 1 from pg_policies
                          where schemaname = 'public' and tablename = 'itouch_cycle_times' and cmd = 'SELECT')
            then 'ok' else 'FALTA' end
union all
select '146 nenhuma política de escrita',
       coalesce((select string_agg(policyname || ' (' || cmd || ')', ', ')
                   from pg_policies
                  where schemaname = 'public' and tablename = 'itouch_cycle_times' and cmd <> 'SELECT'), 'ok')
union all
select '146 anon não lê nem escreve',
       case when has_table_privilege('anon', 'public.itouch_cycle_times', 'SELECT')
              or has_table_privilege('anon', 'public.itouch_cycle_times', 'INSERT')
            then 'ANON TEM ACESSO' else 'ok' end
union all
select '146 função é SECURITY DEFINER',
       case when (select prosecdef from pg_proc
                   where oid = to_regprocedure('public.import_itouch_cycles(jsonb, text)'))
            then 'ok' else 'FALTA OU NÃO É DEFINER' end
union all
select '146 anon não executa a função',
       case when has_function_privilege('anon', 'public.import_itouch_cycles(jsonb, text)', 'EXECUTE')
            then 'ANON EXECUTA' else 'ok' end
union all
select '146 linhas guardadas (informação)',
       (select count(*)::text from public.itouch_cycle_times);
