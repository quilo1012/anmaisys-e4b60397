-- Verificação do BLOCO 132 — só lê.
--
-- Pode correr-se na produção a qualquer hora, antes ou depois de colar. Não escreve nada:
-- só lê o corpo da função notification_push e confirma que os triggers que a chamam
-- continuam lá.

select '132 notification_push usa overtime-notice-' as check,
       case when position('overtime-notice-' in p.prosrc) > 0
             and position('overtime_reminder_2h' in p.prosrc) > 0
            then 'ok' else 'em falta: colar APLICAR-132' end as result
  from pg_proc p where p.proname = 'notification_push' and p.pronamespace = 'public'::regnamespace
union all
select '117 trigger notification_push',
       case when exists (select 1 from pg_trigger where tgname = 'notification_push' and tgrelid = 'public.notifications'::regclass)
            then 'ok' else 'em falta: os avisos ficam só no sino' end
union all
select '117 trigger notification_push_again',
       case when exists (select 1 from pg_trigger where tgname = 'notification_push_again' and tgrelid = 'public.notifications'::regclass)
            then 'ok' else 'em falta (mensagens de grupo não voltam a tocar)' end;
