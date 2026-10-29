-- Verificação do BLOCO 137 — sair da reserva é um "não" simples. Só lê.
--
-- Pode correr-se na produção a qualquer hora, antes ou depois de colar o 137. Lê o
-- corpo da função (md5, o mesmo que o teste src/__tests__/thePaste137IsBlock137.test.ts
-- calcula a partir da migração) e conta respostas; não escreve nada.
--
-- Esperado depois de colar: as duas primeiras linhas 'ok'. Antes de colar, a 29/10 às
-- 21h: 'em falta' e '1 (E129 30/10)'.

select '137 leave_my_reserve limpa a decisão' as check,
       case when md5(p.prosrc) = '07282635efee22e2c7365a2482c40afa' then 'ok'
            else 'em falta: colar APLICAR-137 (md5 ' || md5(p.prosrc) || ')' end as result
  from pg_proc p where p.proname = 'leave_my_reserve' and p.pronamespace = 'public'::regnamespace
union all
select '137 respostas "não" que ainda guardam a reserva (deve ser 0)',
       case when count(*) = 0 then 'ok'
            else count(*)::text || ' (' || string_agg(coalesce(e.employee_ref, e.full_name) || ' ' || to_char(q.on_date, 'DD/MM'), ', ') || ')' end
  from public.overtime_responses r
  join public.employees e on e.id = r.employee_id
  join public.overtime_requests q on q.id = r.request_id
 where r.answer = 'no' and r.decision = 'reserve'
   and not exists (select 1 from public.overtime_outcomes o where o.response_id = r.id)
union all
select '137 saídas da reserva nos últimos 7 dias (informação)',
       count(*)::text
  from public.overtime_audit a
 where a.event_type = 'decision_cleared' and a.old_value ->> 'decision' = 'reserve'
   and a.occurred_at > now() - interval '7 days'
union all
select '137 voltaram a dizer sim depois de sair da reserva, últimos 7 dias (informação)',
       count(distinct a.response_id)::text
  from public.overtime_audit a
 where a.event_type = 'answered_yes' and a.old_value ->> 'answer' = 'no'
   and a.occurred_at > now() - interval '7 days'
   and exists (select 1 from public.overtime_audit b
                where b.response_id = a.response_id and b.event_type = 'decision_cleared'
                  and b.old_value ->> 'decision' = 'reserve' and b.occurred_at < a.occurred_at);
