-- Verificação do BLOCO 161. Só lê. Esperado: todas as linhas 'ok'.

select '161 coluna meeting_participants.decline_reason' as check,
       case when exists (select 1 from information_schema.columns
                          where table_schema = 'public' and table_name = 'meeting_participants' and column_name = 'decline_reason')
            then 'ok' else 'FALTA' end as result
union all
select '161 só um meeting_respond, com p_reason',
       case when (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = 'meeting_respond') = 1
             and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'public' and p.proname = 'meeting_respond' and 'p_reason' = any (p.proargnames))
            then 'ok' else 'FALTA' end
union all
select '161 lista de participantes devolve o motivo',
       case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'public' and p.proname = 'meeting_participant_list' and 'decline_reason' = any (p.proargnames))
            then 'ok' else 'FALTA' end
union all
select '161 anon não executa meeting_respond',
       case when not has_function_privilege('anon', 'public.meeting_respond(uuid, text, text, text)', 'execute')
            then 'ok' else 'ANON PODE' end;
