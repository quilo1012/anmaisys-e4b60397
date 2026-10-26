-- Verificação do BLOCO 133 — só lê.
--
-- Pode correr-se na produção a qualquer hora, antes ou depois de colar. Não escreve nada:
-- lê o catálogo (funções, triggers, job do pg_cron) e conta os lembretes escritos.

select '133 função overtime_reminders_due' as check,
       case when exists (select 1 from pg_proc where proname = 'overtime_reminders_due' and pronamespace = 'public'::regnamespace)
            then 'ok' else 'em falta: colar APLICAR-133' end as result
union all
select '133 trigger overtime_reminders_forget_ask_t',
       case when exists (select 1 from pg_trigger where tgname = 'overtime_reminders_forget_ask_t' and not tgisinternal)
            then 'ok' else 'em falta: colar APLICAR-133' end
union all
select '133 trigger overtime_reminders_forget_booking_t',
       case when exists (select 1 from pg_trigger where tgname = 'overtime_reminders_forget_booking_t' and not tgisinternal)
            then 'ok' else 'em falta: colar APLICAR-133' end
union all
select '133 job overtime-reminders (pg_cron)',
       case when exists (select 1 from cron.job where jobname = 'overtime-reminders' and active)
            then 'ok' else 'em falta ou desativado' end
union all
select '133 notification_push manda ttl nos lembretes',
       case when position('''ttl''' in p.prosrc) > 0 and position('overtime-notice-' in p.prosrc) > 0
            then 'ok' else 'em falta: colar APLICAR-132 e APLICAR-133' end
  from pg_proc p where p.proname = 'notification_push' and p.pronamespace = 'public'::regnamespace
union all
select '133 só o servidor corre os lembretes',
       case when not has_function_privilege('authenticated', 'public.overtime_reminders_due(timestamptz)', 'EXECUTE')
             and not has_function_privilege('anon', 'public.overtime_reminders_due(timestamptz)', 'EXECUTE')
            then 'ok' else 'ATENÇÃO: um utilizador pode correr os lembretes' end
union all
select '133 lembretes escritos nas últimas 24 horas (informação)',
       (select count(*)::text from public.notifications
         where kind in ('overtime_reminder_24h', 'overtime_reminder_2h') and created_at > now() - interval '24 hours')
union all
select '133 últimas execuções do job (informação)',
       coalesce((select string_agg(status || ' ' || to_char(start_time, 'DD/MM HH24:MI'), ', ' order by start_time desc)
                   from (select d.status, d.start_time from cron.job_run_details d
                           join cron.job j on j.jobid = d.jobid
                          where j.jobname = 'overtime-reminders'
                          order by d.start_time desc limit 3) x), 'ainda não correu');
