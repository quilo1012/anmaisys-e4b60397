-- Verificação do BLOCO 152. Só lê. Esperado: 'ok' em todas as linhas, menos as duas
-- últimas, que são informação.

select '152 work_orders no realtime' as check,
       case when exists (select 1 from pg_publication_tables
                         where pubname = 'supabase_realtime' and schemaname = 'public'
                           and tablename = 'work_orders')
            then 'ok' else 'FALTA' end as result
union all
select '152 nenhuma função chama o projeto antigo',
       coalesce((select 'AINDA: ' || string_agg(p.oid::regprocedure::text, ', ')
                   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.prosrc like '%ybtrzqzliepknpzqdajx%'), 'ok')
union all
select '152 notification_push chama o AN Maintenance',
       case when pg_get_functiondef(to_regprocedure('public.notification_push()'))
                 like '%apblxaaktftinstoidvp.supabase.co/functions/v1/send-push%'
            then 'ok' else 'FALTA' end
union all
select '152 trigger da ordem nova ligado',
       coalesce((select case when t.tgenabled <> 'D' then 'ok' else 'DESLIGADO' end
                   from pg_trigger t
                  where t.tgrelid = 'public.work_orders'::regclass
                    and t.tgname = 'wo_new_alert_engineers'), 'FALTA')
union all
select '152 trigger do sino para o telemóvel ligado',
       coalesce((select case when t.tgenabled <> 'D' then 'ok' else 'DESLIGADO' end
                   from pg_trigger t
                  where t.tgrelid = 'public.notifications'::regclass
                    and t.tgname = 'notification_push'), 'FALTA')
union all
select '152 CRON_SECRET no vault',
       case when exists (select 1 from vault.decrypted_secrets where name = 'CRON_SECRET')
            then 'ok' else 'FALTA' end
union all
select '152 anon não executa',
       case when has_function_privilege('anon', 'public.wo_new_alert_engineers()', 'EXECUTE')
            then 'ANON EXECUTA' else 'ok' end
union all
select '152 engenheiros com telemóvel registado (informação)',
       (select count(distinct ur.user_id) || ' de ' ||
               (select count(distinct user_id) from public.user_roles where role = 'engineer')
          from public.user_roles ur
          join public.push_subscriptions s on s.user_id = ur.user_id
         where ur.role = 'engineer')
union all
select '152 avisos de ordem nova nas últimas 24h (informação)',
       (select count(*)::text from public.notifications
         where kind = 'wo_new' and created_at > now() - interval '24 hours');
