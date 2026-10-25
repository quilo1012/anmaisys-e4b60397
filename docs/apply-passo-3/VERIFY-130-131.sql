-- Verificação dos BLOCOS 130 e 131 — só lê.
--
-- Pode correr-se na produção a qualquer hora, antes ou depois de colar. Não escreve nada:
-- só lê o catálogo (funções e triggers) e conta linhas. O resultado é uma linha por
-- verificação, com "ok" ou o que falta.
--
--   130: record_overtime_outcome deixa uma reserva ser "Turned up", e recusa no-show /
--        sick a quem não foi aceite (procura as duas frases da recusa no corpo).
--   131: a função e o trigger overtime_request_change_notify existem; o trigger que manda
--        cada linha do sino para o telemóvel (notification_push, BLOCO 117) existe — sem
--        ele os avisos do 131 ficam só no sino; e o índice único de BLOCO 100 que impede
--        dois avisos de cancelamento para a mesma pessoa e pedido.

select '130 record_overtime_outcome' as check,
       case when position('so attendance cannot be recorded' in p.prosrc) > 0
             and position('so an overtime no-show cannot be recorded' in p.prosrc) > 0
            then 'ok' else 'em falta: colar APLICAR-130' end as result
  from pg_proc p where p.proname = 'record_overtime_outcome' and p.pronamespace = 'public'::regnamespace
union all
select '131 função',
       case when exists (select 1 from pg_proc where proname = 'overtime_request_change_notify' and pronamespace = 'public'::regnamespace)
            then 'ok' else 'em falta: colar APLICAR-131' end
union all
select '131 trigger',
       case when exists (select 1 from pg_trigger where tgname = 'overtime_request_change_notify_t' and not tgisinternal)
            then 'ok' else 'em falta: colar APLICAR-131' end
union all
select '117 notification_push (push para o telemóvel)',
       case when exists (select 1 from pg_trigger where tgname = 'notification_push' and tgrelid = 'public.notifications'::regclass)
            then 'ok' else 'em falta: os avisos ficam só no sino' end
union all
select '100 um aviso por pessoa e pedido',
       case when exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'notifications_one_per_event_key')
            then 'ok' else 'em falta: BLOCO 100' end
union all
select '131 avisos já enviados (contagem)',
       (select count(*)::text from public.notifications where kind in ('overtime_cancelled', 'overtime_changed'));
