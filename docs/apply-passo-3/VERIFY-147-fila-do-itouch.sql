-- Verificação do BLOCO 147 — fila do iTouch do Smart Target. Só lê o catálogo e conta linhas.
--
-- Esperado depois de colar: todas as linhas 'ok', menos a última, que é informação
-- (0 até alguém abrir a página Smart Target durante um turno).

select '147 tabela existe' as check,
       case when to_regclass('public.smart_target_queue_snapshots') is not null then 'ok' else 'FALTA' end as result
union all
select '147 RLS ligado',
       case when (select relrowsecurity from pg_class where oid = to_regclass('public.smart_target_queue_snapshots'))
            then 'ok' else 'DESLIGADO' end
union all
select '147 nenhuma política de escrita',
       coalesce((select string_agg(policyname || ' (' || cmd || ')', ', ')
                   from pg_policies
                  where schemaname = 'public' and tablename = 'smart_target_queue_snapshots' and cmd <> 'SELECT'), 'ok')
union all
select '147 anon não lê nem escreve',
       case when has_table_privilege('anon', 'public.smart_target_queue_snapshots', 'SELECT')
              or has_table_privilege('anon', 'public.smart_target_queue_snapshots', 'INSERT')
            then 'ANON TEM ACESSO' else 'ok' end
union all
select '147 função é SECURITY DEFINER',
       case when (select prosecdef from pg_proc
                   where oid = to_regprocedure('public.save_smart_target_queue(date, text, jsonb)'))
            then 'ok' else 'FALTA OU NÃO É DEFINER' end
union all
select '147 anon não executa a função',
       case when has_function_privilege('anon', 'public.save_smart_target_queue(date, text, jsonb)', 'EXECUTE')
            then 'ANON EXECUTA' else 'ok' end
union all
select '147 turnos guardados (informação)',
       (select count(distinct (session_date, shift))::text from public.smart_target_queue_snapshots);
