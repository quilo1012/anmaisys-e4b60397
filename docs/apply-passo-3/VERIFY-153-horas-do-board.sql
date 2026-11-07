-- Verificação do BLOCO 153. Só lê. Esperado: todas as linhas 'ok'.

select '153 my_board_marks existe' as check,
       case when to_regprocedure('public.my_board_marks(date, date)') is not null then 'ok' else 'FALTA' end as result
union all
select '153 anon não executa',
       case when to_regprocedure('public.my_board_marks(date, date)') is null then 'FALTA'
            when has_function_privilege('anon', 'public.my_board_marks(date, date)', 'EXECUTE') then 'ANON EXECUTA'
            else 'ok' end
union all
select '153 authenticated executa',
       case when to_regprocedure('public.my_board_marks(date, date)') is null then 'FALTA'
            when has_function_privilege('authenticated', 'public.my_board_marks(date, date)', 'EXECUTE') then 'ok'
            else 'SEM GRANT' end
union all
select '153 é security definer',
       coalesce((select case when p.prosecdef then 'ok' else 'INVOKER' end
                   from pg_proc p where p.oid = to_regprocedure('public.my_board_marks(date, date)')), 'FALTA');
