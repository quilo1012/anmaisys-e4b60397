-- Verificação do BLOCO 150. Só lê o catálogo. Esperado: todas as linhas 'ok'.

select '150 a função substitui só o que não tem número' as check,
       case when pg_get_functiondef(to_regprocedure('public.save_smart_target_forecasts(date, text, jsonb)'))
                 like '%f.expected_total is null and excluded.expected_total is not null%'
            then 'ok' else 'FALTA' end as result
union all
select '150 anon não executa',
       case when has_function_privilege('anon', 'public.save_smart_target_forecasts(date, text, jsonb)', 'EXECUTE')
            then 'ANON EXECUTA' else 'ok' end
union all
select '150 o servidor executa',
       case when has_function_privilege('service_role', 'public.save_smart_target_forecasts(date, text, jsonb)', 'EXECUTE')
            then 'ok' else 'FALTA GRANT' end;
