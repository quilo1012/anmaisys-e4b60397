-- Verificação do BLOCO 157. Só lê. Esperado: todas as linhas 'ok'.

select '157 marcador só ao ficar online' as check,
       case when pg_get_functiondef('public.communication_touch_presence'::regproc) like '%if not v_was_online then%'
            then 'ok' else 'FALTA' end as result
union all
select '157 authenticated executa',
       case when has_function_privilege('authenticated', 'public.communication_touch_presence(uuid)', 'EXECUTE')
            then 'ok' else 'SEM GRANT' end
union all
select '157 anon não executa',
       case when has_function_privilege('anon', 'public.communication_touch_presence(uuid)', 'EXECUTE')
            then 'ANON EXECUTA' else 'ok' end;
