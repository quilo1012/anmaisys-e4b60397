-- Verificação do BLOCO 134 — só lê.
--
-- Pode correr-se na produção a qualquer hora. Não escreve nada: lê o corpo da função e
-- o catálogo, e conta as mensagens privadas das últimas 24 horas que ficaram sem sino.

select '134 dm_employee_bell toca a toda a gente' as check,
       case when position('BLOCO 134' in p.prosrc) > 0 then 'ok' else 'em falta: colar APLICAR-134' end as result
  from pg_proc p where p.proname = 'dm_employee_bell' and p.pronamespace = 'public'::regnamespace
union all
select '134 trigger dm_employee_bell_t',
       case when exists (select 1 from pg_trigger where tgname = 'dm_employee_bell_t' and not tgisinternal)
            then 'ok' else 'em falta: o sino das mensagens não corre' end
union all
select '117 trigger notification_push (o sino toca o telemóvel)',
       case when exists (select 1 from pg_trigger where tgname = 'notification_push' and tgrelid = 'public.notifications'::regclass)
            then 'ok' else 'em falta: colar APLICAR-117 — sem ele nenhum aviso chega ao telemóvel' end
union all
select '134 mensagens privadas das últimas 24 h sem sino (informação; depois de colar deve ficar a 0 para as novas)',
       (select count(*)::text from public.direct_messages m
         where m.created_at > now() - interval '24 hours'
           and not exists (select 1 from public.notifications n
                            where n.user_id = m.recipient_id
                              and n.created_at between m.created_at - interval '5 seconds' and m.created_at + interval '5 seconds'));
