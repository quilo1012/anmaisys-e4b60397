-- Verificação do BLOCO 159. Só lê. Esperado: todas as linhas 'ok'.

select '159 tabelas meetings e meeting_participants' as check,
       case when to_regclass('public.meetings') is not null and to_regclass('public.meeting_participants') is not null
            then 'ok' else 'FALTA' end as result
union all
select '159 RLS ligada nas duas tabelas',
       case when (select bool_and(relrowsecurity) from pg_class
                   where oid in ('public.meetings'::regclass, 'public.meeting_participants'::regclass))
            then 'ok' else 'FALTA' end
union all
select '159 coluna notifications.meeting_id',
       case when exists (select 1 from information_schema.columns
                          where table_schema = 'public' and table_name = 'notifications' and column_name = 'meeting_id')
            then 'ok' else 'FALTA' end
union all
select '159 funções meeting_*',
       case when (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname in
                     ('meeting_create', 'meeting_update', 'meeting_cancel', 'meeting_respond',
                      'meeting_reminders_due', 'meeting_participant_list', 'meeting_invitable_people',
                      'my_meetings', 'my_meeting', 'my_upcoming_meetings', 'my_meeting_answers')) = 11
            then 'ok' else 'FALTA' end
union all
select '159 anon não executa meeting_create',
       case when not has_function_privilege('anon',
              'public.meeting_create(text, text, timestamptz, timestamptz, text, text, text, date, uuid[])', 'execute')
            then 'ok' else 'ABERTO' end
union all
select '159 job meeting-reminders activo, cada minuto',
       case when exists (select 1 from cron.job where jobname = 'meeting-reminders' and active and schedule = '* * * * *')
            then 'ok' else 'FALTA' end;
