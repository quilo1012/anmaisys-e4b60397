-- Verificação do BLOCO 165. Só lê. Esperado: todas as linhas 'ok'.

select '165 announcement_plain tira as marcas' as check,
       case when public.announcement_plain(E'Dates:\n- **11 December:** Party') = 'Dates: • 11 December: Party'
            then 'ok' else 'ERRADO' end as result
union all
select '165 announcement_ring usa announcement_plain',
       case when pg_get_functiondef('public.announcement_ring(uuid)'::regprocedure) like '%announcement_plain%'
            then 'ok' else 'FALTA' end
union all
select '165 update_announcement usa announcement_plain',
       case when pg_get_functiondef('public.update_announcement(uuid, text, text, text, text, boolean, boolean, timestamptz, timestamptz)'::regprocedure) like '%announcement_plain%'
            then 'ok' else 'FALTA' end
union all
select '165 nenhuma notificação de comunicado com **',
       case when not exists (select 1 from public.notifications where announcement_id is not null and body like '%**%')
            then 'ok' else 'AINDA HÁ' end
union all
select '165 clientes não chamam announcement_plain',
       case when not has_function_privilege('authenticated', 'public.announcement_plain(text)', 'execute')
            then 'ok' else 'ABERTO' end;
