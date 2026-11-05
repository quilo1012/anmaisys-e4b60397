-- Verificação do BLOCO 148 — previsões do Smart Target. Só lê o catálogo e conta linhas.
--
-- Esperado depois de colar: todas as linhas 'ok', menos a última, que é informação
-- (0 até alguém abrir o Smart Target durante um turno).

select '148 tabela existe' as check,
       case when to_regclass('public.smart_target_forecasts') is not null then 'ok' else 'FALTA' end as result
union all
select '148 RLS ligado',
       case when (select relrowsecurity from pg_class where oid = to_regclass('public.smart_target_forecasts'))
            then 'ok' else 'DESLIGADO' end
union all
select '148 nenhuma política de escrita',
       coalesce((select string_agg(policyname || ' (' || cmd || ')', ', ')
                   from pg_policies
                  where schemaname = 'public' and tablename = 'smart_target_forecasts' and cmd <> 'SELECT'), 'ok')
union all
select '148 anon não lê nem escreve',
       case when has_table_privilege('anon', 'public.smart_target_forecasts', 'SELECT')
              or has_table_privilege('anon', 'public.smart_target_forecasts', 'INSERT')
            then 'ANON TEM ACESSO' else 'ok' end
union all
select '148 função é SECURITY DEFINER',
       case when (select prosecdef from pg_proc
                   where oid = to_regprocedure('public.save_smart_target_forecasts(date, text, jsonb)'))
            then 'ok' else 'FALTA OU NÃO É DEFINER' end
union all
select '148 anon não executa a função',
       case when has_function_privilege('anon', 'public.save_smart_target_forecasts(date, text, jsonb)', 'EXECUTE')
            then 'ANON EXECUTA' else 'ok' end
union all
select '148 previsões guardadas (informação)',
       (select count(*)::text from public.smart_target_forecasts);
